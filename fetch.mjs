// Pulls DTEK Kyiv "fact" outage schedule (dtek-kem.com.ua) with headless Chromium and writes public/kyiv.json.
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = 'https://www.dtek-kem.com.ua/ua/shutdowns';
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'uk-UA', timezoneId: 'Europe/Kyiv', viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();
let data = null;
for (let attempt = 1; attempt <= 3 && !data; attempt++) {
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => typeof DisconSchedule !== 'undefined' && !!DisconSchedule.fact, null, { timeout: 45000 });
    data = await page.evaluate(() => {
      const f = DisconSchedule.fact;
      const n = document.querySelector('.m-attention__text');
      const days = Object.entries(f.data || {}).map(([ts, groups]) => ({
        date: Number(ts),
        groups: Object.fromEntries(Object.entries(groups).map(([g, h]) =>
          [g, Array.from({ length: 24 }, (_, i) => h[String(i + 1)] || 'yes')])),
      }));
      return { updated: f.update || '', notice: n ? n.innerText.trim() : null, days };
    });
  } catch (e) {
    console.error(`attempt ${attempt} failed:`, e.message, '| title:', await page.title().catch(() => '?'));
    await page.waitForTimeout(5000);
  }
}
await browser.close();
if (!data || !data.days.length) { console.error('no data'); process.exit(1); }
const out = { source: 'dtek-kem.com.ua', fetched: Math.floor(Date.now() / 1000), ...data };
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/kyiv.json', JSON.stringify(out));
fs.writeFileSync('public/index.html', '<meta charset="utf-8"><p>Дані для застосунку «Світло»: <a href="kyiv.json">kyiv.json</a>. Джерело: dtek-kem.com.ua.</p>');
console.log('ok', out.updated, out.days.length, 'days');
