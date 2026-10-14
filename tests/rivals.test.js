const { chromium } = require('./browser');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1920, height: 1080 } }); await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.clock.install();
  await page.addInitScript(() => {
    const load = () => JSON.parse(localStorage.getItem('mockfs') || '{}');
    const save = fs => localStorage.setItem('mockfs', JSON.stringify(fs));
    window.__TAURI__ = { core: { invoke: async (cmd, a) => { const fs = load();
      if (cmd === 'read_progress') return fs['progress/' + a.name] || '';
      if (cmd === 'write_progress') { fs['progress/' + a.name] = a.json; save(fs); return null; }
      return ''; } } };
  });
  await page.goto(require('url').pathToFileURL(require('path').join(__dirname, '..', 'src', 'index.html')).href);
  await page.evaluate(() => localStorage.clear());
  const loadBank = async () => { await page.setInputFiles('#file-input', require('path').join(__dirname, 'fixtures', 'big.txt')); await page.clock.runFor(300); };
  await loadBank();
  const answers = await page.$$eval('#qa-list .qa-pair', els => Object.fromEntries(els.map(e => [e.querySelector('.qa-q').firstChild.textContent, e.querySelector('.qa-a').textContent])));
  const ans = async (right) => {
    const q = await page.textContent('#game-question');
    const tf = await page.isVisible('#game-tf-candidate');
    if (tf) { const cand = await page.textContent('#game-tf-candidate'); await page.keyboard.press(((cand === answers[q]) === right) ? 't' : 'f'); return; }
    const btns = await page.$$('#game-choices button.choice');
    for (let i = 0; i < btns.length; i++) { const t = await btns[i].evaluate(e => e.lastChild.textContent); if ((t === answers[q]) === right) { await page.keyboard.press(String(i + 1)); return; } }
  };
  const disk = () => page.evaluate(() => { const fs = JSON.parse(localStorage.getItem('mockfs') || '{}'); const k = Object.keys(fs).find(k => k.startsWith('progress/')); return k ? JSON.parse(fs[k]) : null; });
  const playSurvival = async () => {
    await page.click('#mode-games-btn'); await page.clock.runFor(100);
    await page.click('#games-grid .checkpoint-tile:nth-child(2)'); await page.clock.runFor(200);
    const mod = await page.$('#game-modifier'); if (mod && await mod.isVisible()) await page.uncheck('#game-modifier');
    await page.check('#game-bots');
    await page.click('#game-start-btn'); await page.clock.runFor(200);
    const sub = await page.$$eval('#game-board .board-name[title]', e => e.map(x => x.title));
    for (let i = 0; i < 12; i++) { await ans(true); await page.clock.runFor(1500); }
    for (let i = 0; i < 10 && await page.isVisible('#screen-game'); i++) { await ans(false); await page.clock.runFor(3000); }
    await page.clock.runFor(1000);
    return sub;
  };
  const sub1 = await playSurvival();
  check(sub1.length === 3 && sub1.every(t => /^Lv \d+ · Chill/.test(t) || /^Lv \d+ · \w+/.test(t)), 'rival summaries: ' + sub1.join(' | '));
  let d = await disk();
  const r1 = d.games.rivals && d.games.rivals.survival;
  check(r1 && r1.length === 3 && r1.every(r => r.xp > 0 && r.runs === 1), 'rivals saved with XP after a run: ' + JSON.stringify(r1 && r1.map(r => [r.name, r.xp, r.best])));
  const names1 = r1.map(r => r.name).join();
  await page.click('#game-results-home-btn'); await page.clock.runFor(100);
  await playSurvival();
  d = await disk();
  check(d.games.rivals.survival.map(r => r.name).join() === names1 && d.games.rivals.survival.every(r => r.runs === 2), 'same rivals come back and keep growing');
  // Give a rival a strong record and check its perk shows.
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('mockfs')); const k = Object.keys(fs).find(k => k.startsWith('progress/'));
    const d = JSON.parse(fs[k]); d.games.rivals.survival[0].best = 120; d.games.rivals.fishing = d.games.rivals.survival.map(r => Object.assign({}, r, { rod: 'carbon', stats: { reel: 3, bait: 2, line: 1, luck: 4, cast: 5 } }));
    fs[k] = JSON.stringify(d); localStorage.setItem('mockfs', JSON.stringify(fs));
  });
  await page.reload(); await page.clock.runFor(300); await loadBank();
  await page.click('#mode-games-btn'); await page.clock.runFor(100);
  await page.click('#games-grid .checkpoint-tile:nth-child(2)'); await page.clock.runFor(200);
  await page.check('#game-bots');
  await page.click('#game-start-btn'); await page.clock.runFor(200);
  const sub3 = await page.$$eval('#game-board .board-name[title]', e => e.map(x => x.title));
  check(sub3.some(t => /Second wind/.test(t)), 'newest unlocked perk in use: ' + sub3.join(' | '));
  await page.click('#game-exit-btn'); await page.click('#game-quit-btn'); await page.clock.runFor(200);
  // Fishing rivals use their own rods.
  console.log('   after quit:', await page.evaluate(() => document.body.getAttribute('data-screen')));
  if (!(await page.isVisible('#games-grid'))) { await page.click('#mode-games-btn'); await page.clock.runFor(100); }
  await page.click('#games-grid .checkpoint-tile:nth-child(4)'); await page.clock.runFor(200);
  await page.check('#game-bots');
  await page.click('#game-start-btn'); await page.clock.runFor(200);
  const sub4 = await page.$$eval('#game-board .board-name[title]', e => e.map(x => x.title));
  check(sub4.every(t => /Carbon Rod/.test(t)), 'fishing rivals show their own rod: ' + sub4.join(' | '));
  await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'rivals.png') });
  await b.close();
})();
