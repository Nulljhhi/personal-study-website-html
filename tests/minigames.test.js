const { chromium } = require('./browser');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.clock.install();
  await page.goto(require('url').pathToFileURL(require('path').join(__dirname, '..', 'src', 'index.html')).href);
  await page.setInputFiles('#file-input', require('path').join(__dirname, 'fixtures', 'big.txt')); await page.clock.runFor(300);
  const answers = await page.$$eval('#qa-list .qa-pair', els => Object.fromEntries(els.map(e => [e.querySelector('.qa-q').firstChild.textContent, e.querySelector('.qa-a').textContent])));
  const ans = async () => { const q = await page.textContent('#game-question'); const tf = await page.isVisible('#game-tf-candidate');
    if (tf) { const c = await page.textContent('#game-tf-candidate'); await page.keyboard.press(c === answers[q] ? 't' : 'f'); return; }
    const btns = await page.$$('#game-choices button.choice'); for (let i = 0; i < btns.length; i++) if ((await btns[i].evaluate(e => e.lastChild.textContent)) === answers[q]) { await page.keyboard.press(String(i + 1)); return; } };
  await page.evaluate(() => { window.StudyApp.__test.minigames = 'always'; });
  await page.click('#mode-games-btn'); await page.click('#games-grid .checkpoint-tile:nth-child(1)'); await page.clock.runFor(200);
  const modes = await page.$$eval('#boss-mode option', e => e.map(o => o.value));
  await page.selectOption('#boss-mode', modes.find(v => v === 'endless') || modes[modes.length - 1]);
  await page.click('#game-start-btn'); await page.clock.runFor(500);
  check(!(await page.isVisible('#minigame')), 'no minigame on the first boss');
  await page.evaluate(() => { window.StudyApp.__test.game().boss.index = 4; });
  await ans(); await page.clock.runFor(1500);
  const solve = async (win) => {
    await page.clock.runFor(400);
    if (!(await page.isVisible('#minigame'))) return null;
    const title = await page.textContent('#minigame .mg-title'); await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'shot.png') });
    // While it's up, answers don't count.
    const before = await page.evaluate(() => window.StudyApp.__test.game().answered);
    await page.keyboard.press('1');
    const after = await page.evaluate(() => window.StudyApp.__test.game().answered);
    if (/Parry/.test(title)) {
      for (let i = 0; i < 400; i++) {
        const inside = await page.evaluate(() => { const M = window.StudyApp.__test.game().minigame; return M && !M.done && M.pos >= M.zoneAt && M.pos <= M.zoneAt + M.zone; });
        if (inside === win) { await page.keyboard.press('Space'); const M = await page.evaluate(() => { const m = window.StudyApp.__test.game().minigame; return m && !m.done; }); if (!M) break; }
        await page.clock.runFor(30);
      }
    } else {
      const keys = await page.$$eval('#minigame .mg-key', e => e.map(x => x.textContent));
      const map = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' };
      for (const k of keys) await page.keyboard.press(win ? (map[k] || k.toLowerCase()) : (map[k] ? (k === '←' ? 'ArrowRight' : 'ArrowLeft') : (k === 'J' ? 'k' : 'j')));
    }
    const res = await page.textContent('#minigame .mg-title').catch(() => '');
    return { title, res, blocked: before === after };
  };
  const r1 = await solve(true);
  check(r1 && r1.blocked, 'minigame shows and blocks answering: ' + JSON.stringify(r1));
  check(r1 && /Dodged|Parried|Rune complete/.test(r1.res), 'won the minigame: ' + (r1 && r1.res));
  await page.clock.runFor(800);
  check(!(await page.isVisible('#minigame')), 'minigame closes');
  await ans(); await page.clock.runFor(1500);
  const combo = await page.evaluate(() => window.StudyApp.__test.game().combo);
  const r2 = await solve(false);
  check(r2 && /Wrong|Missed|slow/.test(r2.res), 'lost the minigame: ' + (r2 && r2.res));
  check(await page.evaluate(() => window.StudyApp.__test.game().combo) === 0 && combo > 0, 'losing breaks the combo');
  await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'shot.png') });
  await b.close();
})();
