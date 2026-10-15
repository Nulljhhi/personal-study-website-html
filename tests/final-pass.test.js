// Final pass on bug report 3: start-up runs in isolated steps (O12) and
// the Home list stays bounded on big banks (O04).
const { chromium } = require('./browser');
const path = require('path');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const url = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const fixture = (n) => path.join(__dirname, 'fixtures', n);

(async () => {
  const b = await chromium.launch();

  // O12: a broken start-up step doesn't take the rest of the app with it.
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    window.__STUDY_TEST_NO_MINIGAMES = true;
    // Runs before the app's own DOMContentLoaded handler: one button is gone.
    document.addEventListener('DOMContentLoaded', () => { const el = document.getElementById('docs-prev-btn'); if (el) el.remove(); });
  });
  await page.goto(url);
  await page.waitForTimeout(200);
  const toast = await page.$$eval('.toast', e => e.map(x => x.textContent).join(' | '));
  check(/Documentation screen/.test(toast), 'the failed step is named: ' + toast);
  check(errors.some(e => /Documentation screen/.test(e)), 'and logged with its error');
  // Steps after it still ran.
  await page.setInputFiles('#file-input', fixture('bank.txt'));
  await page.waitForTimeout(300);
  check(await page.isVisible('#screen-home'), 'loading a bank still works');
  await page.click('#mode-quiz-btn').catch(() => {});
  await page.waitForTimeout(100);
  check(await page.evaluate(() => StudyApp.state.screen) !== 'home', 'mode buttons still work: ' + await page.evaluate(() => StudyApp.state.screen));
  await page.close();

  // A normal start reports nothing.
  const ok = await b.newPage();
  await ok.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  await ok.goto(url);
  await ok.waitForTimeout(200);
  check((await ok.$$('.toast')).length === 0, 'a normal start shows no problem');
  await ok.close();

  // O04: a long list fetches its pictures only as they come near the screen.
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
  const fake = (q, a) => `question: ${q}\nanswer: ${a}\nmedium_fake_answer_1: m1\nmedium_fake_answer_2: m2\nmedium_fake_answer_3: m3\nhard_fake_answer_1: h1\nhard_fake_answer_2: h2\nhard_fake_answer_3: h3\n\n`;
  let bank = 'unit_title: Many Pictures\n\n', lines = [];
  for (let i = 1; i <= 200; i++) {
    bank += i % 2 ? fake('Picture question ' + i + '?', 'A' + i) : `question: Click spot ${i}.\nhotspot: 50, 50\n\n`;
    lines.push(`Img.Q${i}.png 100x100 #${i.toString(16).padStart(8, '0')}: asset:${i.toString(16).padStart(64, '0')}.png`);
  }
  bank += '=== images (added by Study Website from a .zip; don\'t edit below this line) ===\n' + lines.join('\n') + '\n';
  const list = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  list.on('pageerror', e => console.log('PAGEERROR', e.message));
  await list.addInitScript((png) => {
    window.__STUDY_TEST_NO_MINIGAMES = true; window.__reads = 0;
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    window.__TAURI__ = { core: { invoke: async (cmd) => { if (cmd === 'read_image') { window.__reads++; return bytes.buffer.slice(0); } return ''; } } };
  }, PNG);
  await list.goto(url);
  await list.evaluate(t => StudyApp.loadUnitText(t), bank);
  await list.waitForTimeout(500);
  const first = await list.evaluate(() => window.__reads);
  check(first > 0 && first < 60, 'only pictures near the screen are fetched at first: ' + first + ' of 200');
  const shown = await list.evaluate(() => [...document.querySelectorAll('#qa-list .qa-pair')].slice(0, 3).every(r => { const i = r.querySelector('img'); return i && i.src.startsWith('blob:'); }));
  check(shown, 'the pictures on screen are shown');
  await list.evaluate(() => [...document.querySelectorAll('#qa-list .qa-pair')].pop().scrollIntoView());
  await list.waitForTimeout(500);
  const later = await list.evaluate(() => window.__reads);
  check(later > first, 'scrolling down fetches the rest: ' + later);
  const last = await list.evaluate(() => { const r = [...document.querySelectorAll('#qa-list .qa-pair')].pop(); const i = r.querySelector('img'); return i && i.src; });
  check(last && last.startsWith('blob:'), 'the last row\'s picture is shown after scrolling to it');
  // Loading another bank drops pictures still waiting from the old list.
  await list.evaluate(t => StudyApp.loadUnitText(t), 'unit_title: Plain\n\n' + fake('Q?', 'A'));
  await list.waitForTimeout(300);
  check(await list.evaluate(() => window.__reads) === later, 'a closed list fetches nothing more');
  await list.close();

  await b.close();
})();
