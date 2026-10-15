const { chromium } = require('./browser');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1920, height: 1080 } }); await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(require('url').pathToFileURL(require('path').join(__dirname, '..', 'src', 'index.html')).href);
  await page.evaluate(() => localStorage.clear());
  await page.setInputFiles('#file-input', require('path').join(__dirname, 'fixtures', 'big.txt')); await page.waitForTimeout(300);
  const bank = await page.$$eval('#qa-list .qa-pair .qa-q', e => e.map(x => x.firstChild.textContent));
  // Home button colour
  const colors = await page.$$eval('.mode-buttons button', e => e.map(x => getComputedStyle(x).backgroundColor));
  check(new Set(colors).size === 1, 'all home buttons share one colour: ' + [...new Set(colors)].join(' / '));
  // Flashcards: bank order
  await page.click('#mode-flashcard-btn');
  check(await page.isVisible('#screen-flashcard-options'), 'flashcard options screen');
  await page.check('input[name="fc-order"][value="bank"]');
  await page.click('#fc-start-btn');
  check((await page.textContent('#card-question')) === bank[0], 'bank order starts at question 1');
  check((await page.textContent('#fc-meta')).includes('Question bank order'), 'meta shows bank order');
  check((await page.textContent('#fc-progress-text')).startsWith('Card 1 of 36'), 'progress: ' + await page.textContent('#fc-progress-text'));
  await page.keyboard.press('d'); check((await page.textContent('#card-question')) === bank[1], 'd = next');
  await page.keyboard.press('ArrowRight'); check((await page.textContent('#card-question')) === bank[2], '→ = next');
  await page.keyboard.press('a'); check((await page.textContent('#card-question')) === bank[1], 'a = back');
  await page.keyboard.press('ArrowLeft'); check((await page.textContent('#card-question')) === bank[0], '← = back');
  await page.keyboard.press('Space'); check(await page.isVisible('#card-answer'), 'space flips');
  await page.keyboard.press('Enter'); check(await page.isVisible('#card-question'), 'enter flips back');
  const ctl = await page.$eval('.flashcard-controls', e => { const r = e.getBoundingClientRect(); return [getComputedStyle(e).position, Math.round(r.bottom)]; });
  check(ctl[0] === 'fixed', 'flashcard controls pinned to the bottom: ' + ctl.join());
  await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'shot.png') });
  await page.keyboard.press('Escape'); check(await page.isVisible('#screen-home'), 'esc returns home');
  // Flashcards: seeded
  await page.click('#mode-flashcard-btn'); await page.check('input[name="fc-order"][value="seeded"]'); await page.click('#fc-start-btn');
  check(/Seed: \d+/.test(await page.textContent('#fc-meta')), 'seeded shows seed');
  await page.keyboard.press('Backspace'); check(await page.isVisible('#screen-home'), 'backspace returns home');
  // Matching
  await page.click('#mode-match-btn');
  check(await page.isVisible('#match-skip-completed'), 'matching skip-completed option');
  await page.click('.match-size-btn[data-size="4"]');
  check(!(await page.isVisible('#match-meta')), 'seed hidden by default');
  await page.check('#match-show-seed');
  const seed1 = await page.textContent('#match-meta');
  check(/Seed: \d+/.test(seed1), 'seed shown: ' + seed1);
  await page.waitForTimeout(5);
  await page.keyboard.press('Space');
  const seed2 = await page.textContent('#match-meta');
  check(seed1 !== seed2, 'space shuffles: ' + seed2);
  await page.keyboard.press('Enter');
  check((await page.textContent('#match-meta')) !== seed2, 'enter shuffles');
  await page.keyboard.press('Escape'); check(await page.isVisible('#screen-home'), 'esc leaves matching');
  // Quiz keys
  await page.click('#mode-quiz-btn'); await page.click('#quiz-start-btn'); await page.waitForTimeout(100);
  const tf = await page.isVisible('#tf-candidate');
  if (tf) await page.keyboard.press('t'); else await page.keyboard.press('3');
  check(await page.$$eval('#quiz-choices button.selected', e => e.length) === 1, 'key selects an answer (' + (tf ? 'T' : '3') + ')');
  await page.keyboard.press('d');
  check((await page.textContent('#quiz-progress-text')).startsWith('1 of'), 'answered count updates');
  const q2 = await page.textContent('#quiz-question-text');
  await page.keyboard.press('a');
  check((await page.textContent('#quiz-question-text')) !== q2, 'a goes back');
  await page.keyboard.press('Enter');
  check(await page.isVisible('#submit-modal'), 'enter submits (unanswered warning)');
  await page.keyboard.press('Escape');
  check(!(await page.isVisible('#submit-modal')) && await page.isVisible('#screen-quiz'), 'esc closes the submit warning first');
  await page.keyboard.press('Escape'); check(await page.isVisible('#screen-home'), 'esc returns home from quiz');
  // Exam keys
  await page.click('#mode-exam-btn'); await page.click('#exam-start-btn'); await page.waitForTimeout(100);
  const tf2 = await page.isVisible('#tf-candidate');
  await page.keyboard.press(tf2 ? 'f' : '1');
  check(await page.$$eval('#quiz-choices button.selected', e => e.length) === 1, 'exam: key selects an answer');
  await page.keyboard.press('ArrowRight');
  check((await page.textContent('#quiz-progress-text')).startsWith('1 of'), 'exam: arrow moves on');
  await b.close();
})();
