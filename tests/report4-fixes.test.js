// Fixes from bug report 4 (the review after the final pass): saves, games
// and pictures.
const { chromium } = require('./browser');
const path = require('path');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const url = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const mkBank = (t) => 'unit_title: ' + t + '\n\n' + [1, 2, 3].map(i => `question: Q${i}?\nanswer: A${i}\nmedium_fake_answer_1: B\nmedium_fake_answer_2: C\nmedium_fake_answer_3: D\nhard_fake_answer_1: E\nhard_fake_answer_2: F\nhard_fake_answer_3: G\n`).join('\n');

(async () => {
  const b = await chromium.launch();
  const mk = async () => {
    const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    await page.addInitScript(() => {
      window.__STUDY_TEST_NO_MINIGAMES = true;
      window.__disk = {}; window.__failNext = 0; window.__writes = []; window.__calls = []; window.__delay = 0; window.__banks = [];
      window.__TAURI__ = { core: { invoke: async (cmd, a) => {
        window.__calls.push(cmd);
        if (cmd === 'write_progress') {
          if (window.__delay) await new Promise(r => setTimeout(r, window.__delay));
          if (window.__failNext > 0) { window.__failNext--; throw 'disk hiccup'; }
          window.__disk[a.name] = a.json; window.__writes.push([a.name, JSON.parse(a.json).completed.length]); return 'bank-1';
        }
        if (cmd === 'read_progress') return window.__disk[a.name] || '';
        if (cmd === 'list_bank_meta') return window.__banks.map(n => [n.name, 1, 1, 0]);
        if (cmd === 'read_bank') return window.__banks.find(n => n.name === a.name).text;
        if (cmd === 'rename_bank') { window.__renamed = a.name; return [a.newTitle + '.txt', window.__banks.find(n => n.name === a.name).text.replace(/^unit_title: .*/, 'unit_title: ' + a.newTitle), '']; }
        if (cmd === 'data_folder') return '/data';
        if (cmd === 'save_checkpoint') { if (window.__failCheckpoint) throw 'disk full'; return null; }
        return '';
      } } };
    });
    await page.goto(url);
    return page;
  };

  // 1. A newer successful save settles an older failure: quit doesn't
  //    complain, and the old progress is never written back.
  let page = await mk();
  await page.evaluate((t) => StudyApp.loadUnitText(t), mkBank('A'));
  await page.waitForTimeout(100);
  const r1 = await page.evaluate(async (other) => {
    const S = StudyApp.state, T = StudyApp.__test;
    window.__failNext = 1;
    T.mark(S.unit.questions[0]); await T.persist();
    T.mark(S.unit.questions[1]); await T.persist();
    const flush1 = await T.flush();
    StudyApp.loadUnitText(other);
    await new Promise(r => setTimeout(r, 50));
    const flush2 = await T.flush();
    return { flush1, flush2, finalA: JSON.parse(window.__disk['A']).completed.length };
  }, mkBank('Z'));
  check(r1.flush1 === true, 'a later good save clears the earlier failure');
  check(r1.flush2 === true && r1.finalA === 2, 'older progress is never written over newer: ' + JSON.stringify(r1));
  await page.close();

  // 2. Reopening a bank while its save is still being written shows it.
  page = await mk();
  await page.evaluate((t) => StudyApp.loadUnitText(t), mkBank('A'));
  await page.waitForTimeout(100);
  const r2 = await page.evaluate(async (t) => {
    const S = StudyApp.state, T = StudyApp.__test;
    window.__delay = 150;
    T.mark(S.unit.questions[0]); T.persist();
    await new Promise(r => setTimeout(r, 10));
    T.mark(S.unit.questions[1]); T.persist();
    await new Promise(r => setTimeout(r, 10));
    StudyApp.loadUnitText(t);
    await S.completedReady;
    const shown = Object.keys(S.completed).length;
    T.mark(S.unit.questions[2]); await T.persist(); await T.flush();
    return { shown, final: JSON.parse(window.__disk['A']).completed.length };
  }, mkBank('A'));
  check(r2.shown === 2 && r2.final === 3, 'a save in flight is in the reopened bank: ' + JSON.stringify(r2));
  await page.close();

  // 3. Renaming the open bank onto a title deleted earlier: it saves again.
  page = await mk();
  await page.evaluate((t) => { window.__banks = [{ name: 'Chem.txt', text: t }]; StudyApp.loadUnitText(t); }, mkBank('Chem'));
  await page.waitForTimeout(100);
  await page.evaluate(() => StudyApp.__test.markDeleted('Bio'));
  await page.evaluate(() => document.querySelector('#open-saved-bank-btn').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('#bank-grid button')].find(x => x.textContent === 'Rename').click());
  await page.fill('#bank-rename-input', 'Bio');
  await page.click('#bank-rename-save-btn');
  await page.waitForTimeout(300);
  const r3 = await page.evaluate(async () => {
    const S = StudyApp.state, T = StudyApp.__test;
    window.__writes = [];
    T.mark(S.unit.questions[0]); const ok = await T.persist();
    return { title: S.unit.unitTitle, ok, writes: window.__writes.length };
  });
  check(r3.title === 'Bio' && r3.ok === true && r3.writes === 1, 'progress saves after renaming onto a deleted title: ' + JSON.stringify(r3));
  await page.close();

  // 3b. Two files with one title: renaming one doesn't drag along the open
  //     bank that came from the other file; renaming its own file does.
  page = await mk();
  await page.evaluate((t) => { window.__banks = [{ name: 'Cells.txt', text: t }, { name: 'Cells copy.txt', text: t }]; }, mkBank('Cells'));
  await page.waitForTimeout(100);
  const openTile = async (file) => {
    await page.evaluate(() => { StudyApp.showScreen('landing'); document.querySelector('#open-saved-bank-btn').click(); });
    await page.waitForTimeout(300);
    await page.evaluate((f) => [...document.querySelectorAll('#bank-grid .checkpoint-tile')].find(t => t.textContent.includes('File ' + f + ' has')).click(), file);
    await page.waitForTimeout(300);
  };
  const renameTile = async (file, title) => {
    await page.evaluate(() => { StudyApp.showScreen('landing'); document.querySelector('#open-saved-bank-btn').click(); });
    await page.waitForTimeout(300);
    await page.evaluate((f) => [...document.querySelectorAll('#bank-grid .checkpoint-tile')].find(t => t.textContent.includes('File ' + f + ' has')).querySelector('button[aria-label^="Rename"]').click(), file);
    await page.fill('#bank-rename-input', title);
    await page.click('#bank-rename-save-btn');
    await page.waitForTimeout(300);
  };
  await openTile('Cells copy.txt');
  await renameTile('Cells.txt', 'Organs');
  check(await page.evaluate(() => window.__renamed) === 'Cells.txt' && await page.evaluate(() => StudyApp.state.unit.unitTitle) === 'Cells', 'the open copy stays as it was when the other file is renamed');
  await page.evaluate(() => { window.__banks = window.__banks.filter(b => b.name !== 'Cells.txt'); window.__banks.push({ name: 'Cells.txt', text: window.__banks[0].text }); });
  await renameTile('Cells copy.txt', 'Tissues');
  check(await page.evaluate(() => StudyApp.state.unit.unitTitle) === 'Tissues', 'renaming its own file follows');
  await page.close();

  // 4. A checkpoint deleted after a failed save isn't recreated on quit,
  //    and a late failure of an older attempt doesn't bring a retry back.
  page = await mk();
  const r4 = await page.evaluate(async () => {
    const T = StudyApp.__test;
    let saves = 0;
    await T.retryable('checkpoint:cp1', () => { saves++; return Promise.reject(new Error('disk full')); }).catch(() => {});
    await new Promise(r => setTimeout(r, 20));
    const before = T.failedWrites();
    await T.deleteCheckpoint('cp1');
    const after = T.failedWrites();
    await T.flush();
    // Attempt 1 is slow and fails after attempt 2 succeeded.
    let fail;
    const slow = new Promise((_, rej) => { fail = rej; });
    T.retryable('bank:X', () => slow).catch(() => {});
    await T.retryable('bank:X', () => Promise.resolve(true));
    fail(new Error('late'));
    await new Promise(r => setTimeout(r, 20));
    return { before, after, savesAfterQuit: saves, late: T.failedWrites() };
  });
  check(r4.before === 1 && r4.after === 0 && r4.savesAfterQuit === 1, 'a deleted checkpoint is not saved again on quit: ' + JSON.stringify(r4));
  check(r4.late === 0, 'a late failure of an older attempt is ignored');
  await page.close();

  // 5. The fallback bank listing shows damaged progress as damaged.
  page = await mk();
  const r5 = await page.evaluate(() => {
    const info = StudyApp.__test.describeBank('A.txt', 'unit_title: A\n\nquestion: Q?\nanswer: A\nmedium_fake_answer_1: B\nmedium_fake_answer_2: C\nmedium_fake_answer_3: D\nhard_fake_answer_1: E\nhard_fake_answer_2: F\nhard_fake_answer_3: G\n', { error: 'x' });
    return info.progressError;
  });
  check(r5 === 'x', 'damaged progress is reported on the tile');
  await page.close();

  // ---------------------------- games ----------------------------
  const big = path.join(__dirname, 'fixtures', 'big.txt');
  const gamePage = async () => {
    const g = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    g.on('pageerror', e => console.log('PAGEERROR', e.message));
    await g.clock.install();
    await g.goto(url);
    await g.setInputFiles('#file-input', big); await g.clock.runFor(300);
    return g;
  };
  const openGame = async (g, name) => {
    await g.click('#mode-games-btn'); await g.clock.runFor(100);
    const tiles = await g.$$eval('#games-grid .checkpoint-tile', e => e.map(x => x.textContent));
    await g.click(`#games-grid .checkpoint-tile:nth-child(${tiles.findIndex(t => t.includes(name)) + 1})`); await g.clock.runFor(200);
  };

  // A long frame (a stall under the away limit) after an answer doesn't
  // eat into the next question's time.
  let g = await gamePage();
  await g.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  await g.evaluate(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  await openGame(g, 'Boss Battle');
  await g.click('#game-start-btn'); await g.clock.runFor(300);
  await g.keyboard.press('1'); await g.clock.runFor(20);
  const turn0 = await g.evaluate(() => StudyApp.__test.game().turn);
  await g.clock.fastForward(6000);
  const lf = await g.evaluate(() => { const x = StudyApp.__test.game(); return { turn: x.turn, spent: x.current.spent }; });
  check(lf.turn === turn0 + 1 && lf.spent === 0, 'the next question starts fresh after a long frame: ' + JSON.stringify(lf));
  await g.close();

  // Warehouse Tycoon: a crate stays highlighted while it's multiplying the order.
  g = await gamePage();
  await g.evaluate(() => { window.__STUDY_TEST_NO_MINIGAMES = true; const t = StudyApp.state.gameData.tycoon; t.money = 1e9; t.day = 6; });
  await openGame(g, 'Warehouse Tycoon');
  await g.click('#game-start-btn'); await g.clock.runFor(800);
  const pu = () => g.$$eval('#ty-pu-list button', e => e.map(x => x.textContent + (x.classList.contains('ty-pu-active') ? '[A]' : '')));
  await g.click('#ty-pu-list button:has-text("×2 crate")'); await g.clock.runFor(100);
  check((await pu()).some(t => /×2 crate.*\[A\]/.test(t)), 'a bought crate is highlighted');
  await g.keyboard.press('1'); await g.clock.runFor(1500);
  const during = await pu();
  check(during.some(t => /×2 crate in effect\[A\]/.test(t)), 'and still highlighted during the order it multiplies: ' + during.join(', '));
  await g.close();

  // Deep Delve: losing a minigame at 1 HP locks the answers at once.
  g = await gamePage();
  await openGame(g, 'Deep Delve');
  await g.uncheck('#game-type-tf').catch(() => {});
  await g.click('#game-start-btn'); await g.clock.runFor(300);
  await g.evaluate(() => { const x = StudyApp.__test.game(); x.delve.run.floor = 2; x.delve.run.map.rows[0].forEach(n => n.type = 'fight'); });
  await g.keyboard.press('1'); await g.clock.runFor(200);
  await g.evaluate(() => {
    const x = StudyApp.__test.game(); x.delve.run.hp = 1; x.delve.run.relics = x.delve.run.relics.filter(r => r !== 'phoenix');
    // A minigame on this question, right away.
    if (x.current) { x.current.mgAt = x.current.spent; x.current.mgLevel = 1; x.current.mgDone = false; }
  });
  await g.clock.runFor(300);
  const mgUp = await g.evaluate(() => !!StudyApp.__test.game().minigame);
  check(mgUp, 'a minigame came up');
  if (mgUp) {
    for (let i = 0; i < 60 && await g.evaluate(() => { const M = StudyApp.__test.game().minigame; return M && !M.done; }); i++) await g.clock.runFor(100);
    await g.clock.runFor(750);
    const st = await g.evaluate(() => { const x = StudyApp.__test.game(); return { hp: x.delve.run.hp, locked: x.locked }; });
    await g.keyboard.press('1'); await g.clock.runFor(50);
    const answered = await g.evaluate(() => StudyApp.__test.game().answered);
    check(st.hp === 0 && st.locked && answered === 0, 'no answers after a fatal minigame loss: ' + JSON.stringify(st));
    await g.clock.runFor(2000);
    check(await g.isVisible('#screen-game-results'), 'and the run ends');
  }
  await g.close();

  // --------------------------- pictures ---------------------------
  // Hotspot pictures from the keyboard: Space with no cursor shows one
  // (instead of scrolling), Enter picks, and a redraw keeps the focus.
  page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  await page.goto(url);
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'pictures.zip'));
  await page.waitForFunction(() => StudyApp.state.screen === 'home', null, { timeout: 10000 });
  await page.click('#mode-quiz-btn');
  await page.check('#instant-feedback');
  await page.click('#quiz-start-btn');
  await page.waitForTimeout(200);
  let found = false;
  for (let i = 0; i < 8 && !(found = await page.isVisible('#quiz-figure .hs-pad')); i++) { await page.click('#quiz-next-btn'); await page.waitForTimeout(100); }
  check(found, 'a hotspot question in the quiz');
  if (found) {
    await page.focus('#quiz-figure .hs-pad');
    const y0 = await page.evaluate(() => window.scrollY);
    await page.keyboard.press(' ');
    const cursor = await page.evaluate(() => { const m = document.querySelector('#quiz-figure .hs-pad .cursor'); return !!m && !m.classList.contains('hidden'); });
    check(cursor && await page.evaluate(() => window.scrollY) === y0, 'Space shows a cursor and doesn\'t scroll');
    check(/^Cursor 50% across, 50% down/.test(await page.textContent('#sr-status')), 'the cursor is announced to screen readers: ' + await page.textContent('#sr-status'));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    const kept = await page.evaluate(() => { const a = document.activeElement; return !!a && a.classList.contains('hs-pad') && document.getElementById('quiz-figure').contains(a); });
    check(kept, 'the picture keeps the keyboard focus after a pick');
    check(/^Picked 5[0-9]% across/.test(await page.textContent('#sr-status')), 'and the pick is announced');
  }
  await page.close();

  // Pictures from a .zip are shown from the Blob made when they were
  // measured, not decoded again from the bank text.
  page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => {
    window.__STUDY_TEST_NO_MINIGAMES = true; window.__dataFetches = 0;
    const real = window.fetch;
    window.fetch = function (u) { if (String(u).startsWith('data:')) window.__dataFetches++; return real.apply(this, arguments); };
  });
  await page.goto(url);
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'pictures.zip'));
  await page.waitForFunction(() => { const i = document.querySelector('#qa-list img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  check(await page.evaluate(() => window.__dataFetches) === 0, 'zip pictures are shown without decoding them again');
  await page.close();

  // A bank whose pictures live in the desktop app's folder is refused in a
  // browser, with a reason, instead of showing broken pictures.
  page = await b.newPage();
  await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  await page.goto(url);
  const asset = await page.evaluate(() => StudyApp.loadUnitText('unit_title: P\n\nquestion: Where?\nhotspot: 50, 50\n\n=== images (added by Study Website from a .zip; don\'t edit below this line) ===\nImg.Q1.png 10x10 #abcdef12: asset:' + 'a'.repeat(64) + '.png\n'));
  check(asset && asset.ok === false && /desktop app/.test(asset.error), 'stored pictures are refused outside the desktop app: ' + (asset && asset.error));
  await page.close();

  await b.close();
})();
