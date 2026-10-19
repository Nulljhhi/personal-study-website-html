// Fixes from the review of 1.9.9 (B01-B06, R04): tab takeover during a
// game, checkpoint snapshots, cached picture sizes, notices over a game,
// game reset, checkpoint list order, and browsers without Web Locks.
const { chromium } = require('./browser');
const path = require('path');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const url = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const big = path.join(__dirname, 'fixtures', 'big.txt');
const block = (q, a) => `question: ${q}\nanswer: ${a}\nmedium_fake_answer_1: B\nmedium_fake_answer_2: C\nmedium_fake_answer_3: D\nhard_fake_answer_1: E\nhard_fake_answer_2: F\nhard_fake_answer_3: G\n`;
const mkBank = (t) => 'unit_title: ' + t + '\n\n' + [1, 2, 3].map(i => block('Q' + i + '?', 'A' + i)).join('\n');
const SECTION = "=== images (added by Study Website from a .zip; don't edit below this line) ===";
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const toasts = (page) => page.$$eval('.toast', e => e.map(x => x.textContent).join(' | '));

const desktop = () => {
  window.__STUDY_TEST_NO_MINIGAMES = true;
  window.__disk = {}; window.__slow = {}; window.__listeners = {}; window.__metaCalls = 0;
  window.__TAURI__ = {
    event: { listen: async (name, fn) => { window.__listeners[name] = fn; return () => {}; } },
    core: { invoke: async (cmd, a) => {
      if (cmd === 'write_progress') { window.__disk[a.name] = a.json; return null; }
      if (cmd === 'read_progress') { if (window.__slow[a.name]) await new Promise(r => setTimeout(r, window.__slow[a.name])); return window.__disk[a.name] || ''; }
      if (cmd === 'save_checkpoint') { window.__checkpoint = a.json; return null; }
      if (cmd === 'list_checkpoint_meta') {
        const n = ++window.__metaCalls;
        // The first list answers late, and describes a checkpoint since deleted.
        if (n === 1) { await new Promise(r => setTimeout(r, 800)); return [['old', 1, 1]]; }
        return [];
      }
      if (cmd === 'read_checkpoint') return window.__oldCheckpoint;
      if (cmd === 'data_folder') return '/data';
      return '';
    } } };
};

