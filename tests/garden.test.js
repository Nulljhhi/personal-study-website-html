const { chromium } = require('./browser');
// Screenshots for looking at by hand go to the system temp folder, not the repo.
const shot = (n) => require('path').join(require('os').tmpdir(), 'study-website-' + n);
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
    if (tf) {
      const cand = await page.textContent('#game-tf-candidate');
      const truth = cand === answers[q];
      await page.click(`#game-choices button.choice[data-slot="${(truth === right) ? 'true' : 'false'}"]`); return;
    }
    for (const bt of await page.$$('#game-choices button.choice:not(.removed)')) { const t = await bt.evaluate(e => e.lastChild.textContent); if ((t === answers[q]) === right) { await bt.click(); return; } }
  };
  const disk = () => page.evaluate(() => { const fs = JSON.parse(localStorage.getItem('mockfs') || '{}'); const k = Object.keys(fs).find(k => k.startsWith('progress/')); return k ? JSON.parse(fs[k]) : null; });
  check(await page.isVisible('#mode-sessions-btn'), 'Study Sessions button on Home');
  await page.screenshot({ path: shot('garden-home.png') });
  await page.click('#mode-sessions-btn'); await page.clock.runFor(100); await page.screenshot({ path: shot('sessions.png') }); await page.click('#mode-garden-btn'); await page.clock.runFor(200);
  check(await page.isVisible('#screen-garden'), 'garden screen');
  check((await page.textContent('#garden-summary')).includes('Nothing planted yet'), 'empty garden: ' + await page.textContent('#garden-summary'));
  check(await page.$eval('#garden-water-btn', e => e.disabled) && (await page.textContent('#garden-seed-btn')) === 'Plant 5 new seeds', 'buttons');
  await page.click('#garden-seed-btn'); await page.clock.runFor(200);
  check(await page.isVisible('#screen-game'), 'session started');
  for (let i = 0; i < 5; i++) { await ans(i !== 2); await page.clock.runFor(100); if (i === 0) await page.screenshot({ path: shot('garden-play.png') }); await page.clock.runFor(1400); }
  check((await page.textContent('#game-idle-title')) === 'Seeds planted!', 'session done: ' + await page.textContent('#game-idle-text'));
  await page.keyboard.press('Enter'); await page.clock.runFor(300);
  check(await page.isVisible('#screen-garden'), 'back to garden');
  let d = await disk();
  const plants = Object.values(d.games.garden.plants);
  check(plants.length === 5 && plants.filter(p => p.stage === 1).length === 4 && plants.filter(p => p.stage === 0).length === 1, 'plants saved with stages');
  check(d.completed.length === 0, 'no questions completed yet');
  check((await page.textContent('#garden-summary')).includes('Next: 5 tomorrow'), 'next due tomorrow: ' + await page.textContent('#garden-summary'));
  // Make all plants due and nearly bloomed.
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('mockfs')); const k = Object.keys(fs).find(k => k.startsWith('progress/'));
    const d = JSON.parse(fs[k]); Object.values(d.games.garden.plants).forEach(p => { p.stage = 4; p.due -= 30; delete p.lastWatered; });
    fs[k] = JSON.stringify(d); localStorage.setItem('mockfs', JSON.stringify(fs));
  });
  await page.reload(); await page.clock.runFor(300); await loadBank();
  check((await page.textContent('#garden-due-badge')).trim() === '5 due', 'home badge: ' + await page.textContent('#garden-due-badge'));
  await page.click('#mode-sessions-btn'); await page.clock.runFor(100); await page.screenshot({ path: shot('sessions.png') }); await page.click('#mode-garden-btn'); await page.clock.runFor(200);
  check((await page.textContent('#garden-water-btn')) === "Water today's plants (5)", 'water button count');
  await page.click('#garden-water-btn'); await page.clock.runFor(200);
  for (let i = 0; i < 5; i++) { await ans(i !== 4); await page.clock.runFor(1500); }
  console.log('  ', await page.textContent('#game-idle-text'));
  await page.click('#game-cast-btn'); await page.clock.runFor(300);
  d = await disk();
  check(d.completed.length === 4, 'blooms completed 4 questions: ' + d.completed.length);
  const ps = Object.values(d.games.garden.plants);
  check(ps.filter(p => p.stage === 5).length === 4 && ps.filter(p => p.stage === 3).length === 1, 'bloom + wilt stages');
  check(d.games.garden.coins > 100, 'coins: ' + d.games.garden.coins);
  check(!(await page.$eval('.garden-plot:nth-child(2)', e => e.classList.contains('locked'))), 'flower beds opened after blooms');
  await page.click('#garden-shop-btn'); await page.clock.runFor(100);
  await page.click('#garden-shop-list .shop-card button.primary'); await page.clock.runFor(500);
  await page.keyboard.press('Escape'); await page.clock.runFor(100);
  d = await disk();
  check(Object.keys(d.games.garden.decor).length === 1, 'decoration bought');
  check(!d.games.progress || !d.games.progress.garden, 'no XP/progress record for garden');
  await page.screenshot({ path: shot('garden-screen.png'), fullPage: true });
  await b.close();
})();
