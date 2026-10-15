// Fixes from the 1.9.1 bugs report (B01-B13): saves, tabs, pictures,
// checkpoints, rename, keys, the garden and quitting.
const { chromium } = require('./browser');
const path = require('path');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const url = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const block = (q, a) => `question: ${q}\nanswer: ${a}\nmedium_fake_answer_1: B\nmedium_fake_answer_2: C\nmedium_fake_answer_3: D\nhard_fake_answer_1: E\nhard_fake_answer_2: F\nhard_fake_answer_3: G\n`;
const mkBank = (t) => 'unit_title: ' + t + '\n\n' + [1, 2, 3].map(i => block('Q' + i + '?', 'A' + i)).join('\n');
const SECTION = "=== images (added by Study Website from a .zip; don't edit below this line) ===";
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const svg = (w, h) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="red"/></svg>`).toString('base64');
const picBank = (t, line) => 'unit_title: ' + t + '\n\n' + block('Where?', 'Here') + '\n' + SECTION + '\n' + line + '\n';

// A desktop bridge that keeps files in memory.
const desktop = () => {
  window.__STUDY_TEST_NO_MINIGAMES = true;
  window.__disk = {}; window.__writes = []; window.__calls = []; window.__banks = []; window.__slow = {}; window.__fail = false;
  window.__TAURI__ = { core: { invoke: async (cmd, a) => {
    window.__calls.push([cmd, a]);
    if (cmd === 'write_progress') {
      if (window.__fail) throw 'disk hiccup';
      window.__disk[a.name] = a.json; window.__writes.push(a.name); return JSON.parse(a.json).bankId || null;
    }
    if (cmd === 'read_progress') {
      if (window.__slow[a.name]) await new Promise(r => setTimeout(r, window.__slow[a.name]));
      return window.__disk[a.name] || '';
    }
    if (cmd === 'list_bank_meta') return window.__banks.map(n => [n.name, 1, 1, 0, 0]);
    if (cmd === 'read_banks') return a.names.map(x => [window.__banks.find(n => n.name === x).text, '', '']);
    if (cmd === 'read_bank') return window.__banks.find(n => n.name === a.name).text;
    if (cmd === 'rename_bank') { window.__renamed = (window.__renamed || 0) + 1; return [a.newTitle + '.txt', window.__banks.find(n => n.name === a.name).text.replace(/^unit_title: .*/, 'unit_title: ' + a.newTitle), '']; }
    if (cmd === 'save_checkpoint') { window.__checkpoint = a.json; return null; }
    if (cmd === 'quit_app') { if (!a.force && window.__syncFails) throw 'Could not finish saving progress.json: I/O error'; window.__quit = a.force ? 'forced' : 'clean'; return null; }
    if (cmd === 'finish_saves') { if (window.__syncFails) throw 'Could not finish saving progress.json: I/O error'; return null; }
    if (cmd === 'data_folder') return '/data';
    return '';
  } } };
};
const toasts = (page) => page.$$eval('.toast', e => e.map(x => x.textContent).join(' | '));

(async () => {
  const b = await chromium.launch();
  const open = async (init) => {
    const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    if (init) await page.addInitScript(init); else await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
    await page.goto(url);
    return page;
  };

  // B01: game data changed without a save of its own (XP short of a level,
  // on an already completed bank) is written by a flush, and once only.
  let page = await open(desktop);
  await page.evaluate((t) => StudyApp.loadUnitText(t), mkBank('XP'));
  await page.waitForTimeout(100);
  const xp = await page.evaluate(async () => {
    const S = StudyApp.state, T = StudyApp.__test;
    S.unit.questions.forEach(q => T.mark(q)); await T.persist();
    const before = window.__writes.length;
    S.gameData.progress = S.gameData.progress || {}; S.gameData.progress.boss = { xp: 10, stats: {}, ach: {}, challenges: null };
    const ok = await T.flush();
    const stored = JSON.parse(window.__disk.XP).games.progress.boss.xp;
    await T.flush();
    return { ok, stored, live: S.gameData.progress.boss.xp, writes: window.__writes.length - before };
  });
  check(xp.ok && xp.stored === xp.live && xp.writes === 1, 'B01 a flush saves XP that never asked for a save, once: ' + JSON.stringify(xp));
  await page.close();

  // B02: two tabs of one browser with the same bank: only the first saves;
  // the second says so, and takes over (keeping its marks) when the first lets go.
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  const tabA = await ctx.newPage(), tabB = await ctx.newPage();
  for (const t of [tabA, tabB]) { t.on('pageerror', e => console.log('PAGEERROR', e.message)); await t.goto(url); }
  await tabA.evaluate((t) => StudyApp.loadUnitText(t), mkBank('Tabs')); await tabA.waitForTimeout(150);
  await tabB.evaluate((t) => StudyApp.loadUnitText(t), mkBank('Tabs')); await tabB.waitForTimeout(150);
  check(/open in another tab/.test(await toasts(tabB)), 'B02 the second tab says the bank is open in another tab');
  await tabA.evaluate(async () => { StudyApp.__test.mark(StudyApp.state.unit.questions[0]); await StudyApp.__test.persist(); });
  const savedB = await tabB.evaluate(async () => { StudyApp.__test.mark(StudyApp.state.unit.questions[1]); return StudyApp.__test.persist(); });
  const stored1 = await tabA.evaluate(() => JSON.parse(localStorage.getItem('study-website-completed:Tabs')).completed.length);
  check(savedB === false && stored1 === 1, 'B02 the second tab doesn\'t write over the first: ' + JSON.stringify({ savedB, stored1 }));
  await tabA.close(); await tabB.waitForTimeout(300);
  const after = await tabB.evaluate(async () => { const ok = await StudyApp.__test.flush(); return { ok, n: JSON.parse(localStorage.getItem('study-website-completed:Tabs')).completed.length, shown: StudyApp.state.unit && document.getElementById('completed-summary').textContent }; });
  check(after.ok && after.n === 2 && /^2 of/.test(after.shown), 'B02 when the first tab closes, the second saves both marks: ' + JSON.stringify(after));
  await ctx.close();

  // B03: a desktop checkpoint (pictures in the app's folder) is refused by
  // Resume in a browser, before anything changes.
  page = await open();
  await page.evaluate((t) => StudyApp.loadUnitText(t), mkBank('Open'));
  await page.waitForTimeout(100);
  const assetBank = picBank('Desk', 'Img.Q1.png 1x1 #' + 'a'.repeat(28) + ': asset:' + 'b'.repeat(64) + '.png');
  const session = { format: 'study-website-session', version: 1, savedAt: '', unitTitle: 'Desk', answeredCount: 0, totalCount: 1, unitText: assetBank, mode: 'exam', seed: 1,
    options: { count: 1, difficulty: 'easy', types: ['mc'] }, answers: [null], index: 0, showProgress: true };
  await page.setInputFiles('#resume-file-input', { name: 's.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(session)) });
  await page.waitForTimeout(300);
  check(/desktop app's picture folder/.test(await toasts(page)) && await page.evaluate(() => StudyApp.state.unit.unitTitle) === 'Open', 'B03 Resume refuses desktop pictures in a browser and keeps the open bank');
  await page.close();

  // B04: pictures written into a .txt are checked like a .zip's.
  page = await open();
  const tryTxt = async (text) => {
    await page.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); StudyApp.showScreen('landing'); });
    await page.setInputFiles('#file-input', { name: 'p.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    await page.waitForTimeout(500);
    return { screen: await page.evaluate(() => StudyApp.state.screen), toast: await toasts(page) };
  };
  let r = await tryTxt(picBank('Bad', 'Img.Q1.png 1x1: data:image/png;base64,bm90YXBuZw=='));
  check(r.screen === 'landing' && /isn't a picture/.test(r.toast), 'B04 a broken inline picture is refused: ' + r.toast);
  r = await tryTxt(picBank('Huge', 'Img.Q1.svg 12001x1: ' + svg(12001, 1)));
  check(r.screen === 'landing' && /too large/.test(r.toast), 'B04 an inline picture over 12,000 pixels is refused: ' + r.toast);
  r = await tryTxt(picBank('Shape', 'Img.Q1.svg 100x100: ' + svg(200, 50)));
  check(r.screen === 'landing' && /says 100×100/.test(r.toast), 'B04 a picture of another shape than stated is refused: ' + r.toast);
  r = await tryTxt(picBank('Good', 'Img.Q1.png 1x1: ' + PNG));
  check(r.screen === 'home', 'B04 a real picture of the stated size loads: ' + r.toast);
  r = await tryTxt('unit_title: Wide\n\n' + block('界'.repeat(1800000) + '?', 'A'));
  check(r.screen === 'landing' && /5 MB/.test(r.toast), 'B11 the 5 MB text limit counts bytes, not characters: ' + r.toast.slice(0, 80));
  await page.close();

  // B05: an exam saved while the new bank's progress is still loading
  // never carries the previous bank's ID.
  page = await open(desktop);
  await page.evaluate((t) => { window.__disk.A = JSON.stringify({ format: 'study-website-completed', version: 3, unitTitle: 'A', bankId: 'bank-aa', completed: [] });
    window.__disk.B = JSON.stringify({ format: 'study-website-completed', version: 3, unitTitle: 'B', bankId: 'bank-bb', completed: [] });
    StudyApp.loadUnitText(t); }, mkBank('A'));
  await page.waitForTimeout(100);
  await page.evaluate((t) => { window.__slow.B = 500; StudyApp.loadUnitText(t); StudyApp.startExam({ count: 3, difficulty: 'easy', types: ['mc'] }, 7); document.getElementById('save-progress-btn').click(); }, mkBank('B'));
  const idNow = await page.evaluate(() => StudyApp.state.bankId);
  await page.waitForTimeout(800);
  const cp = await page.evaluate(() => window.__checkpoint && JSON.parse(window.__checkpoint));
  check(idNow === null && cp && cp.unitTitle === 'B' && cp.bankId === 'bank-bb', 'B05 the checkpoint carries its own bank\'s ID: ' + JSON.stringify({ idNow, id: cp && cp.bankId }));
  await page.close();

  // B06: a rename waits for this bank's progress to save; after a refused
  // one and a working one, nothing is written under the old title again.
  page = await open(desktop);
  await page.evaluate((t) => { window.__banks = [{ name: 'Old.txt', text: t }]; StudyApp.loadUnitText(t); }, mkBank('Old'));
  await page.waitForTimeout(100);
  await page.evaluate(async () => { window.__fail = true; StudyApp.__test.mark(StudyApp.state.unit.questions[0]); await StudyApp.__test.persist(); });
  const rename = async (title) => {
    await page.evaluate(() => { StudyApp.showScreen('landing'); document.querySelector('#open-saved-bank-btn').click(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => [...document.querySelectorAll('#bank-grid button')].find(x => x.textContent === 'Rename').click());
    await page.fill('#bank-rename-input', title);
    await page.click('#bank-rename-save-btn');
    await page.waitForTimeout(300);
  };
  await rename('New');
  check(!(await page.evaluate(() => window.__renamed)) && /wasn't renamed/.test(await toasts(page)), 'B06 a rename is refused while this bank\'s progress can\'t be saved');
  await page.evaluate(() => { window.__fail = false; document.getElementById('bank-rename-modal').classList.add('hidden'); });
  await rename('New');
  const r6 = await page.evaluate(async () => { window.__writes = []; StudyApp.__test.mark(StudyApp.state.unit.questions[1]); const ok = await StudyApp.__test.flush(); return { ok, renamed: window.__renamed, title: StudyApp.state.unit.unitTitle, writes: window.__writes }; });
  check(r6.renamed === 1 && r6.title === 'New' && r6.ok && r6.writes.every(w => w === 'New') && r6.writes.length > 0, 'B06 once it works, later saves go to the new title only: ' + JSON.stringify(r6));
  await page.close();

  // B07: a held Enter or Space can't pick a spot; two presses still can.
  page = await open();
  await page.evaluate((t) => { StudyApp.loadUnitText(t); StudyApp.startExam({ count: 1, difficulty: 'easy', types: ['mc'] }, 1); },
    'unit_title: Spot\n\nquestion: Where?\nhotspot: 50, 50\n\n' + SECTION + '\nImg.Q1.png 1x1: ' + PNG + '\n');
  await page.waitForTimeout(200);
  const res = await page.evaluate(() => {
    const pad = document.querySelector('.hs-pad:not(.locked)');
    if (!pad) return { none: true };
    pad.focus();
    const key = (k, repeat) => pad.dispatchEvent(new KeyboardEvent('keydown', { key: k, repeat, bubbles: true, cancelable: true }));
    const answer = () => StudyApp.state.quiz.answers[0];
    key('Enter', true); key('Enter', true); key(' ', true);
    const afterHeld = answer();
    key('Enter', false); key('Enter', true); const afterOne = answer();
    key('Enter', false);
    return { afterHeld, afterOne, afterTwo: answer() };
  });
  check(!res.none && res.afterHeld == null && res.afterOne == null && /^hs:/.test(res.afterTwo || ''), 'B07 held keys pick nothing; two presses pick: ' + JSON.stringify(res));
  await page.close();

  // B08: in Fishing, Enter on a focused button does that button's job.
  page = await open(() => { window.__STUDY_TEST_NO_MINIGAMES = true; window.__TAURI__ = { core: { invoke: async () => '' } }; });
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'big.txt')); await page.waitForTimeout(300);
  await page.click('#mode-games-btn'); await page.waitForTimeout(100);
  const tiles = await page.$$eval('#games-grid .checkpoint-tile', e => e.map(x => x.textContent));
  await page.click(`#games-grid .checkpoint-tile:nth-child(${tiles.findIndex(t => t.includes('Fishing')) + 1})`); await page.waitForTimeout(200);
  await page.click('#game-start-btn'); await page.waitForTimeout(300);
  await page.focus('#game-exit-btn');
  await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  const fish = await page.evaluate(() => ({ phase: StudyApp.__test.game().fish.phase, modal: [...document.querySelectorAll('.modal-overlay:not(.hidden)')].map(m => m.id) }));
  check(fish.phase === 'idle' && fish.modal.length === 1, 'B08 Enter on Return Home asks to leave instead of casting: ' + JSON.stringify(fish));
  await page.click('#game-resume-btn'); await page.waitForTimeout(100);
  await page.focus('#game-cast-btn');
  await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  check(await page.evaluate(() => StudyApp.__test.game().fish.phase) !== 'idle', 'B08 Enter on Cast still casts');
  await page.close();

  // B09: the garden's settings wait for the bank's progress to load.
  page = await open(desktop);
  await page.evaluate((t) => { window.__disk.G = JSON.stringify({ format: 'study-website-completed', version: 3, unitTitle: 'G', completed: [], games: { garden: { seedSize: 5 } } }); window.__slow.G = 500; StudyApp.loadUnitText(t); }, mkBank('G'));
  await page.evaluate(() => document.getElementById('mode-garden-btn').click());
  const during = await page.evaluate(() => ['garden-seed-size', 'garden-shop-btn', 'garden-seed-btn'].map(id => document.getElementById(id).disabled));
  await page.waitForTimeout(800);
  const done = await page.evaluate(() => ['garden-seed-size', 'garden-shop-btn'].map(id => document.getElementById(id).disabled));
  check(during.every(Boolean) && done.every(x => !x), 'B09 garden controls are off until progress loads: ' + JSON.stringify({ during, done }));
  await page.close();

  // B10: the final sync failing keeps the app open and says so; Quit anyway still quits.
  page = await open(desktop);
  await page.evaluate((t) => { window.__syncFails = true; StudyApp.loadUnitText(t); }, mkBank('Q'));
  await page.waitForTimeout(100);
  await page.evaluate(() => document.getElementById('quit-btn').click());
  await page.waitForTimeout(300);
  let q = await page.evaluate(() => ({ quit: window.__quit || null, modal: !document.getElementById('quit-modal').classList.contains('hidden'), hint: document.getElementById('quit-hint').textContent }));
  check(q.quit === null && q.modal && /Could not finish saving/.test(q.hint), 'B10 a failed final sync keeps the window open: ' + JSON.stringify(q));
  await page.evaluate(() => { window.__syncFails = false; document.getElementById('quit-retry-btn').click(); });
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__quit) === 'clean', 'B10 trying again quits once the sync works');
  await page.close();

  await b.close();
})();
