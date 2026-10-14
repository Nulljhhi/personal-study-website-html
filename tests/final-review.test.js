// Fixes from the final review before release.
const { chromium } = require('./browser');
const path = require('path');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const url = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const fixture = (n) => path.join(__dirname, 'fixtures', n);
const block = (q, a) => `question: ${q}\nanswer: ${a}\nmedium_fake_answer_1: B\nmedium_fake_answer_2: C\nmedium_fake_answer_3: D\nhard_fake_answer_1: E\nhard_fake_answer_2: F\nhard_fake_answer_3: G\n\n`;

(async () => {
  const b = await chromium.launch();

  // A .zip refused because one picture is broken keeps no pictures in memory.
  let page = await b.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => {
    window.__STUDY_TEST_NO_MINIGAMES = true; window.__live = new Set();
    const make = URL.createObjectURL, drop = URL.revokeObjectURL;
    URL.createObjectURL = function (o) { const u = make.call(URL, o); if (o && o.type && o.type.startsWith('image/')) window.__live.add(u); return u; };
    URL.revokeObjectURL = function (u) { window.__live.delete(u); return drop.call(URL, u); };
  });
  await page.goto(url);
  await page.setInputFiles('#file-input', fixture('bad-picture.zip'));
  await page.waitForFunction(() => /Img\.Q4/.test(document.body.textContent), null, { timeout: 10000 });
  check(await page.evaluate(() => !StudyApp.state.unit), 'the .zip with the broken picture is refused, naming it');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__live.size) === 0, 'no picture is left in memory: ' + await page.evaluate(() => window.__live.size));
  await page.close();

  // Bank list: a filter typed earlier is cleared when the box goes away;
  // opening the list twice quickly ends in one finished list.
  page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => {
    window.__STUDY_TEST_NO_MINIGAMES = true;
    window.__n = 13;
    const bank = (t) => `unit_title: ${t}\n\nquestion: Q?\nanswer: A\nmedium_fake_answer_1: B\nmedium_fake_answer_2: C\nmedium_fake_answer_3: D\nhard_fake_answer_1: E\nhard_fake_answer_2: F\nhard_fake_answer_3: G\n`;
    const names = () => Array.from({ length: window.__n }, (_, i) => `Week ${i + 1}.txt`);
    window.__TAURI__ = { core: { invoke: async (cmd, a) => {
      if (cmd === 'list_bank_meta') return names().map(n => [n, 1, 1, 0, 0]);
      if (cmd === 'read_banks') { await new Promise(r => setTimeout(r, 80)); return a.names.map(n => [bank(n.replace('.txt', '')), '', '']); }
      return '';
    } } };
  });
  await page.goto(url);
  const open = () => page.evaluate(() => { StudyApp.showScreen('landing'); document.querySelector('#open-saved-bank-btn').click(); });
  await open();
  await page.waitForFunction(() => document.querySelectorAll('#bank-grid .checkpoint-tile').length === 13);
  await page.fill('#bank-filter', 'week 1');
  await page.evaluate(() => { window.__n = 12; });
  await open();
  await page.waitForFunction(() => document.querySelectorAll('#bank-grid .checkpoint-tile').length === 12);
  check(await page.$$eval('#bank-grid .checkpoint-tile.hidden', e => e.length) === 0 && await page.inputValue('#bank-filter') === '', 'with the filter box gone, every bank shows');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => { window.__n = 14; });
  await open(); await open();
  await page.waitForFunction(() => document.querySelectorAll('#bank-grid .checkpoint-tile').length === 14);
  await page.waitForTimeout(400);
  check(await page.isHidden('#banks-status') && await page.$$eval('#bank-grid .checkpoint-tile', e => e.length) === 14, 'opening the list twice quickly leaves one finished list');
  await page.close();

  // Renaming a folder bank doesn't swap out an open bank loaded from
  // elsewhere that has the same title but other questions.
  page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  const folderText = 'unit_title: Cells\n\n' + block('Folder Q?', 'A');
  await page.addInitScript((t) => {
    window.__STUDY_TEST_NO_MINIGAMES = true;
    window.__TAURI__ = { core: { invoke: async (cmd, a) => {
      if (cmd === 'list_bank_meta') return [['Cells.txt', 1, 1, 0, 0]];
      if (cmd === 'read_banks') return a.names.map(() => [t, '', '']);
      if (cmd === 'rename_bank') return [a.newTitle + '.txt', t.replace('unit_title: Cells', 'unit_title: ' + a.newTitle), ''];
      return '';
    } } };
  }, folderText);
  await page.goto(url);
  await page.evaluate((t) => StudyApp.loadUnitText(t), 'unit_title: Cells\n\n' + block('My own Q?', 'A'));
  await open();
  await page.waitForFunction(() => document.querySelectorAll('#bank-grid .checkpoint-tile').length === 1);
  await page.evaluate(() => document.querySelector('#bank-grid button[aria-label^="Rename"]').click());
  await page.fill('#bank-rename-input', 'Organs');
  await page.click('#bank-rename-save-btn');
  await page.waitForTimeout(300);
  const q = await page.evaluate(() => StudyApp.state.unit.questions[0].question);
  check(q === 'My own Q?', 'the open bank keeps its own questions: ' + q);
  await page.close();

  // Blitz: the match clock loses no time when questions change.
  page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.clock.install();
  await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; window.__TAURI__ = { core: { invoke: async () => '' } }; });
  await page.goto(url);
  await page.setInputFiles('#file-input', fixture('big.txt')); await page.clock.runFor(300);
  await page.click('#mode-games-btn'); await page.clock.runFor(100);
  const tiles = await page.$$eval('#games-grid .checkpoint-tile', e => e.map(x => x.textContent));
  await page.click(`#games-grid .checkpoint-tile:nth-child(${tiles.findIndex(t => t.includes('Blitz')) + 1})`); await page.clock.runFor(200);
  await page.click('#game-start-btn'); await page.clock.runFor(300);
  const left0 = await page.evaluate(() => StudyApp.__test.game().blitzLeft);
  let ran = 0;
  for (let i = 0; i < 6; i++) { await page.keyboard.press('1'); await page.clock.runFor(1500); ran += 1500; }
  const g = await page.evaluate(() => { const x = StudyApp.__test.game(); return { left: x.blitzLeft, wrong: x.answered - x.correct, over: x.over }; });
  const lost = left0 - g.left - 3000 * g.wrong;
  // A question change ends its frame (the rest of the frame was the old
  // question's), so each of the 6 answers may drop up to one ~16 ms frame,
  // and each reading may land a frame early or late: about 130 ms of leeway.
  // The bug this guards against lost up to 250 ms per answer (1,500 ms here).
  check(!g.over && Math.abs(lost - ran) <= 130, 'the match clock counts all of the time, to within a frame per answer: ' + lost + ' of ' + ran + ' ms');
  await page.close();

  await b.close();
})();
