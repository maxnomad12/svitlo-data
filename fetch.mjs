// Pulls DTEK "fact" outage schedules with headless Chromium:
//   Kyiv city   (dtek-kem.com.ua)  → public/kyiv.json
//   Kyiv oblast (dtek-krem.com.ua) → public/kyiv-oblast.json + public/kyiv-oblast-streets.json
//   Odesa (dtek-oem.com.ua)        → public/odesa.json + public/odesa-streets.json
//   Dnipro (dtek-dnem.com.ua)      → public/dnipro.json + public/dnipro-streets.json
import { chromium } from 'playwright';
import fs from 'node:fs';

const SOURCES = [
  { url: 'https://www.dtek-kem.com.ua/ua/shutdowns', file: 'kyiv.json', source: 'dtek-kem.com.ua' },
  { url: 'https://www.dtek-krem.com.ua/ua/shutdowns', file: 'kyiv-oblast.json', source: 'dtek-krem.com.ua', streets: 'kyiv-oblast-streets.json' },
  { url: 'https://www.dtek-oem.com.ua/ua/shutdowns', file: 'odesa.json', source: 'dtek-oem.com.ua', streets: 'odesa-streets.json' },
  { url: 'https://www.dtek-dnem.com.ua/ua/shutdowns', file: 'dnipro.json', source: 'dtek-dnem.com.ua', streets: 'dnipro-streets.json' },
];


// Calendar subscriptions: public/cal/<file>-<group>.ics (1.5). Outage times in UTC, merged by half-hours.
const AREA = { 'kyiv.json': ['kyiv', 'Київ'], 'kyiv-oblast.json': ['kyiv-oblast', 'Київщина'], 'odesa.json': ['odesa', 'Одеса й область'], 'dnipro.json': ['dnipro', 'Дніпро й область'] };
function icsTime(sec) { return new Date(sec * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function writeCalendars(src, out) {
  const [prefix, area] = AREA[src.file] || [src.file.replace('.json', ''), ''];
  fs.mkdirSync('public/cal', { recursive: true });
  const groups = new Set();
  for (const d of out.days) Object.keys(d.groups).forEach(g => groups.add(g));
  const stamp = icsTime(out.fetched);
  for (const key of groups) {
    const g = key.replace(/^GPV/, '');
    const ev = [];
    for (const d of out.days) {
      const hours = d.groups[key]; if (!hours) continue;
      const half = [];
      for (const h of hours) {
        const m = { no: ['off', 'off'], first: ['off', 'on'], second: ['on', 'off'], maybe: ['maybe', 'maybe'], mfirst: ['maybe', 'on'], msecond: ['on', 'maybe'] }[h] || ['on', 'on'];
        half.push(...m);
      }
      let i = 0;
      while (i < 48) {
        if (half[i] === 'on') { i++; continue; }
        const kind = half[i]; let j = i;
        while (j < 48 && half[j] === kind) j++;
        const start = d.date + i * 1800, end = d.date + j * 1800;
        const title = kind === 'off' ? '⚡️ Без світла' : '⚡️ Можливо без світла';
        ev.push(['BEGIN:VEVENT', `UID:${prefix}-${g}-${start}-${kind}@svitlo`, `DTSTAMP:${stamp}`, `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end)}`,
          `SUMMARY:${title}`, `DESCRIPTION:Група ${g} · ${area}. Графік ДТЕК, оновлено ${out.updated}. Застосунок «Коли буде світло».`, 'TRANSP:TRANSPARENT', 'END:VEVENT'].join('\r\n'));
        i = j;
      }
    }
    const cal = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Svitlo//UA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      `X-WR-CALNAME:Світло · Група ${g} · ${area}`, 'X-WR-TIMEZONE:Europe/Kyiv', 'REFRESH-INTERVAL;VALUE=DURATION:PT30M', 'X-PUBLISHED-TTL:PT30M',
      ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
    fs.writeFileSync(`public/cal/${prefix}-${g}.ics`, cal);
  }
}

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
  writeCalendars(src, out);
  okCount++;
  console.log('ok', src.source, out.updated, out.days.length, 'days');
}
await browser.close();
if (fs.existsSync('add.html')) fs.copyFileSync('add.html', 'public/add.html');
fs.writeFileSync('public/index.html', '<meta charset="utf-8"><p>Дані для застосунку «Коли буде світло»: <a href="kyiv.json">kyiv.json</a> (dtek-kem.com.ua), <a href="kyiv-oblast.json">kyiv-oblast.json</a> (dtek-krem.com.ua), <a href="odesa.json">odesa.json</a> (dtek-oem.com.ua), <a href="dnipro.json">dnipro.json</a> (dtek-dnem.com.ua).</p>');
if (okCount === 0) process.exit(1);
