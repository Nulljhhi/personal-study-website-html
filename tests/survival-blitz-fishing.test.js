const { chromium } = require('./browser');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1920, height: 1080 } }); await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.clock.install();
  await page.addInitScript(() => {
    const load = () => JSON.parse(localStorage.getItem('mockfs') || '{}');
    const save = fs => localStorage.setItem('mockfs', JSON.stringify(fs));
    window.__TAURI__ = { core: { invoke: async (cmd, a) => { const fs = load();
      if (cmd === 'read_progress') return fs['progress/' + a.name] || '';
      if (cmd === 'write_progress') { fs['progress/' + a.name] = a.json; save(fs); return null; }
      return ''; } } };
  });
  await page.goto(require('url').pathToFileURL(require('path').join(__dirname, '..', 'src', 'index.html')).href);
  await page.evaluate(() => localStorage.clear());
  const loadBank = async () => { await page.setInputFiles('#file-input', require('path').join(__dirname, 'fixtures', 'big.txt')); await page.clock.runFor(300); };
  await loadBank();
  const answers = await page.$$eval('#qa-list .qa-pair', els => Object.fromEntries(els.map(e => [e.querySelector('.qa-q').firstChild.textContent, e.querySelector('.qa-a').textContent])));
  const ans = async (right) => {
    const q = await page.textContent('#game-question');
    const btns = await page.$$('#game-choices button.choice');
    for (let i = 0; i < btns.length; i++) { const bt = btns[i]; if (await bt.evaluate(e => e.classList.contains('removed'))) continue; const t = await bt.evaluate(e => e.lastChild.textContent); if ((t === answers[q]) === right) { if (await bt.evaluate(e => e.classList.contains('struck'))) await page.clock.runFor(2100); await page.keyboard.press(String(i + 1)); return; } }
  };
  const disk = () => page.evaluate(() => { const fs = JSON.parse(localStorage.getItem('mockfs') || '{}'); const k = Object.keys(fs).find(k => k.startsWith('progress/')); return k ? JSON.parse(fs[k]) : null; });
  const open = async (n) => {
    await page.click('#mode-games-btn'); await page.clock.runFor(100);
    await page.click(`#games-grid .checkpoint-tile:nth-child(${n})`); await page.clock.runFor(200);
    await page.uncheck('#game-type-tf');
    const mod = await page.$('#game-modifier'); if (mod && await mod.isVisible()) await page.uncheck('#game-modifier');
  };
  // ---- Survival ----
  await open(2);
  check(await page.isVisible('#game-survival-options'), 'survival perks panel');
  const perks = await page.$$eval('#survival-perks input', e => e.map(x => x.value + (x.disabled ? '(x)' : '') + (x.checked ? '*' : '')));
  check(perks[0] === 'chill*' && perks[1] === 'tough(x)', 'perks: ' + perks.join(' '));
  await page.click('#game-start-btn'); await page.clock.runFor(200);
  check(/Freeze\s*×\s*1/.test(await page.textContent('#game-powerups')), 'Chill perk gives a Freeze: ' + await page.textContent('#game-powerups'));
  check((await page.textContent('#arena-sub')).startsWith('Meadow'), 'starts in the Meadow');
  for (let i = 0; i < 15; i++) { await ans(true); await page.clock.runFor(1500); }
  check((await page.textContent('#arena-sub')).startsWith('Storm'), 'biome 2 after 15: ' + await page.textContent('#arena-sub'));
  check(await page.$$eval('#game-choices button.choice.struck', e => e.length) === 1, 'storm hides one answer');
  await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'shot.png') });
  for (let i = 0; i < 12; i++) { await ans(true); await page.clock.runFor(1500); }
  await page.clock.runFor(2000);
  for (let i = 0; i < 20 && await page.isVisible('#screen-game'); i++) { await ans(false); await page.clock.runFor(3000); }
  check(await page.isVisible('#screen-game-results'), 'survival over');
  let d = await disk();
  check(d.games.survival.best >= 25, 'best saved: ' + d.games.survival.best);
  await page.click('#game-results-home-btn'); await page.clock.runFor(100);
  await open(2);
  const perks2 = await page.$$eval('#survival-perks input', e => e.map(x => x.value + (x.disabled ? '(x)' : '')));
  check(perks2[1] === 'tough', 'Tough unlocked by reaching 25');
  await page.click('#survival-perks input[value="tough"]');
  check(await page.$$eval('#survival-perks input:checked', e => e.length) === 1, 'one slot: picking Tough drops Chill');
  await page.click('#game-start-btn'); await page.clock.runFor(200);
  check(await page.$$eval('#game-hearts span', e => e.length) === 4, 'Tough gives 4 hearts');
  await page.click('#game-exit-btn'); await page.click('#game-quit-btn'); await page.clock.runFor(200);
  // ---- Blitz league ----
  await open(3);
  check(await page.isVisible('#game-blitz-options') && !(await page.isVisible('#game-bots-row')), 'blitz options, bots row hidden for league');
  const modes = await page.$$eval('#blitz-mode option', e => e.map(o => o.value + (o.disabled ? '(x)' : '')));
  check(modes.join() === 'league,classic,sprint(x),marathon(x),sudden(x),tfonly(x)', 'modes: ' + modes.join());
  await page.click('#game-start-btn'); await page.clock.runFor(200);
  check(await page.isVisible('#game-board'), 'league plays against bots');
  for (let i = 0; i < 40 && await page.isVisible('#screen-game'); i++) { await ans(true); await page.clock.runFor(700); }
  await page.clock.runFor(70000);
  check(await page.isVisible('#screen-game-results'), 'blitz over');
  const place = await page.textContent('#game-results-place');
  check(/Bronze league/.test(place), 'league note: ' + place);
  d = await disk();
  console.log('   league:', JSON.stringify(d.games.blitz));
  await page.click('#game-results-home-btn'); await page.clock.runFor(100);
  // Seed level 12 and gold tier for variants/themes
  await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('mockfs')); const k = Object.keys(fs).find(k => k.startsWith('progress/'));
    const d = JSON.parse(fs[k]); d.games.progress.blitz.xp = 7000; d.games.blitz.tier = 2; d.games.blitz.bestTier = 2;
    fs[k] = JSON.stringify(d); localStorage.setItem('mockfs', JSON.stringify(fs));
  });
  await page.reload(); await page.clock.runFor(300); await loadBank();
  await open(3);
  await page.selectOption('#blitz-mode', 'sudden'); await page.selectOption('#blitz-theme', 'gold');
  check(!(await page.isVisible('#game-bots-row')), 'no bots for Sudden Death'); await page.selectOption('#blitz-mode', 'sprint'); check(await page.isVisible('#game-bots-row'), 'bots option back for Sprint'); await page.selectOption('#blitz-mode', 'sudden');
  await page.click('#game-start-btn'); await page.clock.runFor(200);
  check(await page.$eval('#game-arena', e => e.classList.contains('blitz-theme-gold')), 'gold theme applied');
  check((await page.textContent('#arena-big')).trim() === '90', 'sudden death has 90 s');
  await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'shot.png') });
  await ans(true); await page.clock.runFor(700); await ans(false); await page.clock.runFor(800);
  check(await page.isVisible('#screen-game-results'), 'one miss ends Sudden Death');
  await page.click('#game-results-home-btn'); await page.clock.runFor(100);
  // ---- Fishing ----
  await open(4);
  await page.click('#game-start-btn'); await page.clock.runFor(200);
  const sub = await page.textContent('#arena-sub');
  check(/^(Sunny|Cloudy|Rain|Storm) · (Morning|Noon|Evening|Night) · /.test(sub), 'weather and time shown: ' + sub);
  await page.click('#game-shop-btn'); await page.clock.runFor(100);
  await page.click('#fish-shop-tabs button[data-tab="bounty"]'); await page.clock.runFor(100);
  check((await page.$$('#fish-shop-list .shop-card')).length === 3, 'three bounties');
  const bounty = await page.textContent('#fish-shop-list .shop-card');
  console.log('   bounty:', bounty);
  await page.click('#fish-shop-tabs button[data-tab="aquarium"]'); await page.clock.runFor(100);
  check(await page.isVisible('.fish-tank'), 'aquarium tank');
  await page.click('#fish-shop-close-btn');
  // catch a few fish then check aquarium has fish
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Space'); await page.clock.runFor(6000); if (await page.isVisible('#game-question-pane')) { await ans(true); await page.clock.runFor(2000); } }
  await page.click('#game-shop-btn'); await page.clock.runFor(100);
  await page.click('#fish-shop-tabs button[data-tab="aquarium"]'); await page.clock.runFor(100);
  check(await page.$$eval('.tank-fish', e => e.length) >= 1, 'caught fish swim in the aquarium');
  await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'shot.png') });
  await b.close();
})();
