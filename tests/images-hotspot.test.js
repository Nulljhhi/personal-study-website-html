// .zip banks with images, and hotspot questions, in the study modes and a game.
const { chromium } = require('./browser');
const path = require('path');
const fs = require('fs');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const fx = (n) => path.join(__dirname, 'fixtures', n);
const page_url = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;

// Click a spot on the visible hotspot picture, in percent of its size.
async function clickSpot(page, sel, x, y) {
  const box = await page.$eval(sel + ' .hs-pad img', (img) => { const r = img.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  await page.mouse.click(box.l + box.w * x / 100, box.t + box.h * y / 100);
}

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  const toasts = () => page.$$eval('#toast-stack .toast', e => e.map(x => x.textContent));
  await page.goto(page_url);

  // ---- Parser rules ----
  const err = (t) => page.evaluate((t) => { try { StudyApp.parseUnitFile(t); return ''; } catch (e) { return e.message; } }, t);
  check(/needs an image.*Img\.Q1/.test(await err('unit_title: A\n\nquestion: Where?\nhotspot: 10, 20\n')), 'a hotspot question needs an image');
  check(/two numbers from 0 to 100/.test(await err('unit_title: A\n\nquestion: Where?\nhotspot: 10, 200\n')), 'hotspot coordinates are checked');
  check(/doesn't use "medium_fake_answer_1"/.test(await err('unit_title: A\n\nquestion: Where?\nhotspot: 10, 20\nmedium_fake_answer_1: x\n')), 'hotspot questions take no fakes');
  check(/no "hotspot" line/.test(await err('unit_title: A\n\nquestion: Where?\nhotspot_radius: 4\n')), 'a radius needs a hotspot');

  // ---- A .txt with hotspots but no images is refused ----
  await page.setInputFiles('#file-input', fx('pictures-unit.txt')); await page.waitForTimeout(200);
  check((await toasts()).some(t => /Img\.Q2/.test(t)), 'plain .txt with a hotspot asks for its image');
  check(await page.isVisible('#screen-landing'), 'stays on the landing screen');

  // ---- The .zip loads, images and all ----
  await page.setInputFiles('#file-input', fx('pictures.zip')); await page.waitForTimeout(800);
  check(await page.isVisible('#screen-home'), 'zip opens Home');
  check((await toasts()).some(t => /Loaded 3 images/.test(t)), 'says how many images loaded');
  const qs = await page.evaluate(() => StudyApp.state.unit.questions.map(q => ({ img: !!q.image, hs: q.hotspot || null, aspect: q.imageAspect })));
  check(qs[0].img && !qs[0].hs && qs[1].hs && qs[1].hs.r === 6 && qs[3].hs.r === 5 && !qs[2].img, 'images and hotspots attached: ' + JSON.stringify(qs.map(q => [q.img, q.hs && q.hs.r])));
  check(Math.abs(qs[1].aspect - 400 / 600) < 1e-9, 'image shape measured');
  check(await page.$$eval('#qa-list img', e => e.length) === 3, 'Home list shows the pictures');
  check(await page.$$eval('#qa-list .hs-target', e => e.length) === 2, 'hotspot rows show the circled spot');
  check(/data:image\/png;base64,/.test(await page.evaluate(() => StudyApp.state.unitText)), 'images are kept with the bank text');
  // Hit test: the radius is a circle on the real picture (600x400).
  const hits = await page.evaluate(() => { const q = StudyApp.state.unit.questions[1]; return [StudyApp.hotspotHit(q, 30, 60), StudyApp.hotspotHit(q, 35.9, 60), StudyApp.hotspotHit(q, 36.1, 60), StudyApp.hotspotHit(q, 30, 68.9), StudyApp.hotspotHit(q, 30, 69.1)]; });
  check(hits.join() === 'true,true,false,true,false', 'hit test uses the image shape: ' + hits.join());
  // Clicking a picture on Home reports its coordinates.
  await page.click('#qa-list .qa-pair:first-child img', { position: { x: 10, y: 10 } }); await page.waitForTimeout(100);
  check((await toasts()).some(t => /^hotspot: \d/.test(t)), 'clicking a list picture gives hotspot coordinates');

  // ---- Flashcards ----
  await page.click('#mode-flashcard-btn'); await page.waitForTimeout(100);
  await page.evaluate(() => StudyApp.startFlashcards(1, { order: 'bank' })); await page.waitForTimeout(100);
  check(await page.isVisible('#card-figure img'), 'flashcard shows the picture');
  await page.click('#next-card-btn'); await page.click('#flip-btn'); await page.waitForTimeout(100);
  check(await page.isVisible('#card-figure .hs-target'), 'hotspot card back circles the spot');
  await page.click('#screen-flashcard .return-home'); await page.waitForTimeout(100);

  // ---- Matching skips hotspot questions ----
  await page.evaluate(() => StudyApp.startMatch(4, 3)); await page.waitForTimeout(100);
  const tiles = await page.evaluate(() => StudyApp.state.match.pairs.map(p => !!p.hotspot));
  check(tiles.length === 3 && tiles.every(x => !x), 'matching uses only written-answer questions');
  await page.evaluate(() => StudyApp.showScreen('home'));

  // ---- Quiz with instant feedback ----
  await page.click('#mode-quiz-btn'); await page.waitForTimeout(100);
  await page.fill('#quiz-count', '5');
  await page.check('#instant-feedback');
  await page.click('#quiz-start-btn'); await page.waitForTimeout(100);
  const order = await page.evaluate(() => StudyApp.state.quiz.order.map(q => q.id));
  const toQ = async (id) => { while (await page.evaluate(() => StudyApp.state.quiz.index) > 0) await page.click('#quiz-prev-btn'); for (let i = 0; i < order.indexOf(id); i++) await page.click('#quiz-next-btn'); };
  await toQ(0);
  check(await page.isVisible('#quiz-qbox.with-image #quiz-figure img') && await page.isVisible('#quiz-choices button.choice'), 'picture question: image beside the text, choices below');
  await toQ(1);
  check(await page.isVisible('#quiz-qbox.hotspot .hs-pad') && !(await page.isVisible('#quiz-choices')), 'hotspot question: picture to click, no choices');
  await clickSpot(page, '#quiz-figure', 30.5, 59);
  const picked = (await page.evaluate(() => StudyApp.state.quiz.answers[StudyApp.state.quiz.index])).match(/^hs:([\d.]+),([\d.]+)$/);
  check(picked && Math.abs(picked[1] - 30.5) < 0.3 && Math.abs(picked[2] - 59) < 0.3, 'the click is the answer: ' + (picked && picked[0]));
  check(/Correct/.test(await page.textContent('#quiz-feedback')), 'a click on the spot is right');
  check(await page.isVisible('#quiz-figure .hs-target'), 'the spot is shown after answering');
  await clickSpot(page, '#quiz-figure', 80, 80);
  check(/^hs:30/.test(await page.evaluate(() => StudyApp.state.quiz.answers[StudyApp.state.quiz.index])), 'with instant feedback the first click is final');
  await toQ(3);
  await clickSpot(page, '#quiz-figure', 10, 90);
  check(/Not quite/.test(await page.textContent('#quiz-feedback')), 'a click elsewhere is wrong');
  check(await page.isVisible('#quiz-figure .hs-marker.miss'), 'a missed pick shows in red');
  // Keyboard: arrows move a cursor on the picture, Enter picks.
  await page.evaluate(() => StudyApp.showScreen('home'));

  // ---- Checkpoint round trip (browser: download, then resume) ----
  await page.click('#mode-quiz-btn'); await page.waitForTimeout(100);
  await page.fill('#quiz-count', '5'); await page.uncheck('#instant-feedback');
  await page.click('#quiz-start-btn'); await page.waitForTimeout(100);
  const order2 = await page.evaluate(() => StudyApp.state.quiz.order.map(q => q.id));
  for (let i = 0; i < order2.indexOf(3); i++) await page.click('#quiz-next-btn');
  await page.focus('#quiz-figure .hs-pad');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  const kb = await page.evaluate(() => StudyApp.state.quiz.answers[StudyApp.state.quiz.index]);
  check(kb === 'hs:75,25', 'arrow keys and Enter pick a spot: ' + kb);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save-progress-btn')]);
  const saved = path.join(require('os').tmpdir(), 'hs-progress.json');
  await dl.saveAs(saved);
  check(/data:image\/png/.test(fs.readFileSync(saved, 'utf8')), 'the checkpoint carries the images');
  await page.evaluate(() => StudyApp.showScreen('landing'));
  await page.setInputFiles('#resume-file-input', saved); await page.waitForTimeout(500);
  check(await page.isVisible('#screen-quiz'), 'checkpoint resumes');
  check(await page.evaluate(() => StudyApp.state.quiz.answers.indexOf('hs:75,25') !== -1 && !!StudyApp.state.unit.questions[3].image), 'resumed with the hotspot answer and images');
  // Submit: the hotspot answer counts and marks the question completed.
  await page.click('#submit-quiz-btn'); await page.waitForTimeout(100);
  if (await page.isVisible('#submit-modal')) { await page.click('#submit-modal button.primary'); await page.waitForTimeout(100); }
  check(await page.isVisible('#screen-quiz-review'), 'review page');
  const rev = await page.evaluate(() => StudyApp.state.completed);
  check(Object.keys(rev).length >= 1, 'the right hotspot pick is marked completed');
  const hsPage = await page.evaluate(() => StudyApp.state.quiz.order.findIndex(q => q.id === 3));
  for (let i = 0; i < hsPage; i++) await page.click('#review-next-btn');
  check(await page.isVisible('#review-list .hs-target') && /on the spot/.test(await page.textContent('#review-list')), 'review shows the spot and the pick');
  await page.evaluate(() => StudyApp.showScreen('home'));

  // ---- Stored (uncompressed) zip, and the built-in inflate without DecompressionStream ----
  const p2 = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p2.on('pageerror', e => console.log('PAGEERROR', e.message));
  // No DecompressionStream and no Worker: the built-in inflate, on the page.
  await p2.addInitScript(() => { delete window.DecompressionStream; delete window.Worker; });
  await p2.goto(page_url);
  await p2.setInputFiles('#file-input', fx('pictures.zip')); await p2.waitForTimeout(800);
  check(await p2.evaluate(() => StudyApp.state.unit && StudyApp.state.unit.questions[1].image.length > 100), 'built-in inflate reads the zip');
  await p2.setInputFiles('#file-input', fx('pictures-stored.zip')); await p2.waitForTimeout(800);
  check(await p2.evaluate(() => StudyApp.state.unit && !!StudyApp.state.unit.questions[3].image), 'stored zip reads');
  await p2.close();

  // ---- A game: a hotspot question is answered on the picture ----
  await page.clock.install();
  await page.evaluate(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  await page.click('#mode-games-btn'); await page.clock.runFor(100);
  await page.click('#games-grid .checkpoint-tile:nth-child(2)'); await page.clock.runFor(200);
  await page.click('#game-start-btn'); await page.clock.runFor(300);
  let sawHs = false, sawImg = false;
  for (let i = 0; i < 30 && !(sawHs && sawImg) && await page.isVisible('#screen-game'); i++) {
    const g = await page.evaluate(() => { const c = StudyApp.__test.game().current; return { id: c.q.id, hs: c.hs, img: !!c.q.image }; });
    if (g.img && !g.hs) sawImg = sawImg || await page.isVisible('#game-qbox.with-image img');
    if (g.hs && !sawHs) {
      sawHs = true;
      const spot = await page.evaluate(() => StudyApp.__test.game().current.q.hotspot);
      // Fog over the answers blocks the picture too.
      await page.evaluate(() => document.getElementById('game-choices').classList.add('fogged'));
      await clickSpot(page, '#game-figure', spot.x, spot.y);
      check(await page.evaluate(() => !StudyApp.__test.game().locked), 'fog stops a hotspot answer');
      await page.evaluate(() => document.getElementById('game-choices').classList.remove('fogged'));
      // With the picture focused, a minigame still gets its arrow keys.
      await page.focus('#game-figure .hs-pad');
      await page.evaluate(() => { StudyApp.__test.game().minigame = { kind: 'dodge', seq: ['arrowleft', 'arrowright'], step: 0, done: false, time: 99999, total: 99999, level: 1 }; });
      await page.keyboard.press('ArrowLeft');
      const mg = await page.evaluate(() => [StudyApp.__test.game().minigame.step, !!document.querySelector('#game-figure .hs-marker.cursor')]);
      check(mg[0] === 1 && !mg[1], 'a minigame gets the arrow key, not the picture: ' + mg.join());
      await page.evaluate(() => { StudyApp.__test.game().minigame = null; const m = document.getElementById('minigame'); if (m) m.remove(); });
      await clickSpot(page, '#game-figure', spot.x, spot.y);
      check(await page.evaluate(() => StudyApp.__test.game().correct) >= 1 && await page.$eval('#game-feedback', e => e.classList.contains('right')), 'a game hotspot pick on the spot is right');
      check(await page.isVisible('#game-figure .hs-target'), 'the game shows the spot after answering');
    } else if (g.hs) {
      const spot = await page.evaluate(() => StudyApp.__test.game().current.q.hotspot);
      await clickSpot(page, '#game-figure', spot.x, spot.y);
    } else {
      await page.evaluate(() => { const c = StudyApp.__test.game().current; document.querySelector('#game-choices button.choice[data-slot="' + c.correctSlot + '"]').click(); });
    }
    await page.clock.runFor(1600);
  }
  check(sawHs, 'a hotspot question came up in the game');
  check(sawImg, 'a picture question shows its picture in the game');
  await b.close();
})();
