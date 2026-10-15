// Two bank files with one title (report 3, R04): the list warns, and
// deleting one copy keeps the progress the other still uses.
const { chromium } = require('./browser');
const path = require('path');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const url = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const BANK = 'unit_title: Cells\n\nquestion: Q one?\nanswer: Alpha\nmedium_fake_answer_1: B\nmedium_fake_answer_2: C\nmedium_fake_answer_3: D\nhard_fake_answer_1: E\nhard_fake_answer_2: F\nhard_fake_answer_3: G\n';
const OTHER = BANK.replace('Cells', 'Organs');

(async () => {
  const b = await chromium.launch();
  const mk = async (kept) => {
    const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    await page.addInitScript((o) => {
      window.__STUDY_TEST_NO_MINIGAMES = true;
      window.__calls = [];
      window.__TAURI__ = { core: { invoke: async (cmd, a) => {
        window.__calls.push(cmd);
        if (cmd === 'list_bank_meta') return [['Cells.txt', 1, 1, 0], ['Cells copy.txt', 1, 1, 0], ['Organs.txt', 1, 1, 0]];
        if (cmd === 'read_bank') return a.name === 'Organs.txt' ? o.other : o.bank;
        if (cmd === 'delete_bank') return o.kept ? [true, 'Its progress was kept, because Cells.txt has the same title and uses it too.'] : [false, ''];
        if (cmd === 'write_progress') return 'bank-1';
        return '';
      } } };
    }, { bank: BANK, other: OTHER, kept });
    await page.goto(url);
    await page.evaluate((t) => StudyApp.loadUnitText(t), BANK).catch(() => {});
    return page;
  };

  let page = await mk(true);
  await page.evaluate(() => document.querySelector('#open-saved-bank-btn').click());
  await page.waitForTimeout(300);
  const notes = await page.$$eval('.bank-same-title', e => e.map(x => x.textContent));
  check(notes.length === 2, 'both copies are flagged: ' + notes.length);
  check(notes.some(n => n.includes('Cells copy.txt has the same title as Cells.txt')), 'note names the other file: ' + notes[0]);
  const organs = await page.$$eval('.checkpoint-tile', t => t.filter(x => x.textContent.includes('Organs')).map(x => !!x.querySelector('.bank-same-title')));
  check(organs.length === 1 && !organs[0], 'a bank with its own title is not flagged');

  // Delete the copy: the open bank keeps saving.
  await page.evaluate(() => [...document.querySelectorAll('.checkpoint-tile')].find(t => t.textContent.includes('File Cells copy.txt'))
    .querySelector('button[aria-label^="Delete"]').click());
  check(/kept, because Cells\.txt uses them too/.test(await page.textContent('#bank-delete-hint')), 'dialog says the progress stays: ' + await page.textContent('#bank-delete-hint'));
  await page.click('#bank-delete-confirm-btn');
  await page.waitForTimeout(400);
  check(/progress was kept/.test(await page.$$eval('.toast', e => e.map(x => x.textContent).join(' | '))), 'kept note shown');
  check(await page.evaluate(() => StudyApp.state.bankDeleted) === false, 'open bank is not treated as deleted');
  const before = await page.evaluate(() => window.__calls.filter(c => c === 'write_progress').length);
  await page.evaluate(() => { StudyApp.state.highScores['boss:x'] = 5; StudyApp.__test.persist(); });
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__calls.filter(c => c === 'write_progress').length) > before, 'progress still saves after deleting a copy');
  await page.close();

  // The last copy: progress goes, and saving stops (as before).
  page = await mk(false);
  await page.evaluate(() => document.querySelector('#open-saved-bank-btn').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('.checkpoint-tile')].find(t => t.textContent.includes('File Cells copy.txt'))
    .querySelector('button[aria-label^="Delete"]').click());
  await page.click('#bank-delete-confirm-btn');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => StudyApp.state.bankDeleted) === true, 'deleting the last copy still stops its saves');
  await page.close();
  await b.close();
})();