(async () => {
  const b = await chromium.launch();
  const open = async (init) => {
    const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    await page.addInitScript(init || (() => { window.__STUDY_TEST_NO_MINIGAMES = true; }));
    await page.goto(url);
    return page;
  };
  const startGame = async (page, name) => {
    await page.click('#mode-games-btn'); await page.waitForTimeout(100);
    const tiles = await page.$$eval('#games-grid .checkpoint-tile', e => e.map(x => x.textContent));
    await page.click(`#games-grid .checkpoint-tile:nth-child(${tiles.findIndex(t => t.includes(name)) + 1})`); await page.waitForTimeout(200);
    await page.click('#game-start-btn'); await page.waitForTimeout(300);
  };

  // B01: a tab that takes a bank over during a game keeps not saving until
  // the game is left, then loads the other tab's newer progress.
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  const tabA = await ctx.newPage(), tabB = await ctx.newPage();
  for (const t of [tabA, tabB]) { t.on('pageerror', e => console.log('PAGEERROR', e.message)); await t.goto(url); }
  const bankText = require('fs').readFileSync(big, 'utf8');
  const title = bankText.match(/unit_title: (.*)/)[1];
  const key = 'study-website-completed:' + title;
  await tabA.setInputFiles('#file-input', big); await tabA.waitForTimeout(300);
  await tabB.setInputFiles('#file-input', big); await tabB.waitForTimeout(300);
  await tabA.evaluate(async () => { StudyApp.__test.mark(StudyApp.state.unit.questions[0]); StudyApp.state.gameData.fishing.coins = 777; await StudyApp.__test.flush(); });
  await startGame(tabB, 'Fishing');
  await tabA.close(); await tabB.waitForTimeout(300);
  const during = await tabB.evaluate(async () => ({ readOnly: StudyApp.state.tabReadOnly, saved: await StudyApp.__test.persist() }));
  const stored = await tabB.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  check(during.readOnly === true && during.saved === false && stored.games.fishing.coins === 777 && stored.completed.length === 1,
    'B01 during the game the tab still doesn\'t save, and the other tab\'s progress is kept: ' + JSON.stringify({ during, coins: stored.games.fishing.coins }));
  await tabB.evaluate(() => StudyApp.showScreen('home')); await tabB.waitForTimeout(300);
  const after = await tabB.evaluate(async (k) => { StudyApp.__test.mark(StudyApp.state.unit.questions[1]); const ok = await StudyApp.__test.flush(); const d = JSON.parse(localStorage.getItem(k)); return { ok, readOnly: StudyApp.state.tabReadOnly, coins: d.games.fishing.coins, n: d.completed.length }; }, key);
  check(after.ok && !after.readOnly && after.coins === 777 && after.n === 2, 'B01 once the game is left, it loads that progress and saves on top of it: ' + JSON.stringify(after));
  await ctx.close();

  // B02: a desktop checkpoint is the attempt as it was when Save was pressed.
  let page = await open(desktop);
  await page.evaluate((t) => { window.__slow.B = 600; StudyApp.loadUnitText(t); StudyApp.startExam({ count: 3, difficulty: 'easy', types: ['mc'] }, 3); document.getElementById('save-progress-btn').click();
    const q = StudyApp.state.quiz; q.answers[0] = q.choices[0].correctSlot; q.index = 1; }, mkBank('B'));
  await page.waitForTimeout(900);
  const cp = await page.evaluate(() => JSON.parse(window.__checkpoint || 'null'));
  check(cp && cp.answeredCount === 0 && cp.answers[0] === null && cp.index === 0, 'B02 answers given after Save aren\'t in the checkpoint: ' + JSON.stringify(cp && { n: cp.answeredCount, a: cp.answers[0], i: cp.index }));
  await page.close();

  // B03: the same picture in a later bank still has its stated size checked.
  page = await open();
  const tryTxt = async (text) => {
    await page.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); StudyApp.showScreen('landing'); });
    await page.setInputFiles('#file-input', { name: 'p.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    await page.waitForTimeout(500);
    return { screen: await page.evaluate(() => StudyApp.state.screen), unit: await page.evaluate(() => StudyApp.state.unit && StudyApp.state.unit.unitTitle), toast: await toasts(page) };
  };
  const pic = (t, size) => 'unit_title: ' + t + '\n\n' + block('Where?', 'Here') + '\n' + SECTION + '\nImg.Q1.png ' + size + ': ' + PNG + '\n';
  let r = await tryTxt(pic('First', '1x1'));
  check(r.screen === 'home', 'B03 the picture loads with its real size');
  r = await tryTxt(pic('Second', '100x20'));
  check(r.screen === 'landing' && r.unit === 'First' && /says 100×20/.test(r.toast), 'B03 the same picture with a wrong size is refused, from the cache too: ' + r.toast);
  r = await tryTxt(pic('Third', '2x1'));
  check(r.screen === 'landing' && /says 2×1/.test(r.toast), 'B03 a small picture has to match exactly');
  await page.close();

  // B04: a notice over a game holds its clock and its keys.
  page = await open(() => { window.__STUDY_TEST_NO_MINIGAMES = true; window.__listeners = {};
    window.__TAURI__ = { event: { listen: async (n, fn) => { window.__listeners[n] = fn; return () => {}; } }, core: { invoke: async () => '' } }; });
  await page.clock.install();
  await page.reload();
  await page.setInputFiles('#file-input', big); await page.clock.runFor(300);
  await page.click('#mode-games-btn'); await page.clock.runFor(100);
  let tiles = await page.$$eval('#games-grid .checkpoint-tile', e => e.map(x => x.textContent));
  await page.click(`#games-grid .checkpoint-tile:nth-child(${tiles.findIndex(t => t.includes('Boss Battle')) + 1})`); await page.clock.runFor(200);
  await page.click('#game-start-btn'); await page.clock.runFor(300);
  await page.evaluate(() => window.__listeners['second-instance']());
  const before = await page.evaluate(() => { const g = StudyApp.__test.game(); return { spent: g.current.spent, answered: g.answered, paused: g.paused }; });
  await page.clock.runFor(1000);
  await page.keyboard.press('1'); await page.clock.runFor(100);
  const held = await page.evaluate(() => { const g = StudyApp.__test.game(); return { spent: g.current.spent, answered: g.answered }; });
  check(before.paused && held.spent === before.spent && held.answered === before.answered, 'B04 the notice stops the clock and the answer keys: ' + JSON.stringify({ before, held }));
  await page.click('#instance-ok-btn'); await page.clock.runFor(500);
  const resumed = await page.evaluate(() => { const g = StudyApp.__test.game(); return { paused: g.paused, spent: g.current.spent }; });
  check(!resumed.paused && resumed.spent > held.spent, 'B04 closing it lets the game go on');
  await page.close();

  // B05: resetting a game's progress rebuilds its own setup straight away.
  page = await open();
  await page.setInputFiles('#file-input', big); await page.waitForTimeout(300);
  await page.evaluate(() => { StudyApp.state.gameData.survival.best = 200; });
  await page.click('#mode-games-btn'); await page.waitForTimeout(100);
  tiles = await page.$$eval('#games-grid .checkpoint-tile', e => e.map(x => x.textContent));
  await page.click(`#games-grid .checkpoint-tile:nth-child(${tiles.findIndex(t => t.includes('Survival')) + 1})`); await page.waitForTimeout(300);
  const open0 = await page.$$eval('#survival-perks input:not([disabled])', e => e.length);
  await page.click('#game-reset-btn'); await page.click('#game-reset-confirm-btn'); await page.waitForTimeout(200);
  const open1 = await page.$$eval('#survival-perks input:not([disabled])', e => e.length);
  const info = await page.textContent('#survival-info');
  check(open0 > open1 && /Best run: 0 correct/.test(info), 'B05 after a reset the perks and text are those of a fresh start: ' + JSON.stringify({ open0, open1, info: info.slice(-60) }));
  await page.close();

  // B06: an older checkpoint list answering late doesn't replace the newest.
  page = await open(desktop);
  await page.evaluate(() => {
    window.__oldCheckpoint = JSON.stringify({ format: 'study-website-session', version: 1, savedAt: '2026-01-01', unitTitle: 'Race', unitText: 'unit_title: Race\n\nquestion: Q?\nanswer: A\nmedium_fake_answer_1: B\nmedium_fake_answer_2: C\nmedium_fake_answer_3: D\nhard_fake_answer_1: E\nhard_fake_answer_2: F\nhard_fake_answer_3: G\n',
      mode: 'exam', seed: 1, options: { count: 1, difficulty: 'easy', types: ['mc'] }, answers: [null], index: 0, showProgress: true });
    const btn = document.querySelector('.resume-session-btn');
    btn.click(); StudyApp.showScreen('landing'); btn.click();
  });
  await page.waitForTimeout(1200);
  const grid = await page.textContent('#checkpoint-grid');
  check(/No checkpoints yet/.test(grid) && !/Race/.test(grid), 'B06 the newest checkpoint list stays: ' + grid.slice(0, 60));
  await page.close();

  // R04: without Web Locks, a tab stops saving once another tab saves the same bank.
  const ctx2 = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx2.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; Object.defineProperty(navigator, 'locks', { value: undefined }); });
  const t1 = await ctx2.newPage(), t2 = await ctx2.newPage();
  for (const t of [t1, t2]) { t.on('pageerror', e => console.log('PAGEERROR', e.message)); await t.goto(url); }
  await t1.evaluate((t) => StudyApp.loadUnitText(t), mkBank('NoLocks')); await t1.waitForTimeout(150);
  await t2.evaluate((t) => StudyApp.loadUnitText(t), mkBank('NoLocks')); await t2.waitForTimeout(150);
  await t1.evaluate(async () => { StudyApp.__test.mark(StudyApp.state.unit.questions[0]); await StudyApp.__test.persist(); });
  await t2.waitForTimeout(200);
  const t2saved = await t2.evaluate(async () => { StudyApp.__test.mark(StudyApp.state.unit.questions[1]); return StudyApp.__test.persist(); });
  const kept = await t1.evaluate(() => JSON.parse(localStorage.getItem('study-website-completed:NoLocks')).completed.length);
  check(t2saved === false && kept === 1 && /Another tab of this browser just saved/.test(await toasts(t2)), 'R04 without locks, the other tab stops saving instead of writing over it');
  await ctx2.close();

  await b.close();
})();
