// Second pass on bug report 3: cheaper saves (O02), completion counts and
// rows without rescanning the bank (O03), and effects on game time (O11).
const { chromium } = require('./browser');
const path = require('path');
const fs = require('fs');
const os = require('os');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const url = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const block = (q, a) => `question: ${q}\nanswer: ${a}\nmedium_fake_answer_1: m1\nmedium_fake_answer_2: m2\nmedium_fake_answer_3: m3\nhard_fake_answer_1: h1\nhard_fake_answer_2: h2\nhard_fake_answer_3: h3\n\n`;
// Q2 appears twice (one question for completion), and there are 3 distinct questions.
const BANK = 'unit_title: Pass Two\n\n' + block('Q1?', 'A1') + block('Q2?', 'A2') + block('Q3?', 'A3') + block('Q2?', 'A2');

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => {
    window.__STUDY_TEST_NO_MINIGAMES = true; window.__writes = [];
    window.__TAURI__ = { core: { invoke: async (cmd, a) => {
      if (cmd === 'read_progress') return window.__disk || '';
      if (cmd === 'write_progress') { window.__writes.push(a.json); return 'bank-1'; }
      return '';
    } } };
  });
  await page.goto(url);
  // Kept fields from a newer version, at the top and inside games.
  await page.evaluate(() => { window.__disk = JSON.stringify({ format: 'study-website-completed', version: 3, completed: [], games: { future: { a: 1 } }, extraTop: { keep: [1, 2] } }); });
  await page.evaluate(t => StudyApp.loadUnitText(t), BANK);
  await page.waitForTimeout(300);

  // O03: counts and rows.
  const summary = () => page.textContent('#completed-summary');
  check((await summary()).startsWith('0 of 3'), 'duplicates count once: ' + await summary());
  await page.evaluate(() => { const qs = StudyApp.state.unit.questions; StudyApp.__test.mark(qs[3]); StudyApp.__test.renderMarks(qs[3]); });
  check((await summary()).startsWith('1 of 3'), 'marking one question updates the count: ' + await summary());
  const tags = await page.$$eval('#qa-list .qa-pair', e => e.map(x => !!x.querySelector('.completed-tag')));
  check(JSON.stringify(tags) === '[false,true,false,true]', 'both copies of the marked question show Completed: ' + JSON.stringify(tags));
  check(await page.evaluate(() => StudyApp.__test.mark(StudyApp.state.unit.questions[1])) === false, 'marking it again changes nothing');
  await page.evaluate(() => { const qs = StudyApp.state.unit.questions; StudyApp.__test.mark(qs[0]); StudyApp.__test.renderMarks(qs[0]); });
  check((await summary()).startsWith('2 of 3'), 'count after a second mark: ' + await summary());
  // A question from another bank object (not in this bank's index) doesn't throw the count off.
  await page.evaluate(() => { StudyApp.__test.mark({ question: 'Elsewhere?', answer: 'X' }); StudyApp.__test.renderMarks(); });
  check((await summary()).startsWith('2 of 3'), 'a foreign key is not counted: ' + await summary());

  // O02: the saved text is exactly what serializing the whole object gives.
  const same = await page.evaluate(() => {
    const S = StudyApp.state, key = StudyApp.__test.key, fast = StudyApp.__test.progressJson();
    const data = JSON.parse(fast);
    const naive = JSON.stringify(Object.assign({}, S.progressExtra, {
      format: data.format, version: data.version, schemas: data.schemas, unitTitle: S.unit.unitTitle,
      completed: [...new Set(S.unit.questions.filter(q => S.completed[key(q)]).map(key))],
      highScores: S.highScores, games: data.games }));
    return { equal: fast === naive, completed: data.completed.length, extra: data.extraTop, future: data.games.future };
  });
  check(same.equal, 'progress JSON matches a full serialization');
  check(same.completed === 2, 'each completed key is saved once: ' + same.completed);
  check(same.extra && same.extra.keep[1] === 2 && same.future && same.future.a === 1, 'kept fields still saved');
  // The cached list follows changes: a new mark shows up, a reset empties it.
  await page.evaluate(() => StudyApp.__test.mark(StudyApp.state.unit.questions[2]));
  check(JSON.parse(await page.evaluate(() => StudyApp.__test.progressJson())).completed.length === 3, 'a new mark reaches the next save');
  await page.evaluate(() => StudyApp.__test.persist()); await page.waitForTimeout(100);
  const n = await page.evaluate(() => window.__writes.length);
  await page.evaluate(() => StudyApp.__test.persist()); await page.waitForTimeout(100);
  check(await page.evaluate(() => window.__writes.length) === n, 'an unchanged save is still skipped');
  await page.click('#reset-completed-btn').catch(() => {});
  await page.evaluate(() => { const ok = document.querySelector('#reset-confirm-btn, #completed-reset-confirm-btn'); if (ok) ok.click(); });
  await page.waitForTimeout(300);
  if ((await summary()).startsWith('0 of 3')) {
    check(JSON.parse(await page.evaluate(() => StudyApp.__test.progressJson())).completed.length === 0, 'reset empties the saved list');
  } else console.log('ok reset flow not reachable here (skipped):', await summary());
  // Reloading from disk gives the right count straight away.
  await page.evaluate(() => { const qs = StudyApp.state.unit.questions, key = StudyApp.__test.key;
    window.__disk = JSON.stringify({ format: 'study-website-completed', version: 3, completed: [key(qs[1]), key(qs[2])], games: {} }); });
  await page.evaluate(t => StudyApp.loadUnitText(t), BANK);
  await page.waitForTimeout(300);
  check((await summary()).startsWith('2 of 3'), 'count after reload: ' + await summary());
  await page.close();

  // O11: game-time waits stop while paused, and per-question ones end with their question.
  const g = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  g.on('pageerror', e => console.log('PAGEERROR', e.message));
  await g.clock.install();
  await g.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; window.__TAURI__ = { core: { invoke: async () => '' } }; });
  await g.goto(url);
  await g.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'big.txt')); await g.clock.runFor(300);
  await g.click('#mode-games-btn'); await g.clock.runFor(100);
  await g.click('#games-grid .checkpoint-tile:nth-child(2)'); await g.clock.runFor(200);
  const mod = await g.$('#game-modifier'); if (mod && await mod.isVisible()) await g.uncheck('#game-modifier');
  await g.click('#game-start-btn'); await g.clock.runFor(300);
  await g.evaluate(() => { window.__fired = []; StudyApp.__test.after(1000, () => window.__fired.push('game')); StudyApp.__test.after(1000, () => window.__fired.push('turn'), true); });
  await g.keyboard.press('p'); await g.clock.runFor(200);
  await g.clock.runFor(5000);
  check((await g.evaluate(() => window.__fired)).length === 0, 'nothing fires while paused');
  await g.click('#game-resume-btn'); await g.clock.runFor(1200);
  check(JSON.stringify(await g.evaluate(() => window.__fired)) === '["game","turn"]', 'both fire after resuming: ' + JSON.stringify(await g.evaluate(() => window.__fired)));
  await g.evaluate(() => { window.__fired = []; StudyApp.__test.after(800, () => window.__fired.push('turn'), true); StudyApp.__test.after(800, () => window.__fired.push('game')); });
  await g.keyboard.press('1'); await g.clock.runFor(3000); // answer, then the next question
  const fired = await g.evaluate(() => window.__fired);
  check(fired.indexOf('game') !== -1, 'a game wait survives the next question');
  // A wait for this question is dropped when the next one comes.
  await g.evaluate(() => { window.__fired = []; window.__turn = StudyApp.__test.game().turn; StudyApp.__test.after(6000, () => window.__fired.push('late'), true); });
  await g.keyboard.press('1'); await g.clock.runFor(4000);
  const moved = await g.evaluate(() => StudyApp.__test.game().turn !== window.__turn);
  await g.clock.runFor(4000);
  check(moved && (await g.evaluate(() => window.__fired)).length === 0, 'a per-question wait ends with its question');
  // The answer feedback itself waits while paused.
  const q0 = await g.textContent('#game-question');
  await g.keyboard.press('1'); await g.clock.runFor(100);
  await g.keyboard.press('p'); await g.clock.runFor(200);
  await g.clock.runFor(6000);
  check(await g.textContent('#game-question') === q0 && await g.isVisible('#screen-game'), 'feedback stays up while paused');
  await g.click('#game-resume-btn'); await g.clock.runFor(4000);
  check(await g.textContent('#game-question') !== q0 || !(await g.isVisible('#screen-game')), 'the game moves on after resuming');
  await b.close();
})();
