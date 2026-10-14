// B12: a bed that opens after every seed is planted can be filled by transplanting.
const { chromium } = require('./browser');
const path = require('path');
const fixture = (n) => path.join(__dirname, 'fixtures', n);
const pageUrl = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  await page.goto(pageUrl);
  await page.setInputFiles('#file-input', fixture('big.txt')); await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = StudyApp.state, g = s.gameData.garden, today = Math.floor(Date.now() / 86400000) + 5;
    s.unit.questions.forEach(q => { g.plants[StudyApp.__test.key(q)] = { stage: 5, due: today, species: 'lettuce', bloomed: true, waterings: 5 }; });
  });
  await page.evaluate(() => document.querySelector('#mode-garden-btn').click()); await page.waitForTimeout(300);
  const btns = await page.$$eval('.garden-transplant-btn', e => e.map(x => x.textContent));
  check(btns.length >= 1, 'empty open beds offer a transplant: ' + btns.join(' / '));
  await page.click('.garden-transplant-btn'); await page.waitForTimeout(200);
  const plots = await page.evaluate(() => { const g = StudyApp.state.gameData.garden; return Object.values(g.plants).map(p => p.species); });
  check(plots.some(s => s !== 'lettuce'), 'some blooms moved to another bed');
  check(plots.filter(s => s === 'lettuce').length >= 1, 'the source bed keeps plants');
  await b.close();
})();
