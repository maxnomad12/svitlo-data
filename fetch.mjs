// Pulls DTEK "fact" outage schedules with headless Chromium:
//   Kyiv city   (dtek-kem.com.ua)  → public/kyiv.json
//   Kyiv oblast (dtek-krem.com.ua) → public/kyiv-oblast.json + public/kyiv-oblast-streets.json
import { chromium } from 'playwright';
import fs from 'node:fs';

const SOURCES = [
  { url: 'https://www.dtek-kem.com.ua/ua/shutdowns', file: 'kyiv.json', source: 'dtek-kem.com.ua' },
  { url: 'https://www.dtek-krem.com.ua/ua/shutdowns', file: 'kyiv-oblast.json', source: 'dtek-krem.com.ua', streets: 'kyiv-oblast-streets.json' },
];

const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'uk-UA', timezoneId: 'Europe/Kyiv', viewport: { width: 1280, height: 900 },
});
fs.mkdirSync('public', { recursive: true });
let okCount = 0;

for (const src of SOURCES) {
  const page = await ctx.newPage();
  let data = null;
  for (let attempt = 1; attempt <= 3 && !data; attempt++) {
    try {
      await page.goto(src.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => typeof DisconSchedule !== 'undefined' && !!DisconSchedule.fact, null, { timeout: 45000 });
      data = await page.evaluate((wantStreets) => {
        const f = DisconSchedule.fact;
        const n = document.querySelector('.m-attention__text');
        const days = Object.entries(f.data || {}).map(([ts, groups]) => ({
          date: Number(ts),
          groups: Object.fromEntries(Object.entries(groups).map(([g, h]) =>
            [g, Array.from({ length: 24 }, (_, i) => h[String(i + 1)] || 'yes')])),
        }));
        return {
          updated: f.update || '', notice: n ? n.innerText.trim() : null, days,
          streets: wantStreets ? (DisconSchedule.streets || null) : null,
        };
      }, !!src.streets);
    } catch (e) {
      console.error(`${src.source} attempt ${attempt} failed:`, e.message, '| title:', await page.title().catch(() => '?'));
      await page.waitForTimeout(5000);
    }
  }
  await page.close();
  if (!data || !data.days.length) { console.error(`${src.source}: no data`); continue; }
  const { streets, ...rest } = data;
  const out = { source: src.source, fetched: Math.floor(Date.now() / 1000), ...rest };
  fs.writeFileSync(`public/${src.file}`, JSON.stringify(out));
  if (src.streets && streets && Object.keys(streets).length) {
    fs.writeFileSync(`public/${src.streets}`, JSON.stringify({ fetched: out.fetched, settlements: streets }));
  }
  okCount++;
  console.log('ok', src.source, out.updated, out.days.length, 'days');
}
await browser.close();
fs.writeFileSync('public/index.html', '<meta charset="utf-8"><p>Дані для застосунку «Коли буде світло»: <a href="kyiv.json">kyiv.json</a> (dtek-kem.com.ua), <a href="kyiv-oblast.json">kyiv-oblast.json</a> (dtek-krem.com.ua).</p>');
if (okCount === 0) process.exit(1);
