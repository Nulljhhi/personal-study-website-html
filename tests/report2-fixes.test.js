// Report 2 fixes: save integrity, quit safety, async guards, keys, dialogs,
// Home paging, duplicate counts, distractors, minigame setting.
const { chromium } = require('./browser');
const fs = require('fs');
const path = require('path');
const os = require('os');
const fixture = (n) => path.join(__dirname, 'fixtures', n);
const scratch = (n) => path.join(os.tmpdir(), 'sw-test-' + n);
const pageUrl = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const bankText = fs.readFileSync(fixture('bank.txt'), 'utf8');
(async () => {
  const b = await chromium.launch();
  const mk = async (opts) => {
    const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    await page.addInitScript((o) => {
      window.__STUDY_TEST_NO_MINIGAMES = true;
      window.__calls = []; window.__writes = []; window.__mock = o;
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      window.__TAURI__ = {
        core: { invoke: async (cmd, a) => {
          const m = window.__mock;
          window.__calls.push(cmd);
          if (cmd === 'read_progress') return m.progress || '';
          if (cmd === 'write_progress') {
            if (m.writeDelay) await wait(m.writeDelay);
            if (m.failWrite) throw 'disk full';
            window.__writes.push(a.json); return 'bank-abc';
          }
          if (cmd === 'save_bank') { if (m.bankDelay) await wait(m.bankDelay); return '~/Documents/StudyWebsite/banks/' + a.name + '.txt'; }
          if (cmd === 'read_dropped_file') { if (a.path === 'slow') await wait(400); return a.path === 'slow' ? m.slowText : m.fastText; }
          if (cmd === 'list_bank_meta') return [['Test Unit.txt', 1, 1, 0]];
          if (cmd === 'read_bank') return m.bank;
          if (cmd === 'delete_bank') return '';
          if (cmd === 'quit_app') { window.__quit = true; return null; }
          if (cmd === 'list_checkpoints') return [];
          return '';
        } },
        window: { getCurrentWindow: () => ({ onCloseRequested: async (h) => { window.__closeHandler = h; return () => {}; }, isFullscreen: async () => true, setFullscreen: async () => {} }) },
        webview: { getCurrentWebview: () => ({ onDragDropEvent: async (cb) => { window.__drop = cb; return () => {}; } }) }
      };
    }, opts);
    await page.goto(pageUrl);
    return page;
  };
  const toasts = (page) => page.$$eval('.toast', e => e.map(x => x.textContent).join(' | '));
  const load = async (page, file) => { await page.setInputFiles('#file-input', file || fixture('bank.txt')); await page.waitForTimeout(250); };

  // B06: wrong shapes are refused (never overwritten).
  let page = await mk({ progress: JSON.stringify({ format: 'study-website-completed', version: 3, completed: 'x', games: {} }) });
  await load(page);
  check(/couldn't be loaded/.test(await toasts(page)), 'completed-not-a-list flagged');
  await page.evaluate(() => StudyApp.__test.persist()); await page.waitForTimeout(100);
  check(await page.evaluate(() => window.__writes.length) === 0, 'damaged-shape file not written');
  await page.close();
  page = await mk({ progress: JSON.stringify({ version: 3, completed: [], games: { fishing: [] } }) });
  await load(page);
  check(/couldn't be loaded/.test(await toasts(page)), 'games section as array flagged');
  await page.close();

  // B07 + O04: unknown sections and fields survive; compact; identical saves skipped.
  page = await mk({ progress: JSON.stringify({ format: 'study-website-completed', version: 3, completed: [],
    games: { futuregame: { a: 1 }, fishing: { coins: 5, newField: 7 }, ratings: { futureGame: 1200 } }, extraTop: 'keep' }) });
  await load(page);
  await page.evaluate(() => StudyApp.__test.persist()); await page.waitForTimeout(100);
  let w = await page.evaluate(() => window.__writes);
  let saved = w.length ? JSON.parse(w[w.length - 1]) : {};
  check(saved.games && saved.games.futuregame && saved.games.futuregame.a === 1, 'unknown game section kept');
  check(saved.games && saved.games.fishing && saved.games.fishing.newField === 7 && saved.games.fishing.coins === 5, 'unknown profile field kept');
  check(saved.games && saved.games.ratings && saved.games.ratings.futureGame === 1200, 'unknown game rating kept');
  check(saved.extraTop === 'keep' && typeof saved.updatedAt === 'string', 'top-level extras and timestamp');
  check(w.length && !w[w.length - 1].includes('\n'), 'progress JSON is compact');
  await page.evaluate(() => StudyApp.__test.persist()); await page.waitForTimeout(100);
  check(await page.evaluate(() => window.__writes.length) === w.length, 'unchanged progress not rewritten');
  check(/Saved/.test(await page.textContent('#save-status')), 'save status shows Saved');
  // B24: duplicates count once.
  await page.close();
  const dupText = bankText + '\nquestion: Q one?\nanswer: Alpha\nmedium_fake_answer_1: x1\nmedium_fake_answer_2: x2\nmedium_fake_answer_3: x3\nhard_fake_answer_1: y1\nhard_fake_answer_2: y2\nhard_fake_answer_3: y3\n';
  fs.writeFileSync(scratch('dup.txt'), dupText);
  page = await mk({});
  await load(page, scratch('dup.txt'));
  const nq = (bankText.match(/^question:/gm) || []).length;
  check((await page.textContent('#completed-summary')).includes('of ' + nq + ' questions'), 'duplicates counted once: ' + await page.textContent('#completed-summary'));
  await page.close();

  // B03: a save queued before a delete doesn't recreate the progress.
  page = await mk({ bank: bankText, writeDelay: 300 });
  await load(page);
  await page.evaluate(() => { StudyApp.state.highScores['boss:x'] = 5; StudyApp.__test.persist(); StudyApp.state.highScores['boss:x'] = 6; StudyApp.__test.persist(); });
  await page.evaluate(() => document.querySelector('#open-saved-bank-btn').click()); await page.waitForTimeout(200);
  await page.evaluate(() => [...document.querySelectorAll('#bank-grid button')].find(x => x.textContent === 'Delete').click());
  await page.click('#bank-delete-confirm-btn');
  await page.waitForTimeout(1200);
  let calls = await page.evaluate(() => window.__calls);
  const del = calls.lastIndexOf('delete_bank');
  check(del !== -1 && calls.slice(del + 1).indexOf('write_progress') === -1, 'no progress write after delete: ' + calls.filter(c => /write|delete/.test(c)).join(','));
  await page.evaluate(() => { StudyApp.state.highScores['boss:x'] = 9; StudyApp.__test.persist(); }); await page.waitForTimeout(400);
  calls = await page.evaluate(() => window.__calls);
  check(calls.slice(del + 1).indexOf('write_progress') === -1, 'later saves stay off after delete');
  await page.close();

  // B01/B02: quitting with a failed save keeps the window open and asks.
  page = await mk({ failWrite: true });
  await load(page);
  await page.evaluate(() => StudyApp.__test.persist()); await page.waitForTimeout(100);
  await page.evaluate(() => { StudyApp.showScreen('landing'); document.querySelector('#quit-btn').click(); }); await page.waitForTimeout(300);
  check(await page.isVisible('#quit-modal') && !(await page.evaluate(() => window.__quit)), 'failed save: quit asks instead of closing');
  const ev = await page.evaluate(async () => { let prevented = false; document.querySelector('#quit-modal').classList.add('hidden');
    await window.__closeHandler({ preventDefault: () => { prevented = true; } }); return prevented; });
  check(ev && await page.isVisible('#quit-modal'), 'window close is prevented on a failed save');
  await page.click('#quit-anyway-btn'); await page.waitForTimeout(100);
  check(await page.evaluate(() => window.__quit) === true, 'Quit anyway quits');
  await page.close();
  page = await mk({ bankDelay: 5000 });
  await load(page);
  await page.click('#save-bank-btn');
  await page.evaluate(() => { StudyApp.showScreen('landing'); document.querySelector('#quit-btn').click(); }); await page.waitForTimeout(3300);
  check(await page.isVisible('#quit-modal') && /longer than usual/.test(await page.textContent('#quit-hint')), 'a hanging bank save times out into the dialog');
  await page.close();
  page = await mk({});
  await load(page);
  await page.evaluate(() => { StudyApp.showScreen('landing'); document.querySelector('#quit-btn').click(); }); await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__quit) === true, 'clean quit closes');
  const ev2 = await page.evaluate(async () => { let prevented = false; await window.__closeHandler({ preventDefault: () => { prevented = true; } }); return prevented; });
  check(!ev2, 'clean close not prevented');
  await page.close();

  // A failed save for one bank isn't forgotten when another is opened.
  page = await mk({ failWrite: true });
  await load(page);
  await page.evaluate(() => { StudyApp.state.highScores['boss:x'] = 3; return StudyApp.__test.persist(); }); await page.waitForTimeout(100);
  await page.evaluate((t) => StudyApp.loadUnitText(t.replace('Test Unit', 'Bank B')), bankText); await page.waitForTimeout(200);
  const ev3 = await page.evaluate(async () => { let prevented = false; await window.__closeHandler({ preventDefault: () => { prevented = true; } }); return prevented; });
  check(ev3 && await page.isVisible('#quit-modal'), 'unsaved progress of the previous bank still blocks closing');
  await page.evaluate(() => { window.__mock.failWrite = false; });
  await page.click('#quit-retry-btn'); await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__quit === true && window.__writes.some(j => j.includes('"boss:x":3'))), 'Try again writes the old bank and quits');
  await page.close();

  // B10: a slow bank save doesn't set the path of a bank opened meanwhile.
  page = await mk({ bankDelay: 300 });
  await load(page);
  await page.click('#save-bank-btn');
  await page.evaluate(() => { const t = document.querySelector('#home-back-btn, .back-btn'); });
  await page.evaluate((t) => StudyApp.loadUnitText(t.replace('Test Unit', 'Other Unit')), bankText);
  await page.waitForTimeout(500);
  check(!(await page.isVisible('#bank-path-box')), 'late save_bank response ignored for the new bank');
  await page.close();

  // B11: an older import finishing late is ignored.
  page = await mk({ slowText: bankText.replace('Test Unit', 'Slow Unit'), fastText: bankText.replace('Test Unit', 'Fast Unit') });
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__drop({ payload: { type: 'drop', paths: ['slow'] } }); });
  await page.waitForTimeout(50);
  await page.evaluate(() => { StudyApp.showScreen('landing'); window.__drop({ payload: { type: 'drop', paths: ['fast'] } }); });
  await page.waitForTimeout(700);
  check(await page.evaluate(() => StudyApp.state.unit && StudyApp.state.unit.unitTitle) === 'Fast Unit', 'latest import wins');
  await page.close();

  // B19, B20, B26, O02, minigame setting, B08.
  page = await mk({});
  const many = ['unit_title: Many', ''];
  for (let i = 0; i < 700; i++) many.push('question: Q' + i + '?', 'answer: A' + i, 'medium_fake_answer_1: m' + i + 'a', 'medium_fake_answer_2: m' + i + 'b', 'medium_fake_answer_3: m' + i + 'c', 'hard_fake_answer_1: h' + i + 'a', 'hard_fake_answer_2: h' + i + 'b', 'hard_fake_answer_3: h' + i + 'c', '');
  fs.writeFileSync(scratch('many.txt'), many.join('\n'));
  await load(page, scratch('many.txt'));
  check(await page.$$eval('#qa-list .qa-pair', e => e.length) === 300 && await page.isVisible('#qa-more-btn'), 'Home shows the first page');
  await page.click('#qa-more-btn');
  check(await page.$$eval('#qa-list .qa-pair', e => e.length) === 600, 'Show more adds a page');
  // O01: easy distractors are distinct and quick on a big bank.
  const t0 = Date.now();
  const okChoices = await page.evaluate(() => { const u = StudyApp.state.unit; let ok = true;
    for (let i = 0; i < u.questions.length; i++) { const c = StudyApp.buildMcChoices(u, u.questions[i], 'easy', 1000 + i);
      const vals = ['a', 'b', 'c', 'd'].map(k => c[k]); if (new Set(vals).size !== 4 || c[c.correctSlot] !== u.questions[i].answer) ok = false; }
    const again = StudyApp.buildMcChoices(u, u.questions[3], 'easy', 7), again2 = StudyApp.buildMcChoices(u, u.questions[3], 'easy', 7);
    return ok && JSON.stringify(again) === JSON.stringify(again2); });
  check(okChoices && Date.now() - t0 < 3000, 'easy choices distinct, seeded and fast (' + (Date.now() - t0) + ' ms)');
  // B19: a focused button on the flashcard screen does its own job.
  await page.evaluate(() => StudyApp.startFlashcards ? document.querySelector('#mode-flashcard-btn, #mode-flashcards-btn').click() : 0);
  await page.waitForTimeout(100);
  const fcStart = await page.$('#fc-start-btn, #flashcard-start-btn');
  if (fcStart) await fcStart.click();
  await page.waitForTimeout(150);
  if (await page.evaluate(() => StudyApp.state.screen) === 'flashcard') {
    const back = await page.$('#screen-flashcard .return-home');
    if (back) { await back.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
      check(await page.evaluate(() => StudyApp.state.screen) !== 'flashcard', 'Enter on a focused Back button goes back'); }
    else console.log('   (no back button found; skipped)');
  } else console.log('   (flashcards not started; skipped B19)');
  // B26: focus returns to the opener.
  await page.evaluate(() => StudyApp.showScreen('home'));
  await page.click('#mode-games-btn'); await page.waitForTimeout(150);
  await page.click('#games-grid .checkpoint-tile:nth-child(1)'); await page.waitForTimeout(200);
  await page.focus('#game-reset-btn'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'game-reset-btn', 'focus returns to the button that opened the dialog');
  // Minigame setting.
  check(!(await page.$('#game-no-minigames')), 'no option to turn off minigames');
  // B08: reset clears the skill entry.
  const gid = await page.evaluate(() => { const g = Object.keys(StudyApp.state.gameData.skill || {}); StudyApp.state.gameData.skill.boss = { acc: .9, pace: 1, n: 5 }; StudyApp.__test.resetGame('boss'); return StudyApp.state.gameData.skill.boss; });
  check(gid === undefined, 'reset clears the bot-matching skill');
  // B20: Ctrl+number isn't an answer.
  await page.evaluate(() => { document.querySelector('#game-start-btn').click(); });
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => { const g = StudyApp.__test.game(); return g ? g.answered : -1; });
  await page.keyboard.press('Control+1'); await page.waitForTimeout(100);
  const after = await page.evaluate(() => { const g = StudyApp.__test.game(); return g ? g.answered : -1; });
  check(before >= 0 && before === after, 'Ctrl+1 does not answer (' + before + ' -> ' + after + ')');
  await page.keyboard.press('1'); await page.waitForTimeout(100);
  check(await page.evaluate(() => StudyApp.__test.game().answered) === after + 1, 'plain 1 still answers');
  await page.close();
  await b.close();
})();
