// Years of banks (7 a week, none deleted): the bank list reads banks in
// batches, remembers them between sessions, sorts numbers naturally and
// can be filtered.
const { chromium } = require('./browser');
const path = require('path');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const url = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const N = 300;
const bank = (t) => `unit_title: ${t}\n\nquestion: Q?\nanswer: A\nmedium_fake_answer_1: B\nmedium_fake_answer_2: C\nmedium_fake_answer_3: D\nhard_fake_answer_1: E\nhard_fake_answer_2: F\nhard_fake_answer_3: G\n`;

(async () => {
  const b = await chromium.launch();
  const context = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript((n) => {
    window.__STUDY_TEST_NO_MINIGAMES = true;
    window.__calls = {};
    const banks = new Map();
    for (let i = 1; i <= n; i++) {
      const t = `Week ${Math.ceil(i / 7)} day ${(i - 1) % 7 + 1}`;
      banks.set(t + '.txt', `unit_title: ${t}\n\nquestion: Q?\nanswer: A\nmedium_fake_answer_1: B\nmedium_fake_answer_2: C\nmedium_fake_answer_3: D\nhard_fake_answer_1: E\nhard_fake_answer_2: F\nhard_fake_answer_3: G\n`);
    }
    window.__banks = banks;
    window.__TAURI__ = { core: { invoke: async (cmd, a) => {
      window.__calls[cmd] = (window.__calls[cmd] || 0) + 1;
      if (cmd === 'list_bank_meta') return [...banks.keys()].map(k => [k, 1, 1, k === 'Week 2 day 1.txt' ? (window.__touched || 0) : 0]);
      if (cmd === 'read_banks') { await new Promise(r => setTimeout(r, 30)); return a.names.map(x => [banks.get(x), '', '']); }
      if (cmd === 'read_bank') return banks.get(a.name);
      return '';
    } } };
  }, N);
  const page = await context.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(url);
  const open = async () => {
    await page.evaluate(() => { window.__calls = {}; StudyApp.showScreen('landing'); document.querySelector('#open-saved-bank-btn').click(); });
  };

  await open();
  await page.waitForTimeout(40);
  const status = await page.textContent('#banks-status');
  check(/Reading saved banks… \d+ of 300/.test(status), 'progress is shown while banks are read: ' + status);
  await page.waitForFunction(() => document.querySelectorAll('#bank-grid .checkpoint-tile').length === 300);
  const calls = await page.evaluate(() => window.__calls);
  check(calls.read_banks === 6 && !calls.read_bank && !calls.read_progress, 'banks are read 50 at a time: ' + JSON.stringify(calls));
  check(await page.isHidden('#banks-status'), 'and the message goes away');
  const order = await page.$$eval('#bank-grid .checkpoint-unit', e => e.slice(0, 9).map(x => x.textContent));
  check(order[7] === 'Week 2 day 1' && order[0] === 'Week 1 day 1', 'numbers sort naturally: ' + order.slice(6, 9).join(', '));

  // Filter.
  await page.fill('#bank-filter', 'week 4');
  const shown = await page.$$eval('#bank-grid .checkpoint-tile:not(.hidden)', e => e.map(x => x.querySelector('.checkpoint-unit').textContent));
  // Week 4 and Weeks 40-43 (300 banks end on day 6 of week 43): 7 + 7 + 7 + 7 + 6.
  check(shown.length === 34 && shown.every(t => /^Week 4/.test(t)), 'the filter matches the typed phrase: ' + shown.length);
  check(/of 300 banks/.test(await page.textContent('#bank-count')), 'and counts them: ' + await page.textContent('#bank-count'));
  await page.fill('#bank-filter', '');
  check(await page.$$eval('#bank-grid .checkpoint-tile.hidden', e => e.length) === 0, 'clearing it shows every bank');

  // A restart remembers the banks; only a changed one is read again.
  await page.evaluate(() => { window.__touched = 5; });
  await page.reload();
  await page.evaluate(() => { window.__touched = 5; });
  await open();
  await page.waitForFunction(() => document.querySelectorAll('#bank-grid .checkpoint-tile').length === 300);
  const again = await page.evaluate(() => window.__calls);
  check(again.read_banks === 1, 'after a restart only the changed bank is read: ' + JSON.stringify(again));
  await b.close();
})();
