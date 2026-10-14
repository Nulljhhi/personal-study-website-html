const { chromium } = require('./browser');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
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
  const ans = async (right = true) => { const q = await page.textContent('#game-question'); const tf = await page.isVisible('#game-tf-candidate');
    if (tf) { const c = await page.textContent('#game-tf-candidate'); await page.keyboard.press((c === answers[q]) === right ? 't' : 'f'); return; }
    const btns = await page.$$('#game-choices button.choice'); for (let i = 0; i < btns.length; i++) if (((await btns[i].evaluate(e => e.lastChild.textContent)) === answers[q]) === right) { await page.keyboard.press(String(i + 1)); return; } };
  const G = () => page.evaluate(() => { const g = window.StudyApp.__test.game(); return g; });
  // Keyboard: G opens Games, 1 opens Boss Battle, Esc goes back.
  await page.keyboard.press('g'); await page.clock.runFor(100);
  check(await page.isVisible('#screen-games'), 'G opens Games');
  await page.keyboard.press('1'); await page.clock.runFor(200);
  check(await page.isVisible('#screen-game-setup'), '1 opens the first game');
  await page.keyboard.press('Escape'); await page.clock.runFor(100);
  check(await page.isVisible('#screen-games'), 'Esc goes back');
  // Elo: a Survival run with bots gets a rating from accuracy + pace.
  await page.keyboard.press('2'); await page.clock.runFor(200);
  await page.check('#game-bots');
  await page.keyboard.press('Enter'); await page.clock.runFor(300);
  check(await page.isVisible('#screen-game') && await page.isVisible('#game-board'), 'Enter starts; live board shown');
  // Measured against the viewport in the page's own units (under CSS zoom,
  // WebKit reports positions unzoomed, Chromium zoomed; the ratio is the same).
  const board = await page.$eval('#game-board', e => {
    const r = e.getBoundingClientRect(), page = document.documentElement.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { gapBelow: Math.round(page.bottom - r.bottom), left: Math.round(r.left), pos: cs.position, bottomCss: cs.bottom, rows: e.querySelectorAll('.board-row').length, viewH: innerHeight };
  });
  check(board.pos === 'fixed' && board.left < 40 && parseFloat(board.bottomCss) < 40 && board.rows === 4, 'board glued bottom-left: ' + JSON.stringify(board));
  for (let i = 0; i < 8; i++) { await page.clock.runFor(2500); await ans(i !== 3); await page.clock.runFor(1500); }
  for (let i = 0; i < 10 && await page.isVisible('#screen-game'); i++) { await page.clock.runFor(1000); await ans(false); await page.clock.runFor(2500); }
  await page.clock.runFor(1000);
  const place = await page.textContent('#game-results-place');
  check(/Rating 1000 → \d+.*% right, using about \d+%/.test(place), 'rating from performance: ' + place);
  await page.keyboard.press('h'); await page.clock.runFor(100);
  check(await page.isVisible('#screen-home'), 'H on results goes home');
  // Tycoon with a huge bank shows a short number.
  await page.evaluate(() => { window.StudyApp.state.gameData.tycoon.money = 9177440222907; });
  await page.keyboard.press('g'); await page.clock.runFor(100); await page.keyboard.press('5'); await page.clock.runFor(200);
  await page.keyboard.press('Enter'); await page.clock.runFor(800);
  const stats = await page.textContent('#game-stats');
  check(/\$9\.18T/.test(stats), 'bank shortened: ' + stats.replace(/\s+/g, ' ').slice(0, 80));
  await page.click('#game-exit-btn'); await page.click('#game-quit-btn'); await page.clock.runFor(300);
  // Fishing minutes: any whole number.
  await page.keyboard.press('g'); await page.clock.runFor(100); await page.keyboard.press('4'); await page.clock.runFor(200);
  await page.fill('#game-minutes', '7.6'); await page.dispatchEvent('#game-minutes', 'change');
  check((await page.inputValue('#game-minutes')) === '8', 'minutes snap to a whole number');
  await page.click('#game-start-btn'); await page.clock.runFor(300);
  check((await page.textContent('#game-stats')).includes('8:00'), 'session is 8 minutes');
  await page.click('#game-exit-btn'); await page.click('#game-quit-btn'); await page.clock.runFor(300);
  // Garden: the next question shows its own (new) seed, not the last sprout.
  await page.click('#mode-sessions-btn'); await page.clock.runFor(100); await page.keyboard.press('1'); await page.clock.runFor(200);
  await page.keyboard.press('p'); await page.clock.runFor(300);
  await ans(true); await page.clock.runFor(200);
  const after = await page.textContent('#game-arena .arena-name');
  await page.clock.runFor(1500);
  const next = await page.textContent('#game-arena .arena-name');
  check(after !== 'New seed' && next === 'New seed', 'garden shows the new question\'s seed: ' + after + ' → ' + next);
  await page.click('#game-exit-btn'); await page.click('#game-quit-btn'); await page.clock.runFor(300);
  // Delve outfitter: buy a sword, start a run, durability drops.
  await page.evaluate(() => { window.StudyApp.state.gameData.delve.lanterns = 500; });
  await page.evaluate(() => window.StudyApp.showScreen('home')); await page.clock.runFor(100);
  await page.keyboard.press('g'); await page.clock.runFor(100);
  const tiles = await page.$$eval('#games-grid .checkpoint-tile', e => e.map(x => x.textContent));
  await page.keyboard.press(String(tiles.findIndex(t => /Deep Delve/.test(t)) + 1)); await page.clock.runFor(200);
  await page.keyboard.press('s'); await page.clock.runFor(200);
  check(await page.isVisible('#camp-modal'), 'S opens camp');
  const tabs = await page.$$eval('#camp-tabs button', e => e.map(x => x.textContent));
  check(tabs.join() === 'Upgrades,Outfitter,Relic codex,Bestiary', 'camp tabs: ' + tabs.join());
  await page.click('#camp-tabs button[data-tab="outfitter"]'); await page.clock.runFor(100);
  await page.click('#camp-list .shop-card:has-text("Steel Sword") button'); await page.clock.runFor(100);
  let gear = await page.evaluate(() => window.StudyApp.state.gameData.delve.gear.weapon);
  check(gear && gear.id === 'steelsword' && gear.runs === 3, 'sword bought with 3 runs: ' + JSON.stringify(gear));
  await page.keyboard.press('Escape'); await page.clock.runFor(100);
  await page.click('#game-start-btn'); await page.clock.runFor(300);
  gear = await page.evaluate(() => window.StudyApp.state.gameData.delve.gear.weapon);
  const gb = await page.evaluate(() => window.StudyApp.__test.game().delve.run.gearBonus);
  check(gear.runs === 2 && gb.dmg === 2, 'a run uses one run of durability and gives +2 damage');
  check((await page.textContent('#game-stats')).includes('1 / 100'), 'floor counter out of 100');
  // Rooms are numbered for the keys.
  const keysOnMap = await page.$$eval('.dv-node.reach', e => e.map(x => x.dataset.key));
  check(keysOnMap.length >= 1 && keysOnMap[0] === '1', 'map rooms numbered: ' + keysOnMap.join());
  await page.keyboard.press('1'); await page.clock.runFor(300);
  check(!(await page.isVisible('.dv-node.reach[data-key="1"]')) || await page.isVisible('#game-question-pane') || await page.isVisible('#game-idle-actions button'), '1 enters a room');
  await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'shot.png') });
  await b.close();
})();
