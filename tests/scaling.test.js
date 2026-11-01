// The page scales with the window in both directions and follows its
// orientation: landscape windows get the two-column layout, portrait
// windows the stacked one, and every size keeps growing or shrinking with
// the window (no stops), without sideways scrolling.
const { chromium } = require('./browser');
const path = require('path');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const url = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(url);
  await page.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'bank.txt'));
  await page.waitForSelector('#screen-home.active');

  const measure = async (w, h) => {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(80); // the refit runs on the next frame
    return page.evaluate(() => {
      const btn = document.getElementById('mode-quiz-btn').getBoundingClientRect();
      const title = document.querySelector('#screen-home .unit-title').getBoundingClientRect();
      return {
        zoom: parseFloat(document.documentElement.style.zoom),
        orientation: document.documentElement.getAttribute('data-orientation'),
        narrow: document.body.classList.contains('narrow'),
        btnW: btn.width, btnH: btn.height, titleH: title.height,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
  };

  // The designed size: a 1920x1080 window shows the layout at 125%.
  const full = await measure(1920, 1080);
  check(full.zoom === 1.25 && full.orientation === 'landscape' && !full.narrow, 'designed size: 125%, landscape: ' + JSON.stringify(full));

  // Shrinking the window step by step shrinks everything, all the way down.
  let prev = full, shrinks = true;
  for (const [w, h] of [[1600, 900], [1280, 720], [1000, 560], [700, 400], [480, 270], [320, 180]]) {
    const m = await measure(w, h);
    if (!(m.zoom < prev.zoom && m.btnW < prev.btnW && m.btnH < prev.btnH)) { shrinks = false; console.log('  at', w, h, JSON.stringify(m)); }
    if (m.overflow > 0) { shrinks = false; console.log('  sideways scroll at', w, h, m.overflow); }
    prev = m;
  }
  check(shrinks, 'shrinking the window shrinks the zoom and the buttons each step, down to 320x180: ' + prev.zoom);
  check(prev.orientation === 'landscape', 'a small landscape window keeps the landscape layout');

  // Growing past the design size grows everything too (no 125% stop).
  const big = await measure(3840, 2160);
  check(big.zoom === 2.5 && big.btnW > full.btnW * 1.9, '4K grows to 250%: ' + big.zoom);

  // Portrait windows switch to the stacked layout and still scale.
  const tall = await measure(900, 1600);
  check(tall.orientation === 'portrait' && tall.narrow, 'a tall window is portrait and stacked');
  const taller = await measure(450, 800);
  check(taller.orientation === 'portrait' && taller.zoom < tall.zoom && taller.btnW < tall.btnW && taller.overflow <= 0, 'shrinking a portrait window shrinks it too: ' + tall.zoom + ' -> ' + taller.zoom);

  // Rotating back to landscape returns to the two-column layout.
  const back = await measure(1600, 900);
  check(back.orientation === 'landscape' && !back.narrow, 'rotating back restores the landscape layout');
  await page.close();

  // A phone: portrait stays readable (at least 80%) and fits its width;
  // turned sideways it becomes landscape.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await ctx.newPage();
  phone.on('pageerror', e => console.log('PAGEERROR', e.message));
  await phone.goto(url);
  await phone.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'bank.txt'));
  await phone.waitForSelector('#screen-home.active');
  const p = await phone.evaluate(() => ({ zoom: parseFloat(document.documentElement.style.zoom), o: document.documentElement.getAttribute('data-orientation'), compact: document.body.classList.contains('compact'), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check(p.o === 'portrait' && p.zoom >= 0.8 && p.compact && p.overflow <= 0, 'phone portrait: readable, one column, no sideways scroll: ' + JSON.stringify(p));
  await phone.setViewportSize({ width: 844, height: 390 }); await phone.waitForTimeout(80);
  const l = await phone.evaluate(() => ({ o: document.documentElement.getAttribute('data-orientation'), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check(l.o === 'landscape' && l.overflow <= 0, 'phone turned sideways: landscape, no sideways scroll');
  await ctx.close();
  await b.close();
})();
