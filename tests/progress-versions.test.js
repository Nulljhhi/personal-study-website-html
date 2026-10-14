const { chromium } = require('./browser');
const fs = require('fs');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
(async () => {
  const b = await chromium.launch();
  const bank = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'big.txt'), 'utf8');
  const title = bank.match(/unit_title: (.*)/)[1];
  const qs = [...bank.matchAll(/question: (.*)\nanswer: (.*)/g)].map(m => m[1] + '\n' + m[2]);
  const mk = async (progress) => {
    const page = await b.newPage({ viewport: { width: 1920, height: 1080 } }); await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    await page.addInitScript((pr) => { window.__w = []; window.__TAURI__ = { core: { invoke: async (cmd, a) => {
      if (cmd === 'read_progress') return pr; if (cmd === 'write_progress') { window.__w.push(a.json); return null; } return ''; } } }; }, progress);
    await page.goto(require('url').pathToFileURL(require('path').join(__dirname, '..', 'src', 'index.html')).href);
    await page.setInputFiles('#file-input', require('path').join(__dirname, 'fixtures', 'big.txt')); await page.waitForTimeout(300);
    return page;
  };
  const v2 = JSON.stringify({ format: 'study-website-completed', version: 2, unitTitle: title, completed: [qs[0], qs[1]],
    highScores: { 'boss:rising': 50 }, games: { garden: { plants: { [qs[2]]: { stage: 3, due: 1, species: 'tomato', bloomed: false, waterings: 2 } }, coins: 7 } } });
  let page = await mk(v2);
  check((await page.textContent('#completed-summary')).startsWith('2 of'), 'v2 completions load: ' + await page.textContent('#completed-summary'));
  // Trigger a save.
  await page.evaluate(() => { window.StudyApp.state.highScores['x:1'] = 1; });
  await page.click('#mode-quiz-btn'); await page.click('#quiz-start-btn'); await page.waitForTimeout(100);
  const ans = await page.$$eval('#qa-list .qa-pair', els => Object.fromEntries(els.map(e => [e.querySelector('.qa-q').firstChild.textContent, e.querySelector('.qa-a').textContent])));
  const q = await page.textContent('#quiz-question-text');
  const tf = await page.isVisible('#tf-candidate');
  if (tf) { const cand = await page.textContent('#tf-candidate'); await page.keyboard.press(cand === ans[q] ? 't' : 'f'); }
  else { const btns = await page.$$('#quiz-choices button.choice'); for (let i = 0; i < btns.length; i++) if ((await btns[i].textContent()) === ans[q]) await page.keyboard.press(String(i + 1)); }
  await page.click('#submit-quiz-btn'); await page.waitForTimeout(100);
  if (await page.isVisible('#submit-continue-btn')) await page.click('#submit-continue-btn');
  await page.waitForTimeout(300);
  const writes = await page.evaluate(() => window.__w);
  const saved = JSON.parse(writes[writes.length - 1] || '{}');
  check(saved.version === 3 && saved.schemas && saved.schemas.garden === 2, 'saved as version 3 with schemas');
  check(saved.completed.length >= 2 && saved.completed.every(k => /^k1:[0-9a-f]{28}$/.test(k)), 'keys hashed: ' + saved.completed.slice(0, 2).join(','));
  const plantKeys = Object.keys(saved.games.garden.plants);
  check(plantKeys.length === 1 && /^k1:/.test(plantKeys[0]) && saved.games.garden.coins === 7, 'garden plants re-keyed');
  check(saved.highScores['boss:rising'] === 50, 'scores kept');
  await page.close();
  // The saved v3 file loads back the same.
  page = await mk(JSON.stringify(saved));
  check((await page.textContent('#completed-summary')).startsWith(saved.completed.length + ' of'), 'v3 round trip');
  await page.close();
  // Newer files are refused and not overwritten.
  page = await mk(JSON.stringify(Object.assign({}, saved, { version: 4 })));
  const t = await page.$$eval('.toast', e => e.map(x => x.textContent).join(' | '));
  check(/newer version/.test(t), 'newer file refused: ' + t.slice(0, 120));
  await page.close();
  page = await mk(JSON.stringify(Object.assign({}, saved, { schemas: Object.assign({}, saved.schemas, { boss: 9 }) })));
  check(/newer version/.test(await page.$$eval('.toast', e => e.map(x => x.textContent).join(' | '))), 'newer game section refused');
  await page.close();
  await b.close();
})();
