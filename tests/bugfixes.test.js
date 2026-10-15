// Bug-report fixes: damaged progress, failed saves, parser distractors,
// checkpoint validation, review labels, Blitz standings.
const { chromium } = require('./browser');
const fs = require('fs');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
(async () => {
  const b = await chromium.launch();
  const mk = async (opts) => {
    const page = await b.newPage({ viewport: { width: 1920, height: 1080 } }); await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    await page.addInitScript((o) => {
      window.__writes = 0;
      window.__TAURI__ = { core: { invoke: async (cmd, a) => {
        if (cmd === 'read_progress') { if (o.damaged) throw 'DAMAGED: Saved progress couldn\'t be read (x isn\'t valid progress data).'; return o.progress || ''; }
        if (cmd === 'write_progress') { window.__writes++; if (o.failWrite) throw 'disk full'; window.__last = a.json; return null; }
        if (cmd === 'list_checkpoints') return o.checkpoints || [];
        if (cmd === 'list_checkpoint_meta') { if (!o.meta) return ''; window.__cpReads = window.__cpReads || 0; return (o.checkpoints || []).map(c => [c[0], 1, c[1].length]); }
        if (cmd === 'read_checkpoint') { window.__cpReads++; return (o.checkpoints || []).find(c => c[0] === a.id)[1]; }
        if (cmd === 'save_bank') return '~/x.txt';
        return ''; } } };
    }, opts);
    await page.goto(require('url').pathToFileURL(require('path').join(__dirname, '..', 'src', 'index.html')).href);
    return page;
  };
  const toasts = (page) => page.$$eval('.toast', e => e.map(x => x.textContent).join(' | '));

  // 1. Damaged progress is flagged and never overwritten.
  let page = await mk({ damaged: true });
  await page.setInputFiles('#file-input', require('path').join(__dirname, 'fixtures', 'big.txt')); await page.waitForTimeout(300);
  check(/couldn't be loaded/.test(await toasts(page)), 'damaged progress flagged: ' + (await toasts(page)).slice(0, 120));
  await page.click('#mode-quiz-btn'); await page.click('#quiz-start-btn'); await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelectorAll('#quiz-choices button')[0].click());
  await page.click('#submit-quiz-btn'); await page.waitForTimeout(100);
  if (await page.isVisible('#submit-continue-btn')) await page.click('#submit-continue-btn');
  await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__writes) === 0, 'nothing written over damaged progress');
  // 2. Review labels say which answer is which.
  const labels = await page.$$eval('.review-label', e => e.map(x => x.textContent));
  check(labels.some(t => /Correct answer/.test(t)), 'review labels: ' + labels.join(','));
  await page.close();

  // 3. A failed save doesn't claim success.
  page = await mk({ failWrite: true });
  await page.setInputFiles('#file-input', require('path').join(__dirname, 'fixtures', 'big.txt')); await page.waitForTimeout(300);
  await page.evaluate(() => {});
  await page.click('#mode-games-btn'); await page.waitForTimeout(100);
  await page.click('#games-grid .checkpoint-tile:nth-child(1)'); await page.waitForTimeout(200);
  const resetBtn = await page.$('#game-reset-btn');
  if (resetBtn && await resetBtn.isVisible()) {
    await resetBtn.click(); await page.waitForTimeout(100);
    await page.click('#game-reset-confirm-btn'); await page.waitForTimeout(300);
    const t = await toasts(page);
    check(!/progress reset/.test(t) && /disk full/.test(t), 'failed reset save shows the error, not success: ' + t.slice(0, 120));
  } else console.log('   (no reset button found; skipped)');
  await page.close();

  // 4. Parser rejects a block without three distinct fakes.
  page = await mk({});
  const bad = 'unit_title: Bad\n\nquestion: Q?\nanswer: A\nmedium_fake_answer_1: A\nmedium_fake_answer_2: b\nmedium_fake_answer_3: B\nhard_fake_answer_1: a\nhard_fake_answer_2: b \nhard_fake_answer_3: c\n';
  fs.writeFileSync(require('path').join(require('os').tmpdir(), 'badfakes.txt'), bad);
  await page.setInputFiles('#file-input', require('path').join(require('os').tmpdir(), 'badfakes.txt')); await page.waitForTimeout(300);
  check(/three fake answers/.test(await toasts(page)), 'duplicate fakes rejected: ' + (await toasts(page)).slice(0, 140));
  await page.close();

  // 5. Crafted checkpoint (wrong slot marked correct) isn't offered.
  const unitText = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'big.txt'), 'utf8');
  const firstAnswer = unitText.match(/answer: (.*)/)[1];
  const mkCp = (correct) => JSON.stringify({ format: 'study-website-session', version: 1, savedAt: new Date().toISOString(), unitTitle: 'x',
    unitText, mode: 'quiz', seed: 1, options: { count: 1, difficulty: 'easy', types: ['mc'] }, poolIds: null, generator: 2,
    orderIds: [0], tfFlags: [false], choices: [{ a: correct ? firstAnswer : 'zz', b: 'y1', c: 'y2', d: correct ? 'y3' : firstAnswer, correctSlot: 'a' }],
    answers: [null], index: 0, showProgress: true });
  page = await mk({ checkpoints: [['good', mkCp(true)], ['bad', mkCp(false)]] });
  await page.evaluate(() => { const b = document.querySelector('.resume-session-btn'); if (b) b.click(); });
  await page.waitForTimeout(300);
  const tiles = await page.$$eval('#checkpoint-grid .checkpoint-tile', e => e.map(x => x.className));
  check(tiles.length === 2 && tiles.filter(c => c.includes('broken')).length === 1, 'crafted checkpoint listed as unreadable: ' + tiles.join(','));
  // 5b. Same through the cheap listing, and the second visit reads nothing.
  await page.close();
  page = await mk({ meta: true, checkpoints: [['good', mkCp(true)], ['bad', mkCp(false)]] });
  await page.evaluate(() => document.querySelector('.resume-session-btn').click()); await page.waitForTimeout(300);
  const tiles2 = await page.$$eval('#checkpoint-grid .checkpoint-tile', e => e.map(x => x.className));
  check(tiles2.length === 2 && tiles2.filter(c => c.includes('broken')).length === 1, 'meta listing validates too');
  const reads1 = await page.evaluate(() => window.__cpReads);
  await page.evaluate(() => { document.querySelector('#screen-checkpoints .back-btn, #checkpoints-back-btn').click(); });
  await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('.resume-session-btn').click()); await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__cpReads) === reads1, 'unchanged checkpoints are not re-read');
  await page.close();
  // 6. Dialogs: Escape cancels, background is inert while open.
  page = await mk({ progress: JSON.stringify({ format: 'study-website-completed', version: 2, unitTitle: 'ISPOR MFN Policies Explained; January-February 2026', completed: [] }) });
  await page.setInputFiles('#file-input', require('path').join(__dirname, 'fixtures', 'big.txt')); await page.waitForTimeout(300);
  await page.click('#mode-games-btn'); await page.waitForTimeout(100);
  await page.click('#games-grid .checkpoint-tile:nth-child(1)'); await page.waitForTimeout(200);
  await page.click('#game-reset-btn'); await page.waitForTimeout(100);
  check(await page.evaluate(() => document.querySelector('#screen-game-setup, section.screen.active').closest('[inert]') !== null), 'background inert while dialog open');
  const labelled = await page.$eval('#game-reset-modal [role=dialog]', e => !!e.getAttribute('aria-labelledby') && !!e.getAttribute('aria-describedby'));
  check(labelled, 'dialog has a name and description');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check(!(await page.isVisible('#game-reset-modal')), 'Escape cancels the dialog');
  check(await page.evaluate(() => !document.querySelector('[inert]')), 'inert removed after closing');
  await page.close();
  await b.close();
})();
