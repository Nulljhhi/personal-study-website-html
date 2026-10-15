// Fixes from bug report 3 (study-website-3-bugs-and-optimizations.md).
const { chromium } = require('./browser');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const url = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'index.html')).href;
const fx = (n) => path.join(__dirname, 'fixtures', n);
const tmp = (n) => path.join(os.tmpdir(), 'sw-r3-' + process.pid + '-' + n);

// A small zip writer (stored or deflated entries), so tests can build damaged zips.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(files, opts = {}) {
  const locals = [], centrals = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const deflate = !!f.deflate, body = deflate ? zlib.deflateRawSync(data) : data;
    const crc = f.crc !== undefined ? f.crc : crc32(data), size = f.size !== undefined ? f.size : data.length;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(size, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, body); centrals.push(ch, name); off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const UNIT = fs.readFileSync(fx('pictures-unit.txt'), 'utf8');
const PLAIN = 'unit_title: Plain Unit\n\nquestion: Q one?\nanswer: Alpha\nmedium_fake_answer_1: B\nmedium_fake_answer_2: C\nmedium_fake_answer_3: D\nhard_fake_answer_1: E\nhard_fake_answer_2: F\nhard_fake_answer_3: G\n';
// A picture's bytes from the stored fixture zip (from its first, local, header).
function storedFile(name) {
  const z = fs.readFileSync(fx('pictures-stored.zip')); const i = z.indexOf(Buffer.from(name));
  const n = z.readUInt16LE(i - 4), e = z.readUInt16LE(i - 2), size = z.readUInt32LE(i - 8);
  return z.subarray(i + n + e, i + n + e + size);
}

(async () => {
  const b = await chromium.launch();
  const mockInit = () => {
    const load = () => JSON.parse(localStorage.getItem('mockfs') || '{}');
    const save = fs => localStorage.setItem('mockfs', JSON.stringify(fs));
    window.__mock = { fail: {}, delay: {}, log: [] };
    window.__TAURI__ = { core: { invoke: async (cmd, a) => {
      window.__mock.log.push(cmd + (a && a.json ? ':' + a.json.length : ''));
      if (window.__mock.delay[cmd]) await new Promise(r => setTimeout(r, window.__mock.delay[cmd]));
      if (window.__mock.fail[cmd]) throw 'disk full';
      const f = load();
      if (cmd === 'read_progress') return f['progress/' + a.name] || '';
      if (cmd === 'write_progress') { f['progress/' + a.name] = a.json; save(f); return null; }
      if (cmd === 'save_checkpoint') { f['cp/' + a.id] = a.json; save(f); return null; }
      if (cmd === 'save_bank') return '/banks/' + a.name + '.txt';
      if (cmd === 'read_image') { const b = (window.__mock.images || {})[a.name]; if (!b) throw 'missing'; return b; }
      return ''; } } };
  };
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(mockInit);
  await page.addInitScript(() => { window.__STUDY_TEST_NO_MINIGAMES = true; });
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  const toasts = () => page.$$eval('#toast-stack .toast', e => e.map(x => x.textContent));
  const loadText = (text, name) => { const p = tmp(name); fs.writeFileSync(p, text); return page.setInputFiles('#file-input', p).then(() => page.waitForTimeout(400)); };
  const loadZip = (buf, name) => { const p = tmp(name); fs.writeFileSync(p, buf); return page.setInputFiles('#file-input', p).then(() => page.waitForTimeout(900)); };
  const err = (fn, arg) => page.evaluate(([fn, arg]) => { try { StudyApp.__test[fn](arg); return ''; } catch (e) { return e.message; } }, [fn, arg]);

  // ---- B02: bad section versions are refused quickly ----
  const t0 = Date.now();
  check(/damaged/.test(await err('migrate', { version: 3, completed: [], schemas: { garden: -1000000000 }, games: {} })), 'B02 negative schema refused');
  check(Date.now() - t0 < 2000, 'B02 refused promptly');
  for (const v of [1.5, 0, '2', 1e308]) check(/damaged/.test(await err('migrate', { version: 3, completed: [], schemas: { garden: v }, games: {} })), 'B02 schema ' + JSON.stringify(v) + ' refused');

  // ---- B03: a stream that expands past its declared size stops ----
  const bomb = zlib.deflateRawSync(Buffer.alloc(12 * 1024 * 1024));
  const bombRes = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    try { await StudyApp.__test.inflateEntry(bytes, 1024); return 'accepted'; } catch (e) { return e.message; }
  }, bomb.toString('base64'));
  check(/damaged/.test(bombRes), 'B03 over-expanding entry is refused: ' + bombRes);

  // ---- B13: a changed file in the zip fails its CRC check ----
  await loadZip(makeZip([{ name: 'u.txt', data: PLAIN, crc: 0 }]), 'badcrc.zip');
  check((await toasts()).some(t => /damaged/.test(t)) && await page.isVisible('#screen-landing'), 'B13 wrong CRC is refused');
  await loadZip(makeZip([{ name: 'u.txt', data: PLAIN, deflate: true }]), 'good.zip');
  check(await page.isVisible('#screen-home'), 'B13 a correct deflated zip still loads');
  await page.evaluate(() => StudyApp.showScreen('landing'));

  // ---- B23: invalid UTF-8 is refused, in a zip and a plain file ----
  const badUtf = Buffer.concat([Buffer.from('unit_title: '), Buffer.from([0xff]), Buffer.from(PLAIN.slice(PLAIN.indexOf('\n')))]);
  await loadZip(makeZip([{ name: 'u.txt', data: badUtf }]), 'badutf.zip');
  check((await toasts()).some(t => /UTF-8/.test(t)) && await page.isVisible('#screen-landing'), 'B23 bad UTF-8 in a zip is refused');
  { const p = tmp('badutf.txt'); fs.writeFileSync(p, badUtf); await page.setInputFiles('#file-input', p); await page.waitForTimeout(300); }
  check(await page.isVisible('#screen-landing'), 'B23 bad UTF-8 in a .txt is refused');

  // ---- Load the picture bank and keep its text (a saved bank) ----
  await page.setInputFiles('#file-input', fx('pictures.zip')); await page.waitForTimeout(900);
  const saved = await page.evaluate(() => StudyApp.state.unitText);
  const imgs = await page.evaluate(() => StudyApp.state.unit.questions.map(q => q.image || ''));

  // ---- B04: a saved bank with pictures loads from a plain .txt again ----
  await page.evaluate(() => StudyApp.showScreen('landing'));
  await loadText(saved, 'saved-bank.txt');
  check(await page.evaluate(() => !!(StudyApp.state.unit && StudyApp.state.unit.questions[1].image)), 'B04 saved bank .txt with pictures reloads');
  { const big = 'unit_title: Big\n\n' + ('question: ' + 'x'.repeat(200) + '?\nanswer: y\nmedium_fake_answer_1: a\nmedium_fake_answer_2: b\nmedium_fake_answer_3: c\nhard_fake_answer_1: d\nhard_fake_answer_2: e\nhard_fake_answer_3: f\n\n').repeat(26000);
    await page.evaluate(() => StudyApp.showScreen('landing'));
    await loadText(big, 'big-text.txt');
    check((await toasts()).some(t => /5 MB of text/.test(t)), 'B04 more than 5 MB of question text is still refused'); }

  // ---- B05: re-zipping a saved bank keeps its pictures; a loose picture replaces only its question ----
  await loadZip(makeZip([{ name: 'bank.txt', data: saved, deflate: true }]), 'rezip.zip');
  const re = await page.evaluate(() => StudyApp.state.unit.questions.map(q => q.image || ''));
  check(re.join() === imgs.join(), 'B05 embedded pictures survive a re-zip');
  // Give Q4 the cell picture instead of the map.
  await loadZip(makeZip([{ name: 'bank.txt', data: saved }, { name: 'images/Img.Q4.png', data: storedFile('images/Img.Q1.png') }]), 'replace.zip');
  const rep = await page.evaluate(() => StudyApp.state.unit.questions.map(q => q.image || ''));
  check(rep[3] === imgs[0] && rep[0] === imgs[0] && rep[1] === imgs[1], 'B05 replacing Q4 changes only Q4');

  // ---- B14: CR-only line endings with a picture section ----
  const crOnly = saved.replace(/\r\n|\n/g, '\r');
  const crRes = await page.evaluate((t) => { try { const u = StudyApp.parseUnitFile(t); return u.questions.filter(q => q.image).length; } catch (e) { return e.message; } }, crOnly);
  check(crRes === 3, 'B14 CR-only bank keeps its pictures: ' + crRes);

  // ---- B06: the picture is part of a question's identity ----
  const keys = await page.evaluate((t) => {
    const a = StudyApp.parseUnitFile(t);
    // Give Q1 Q2's picture (with its id), as a re-zip with a new picture would.
    const q2 = t.match(/^Img\.Q2\.png \d+x\d+ (#[0-9a-f]+: .+)$/m)[1];
    const swapped = t.replace(/^(Img\.Q1\.png \d+x\d+ )#[0-9a-f]+: .+$/m, (m, p) => p + q2);
    const b2 = StudyApp.parseUnitFile(swapped);
    return [StudyApp.__test.key(a.questions[0]), StudyApp.__test.key(b2.questions[0]), StudyApp.__test.key(StudyApp.parseUnitFile(t).questions[0])];
  }, saved);
  check(keys[0] !== keys[1] && keys[0] === keys[2], 'B06 different picture, different key; same picture, same key');

  // ---- O05: pictures show through shared Blob URLs; stored ones are fetched ----
  check(await page.evaluate(() => [...document.querySelectorAll('#qa-list img')].every(i => !i.src || i.src.startsWith('blob:'))), 'O05 list pictures use Blob URLs');
  check(/ #[0-9a-f]{28}: data:image\/png/.test(saved), 'O05 picture lines carry a stable id');
  const stored = await page.evaluate(async (t) => {
    // What the desktop app writes once a picture is in its picture folder.
    const asset = 'a'.repeat(64) + '.png';
    const text = t.replace(/^(Img\.Q1\.png \d+x\d+ #[0-9a-f]+: ).+$/m, (m, p) => p + 'asset:' + asset);
    const png = StudyApp.state.unit.questions[0].image;
    const bytes = Uint8Array.from(atob(png.slice(png.indexOf(',') + 1)), c => c.charCodeAt(0));
    window.__mock.images = { [asset]: bytes.buffer };
    const keyBefore = StudyApp.__test.key(StudyApp.parseUnitFile(t).questions[0]);
    const keyAfter = StudyApp.__test.key(StudyApp.parseUnitFile(text).questions[0]);
    StudyApp.loadUnitText(text);
    await new Promise(r => setTimeout(r, 300));
    const img = document.querySelector('#qa-list .qa-pair:first-child img');
    return { same: keyBefore === keyAfter, src: img && img.src, w: img && img.naturalWidth, asked: window.__mock.log.filter(c => c.startsWith('read_image')).length };
  }, saved);
  check(stored.same, 'O05 a stored picture keeps the same progress key');
  check(stored.src && stored.src.startsWith('blob:') && stored.w === 400 && stored.asked === 1, 'O05 a stored picture is fetched once and shown: ' + JSON.stringify(stored));

  // ---- B21: "copied" only after the clipboard takes it ----
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true }); });
  await page.evaluate(() => StudyApp.showScreen('home'));
  await page.click('#qa-list .qa-pair:first-child img', { position: { x: 5, y: 5 } }); await page.waitForTimeout(150);
  const coord = (await toasts()).filter(t => /^hotspot:/.test(t));
  check(coord.length && coord.every(t => !/\(copied\)/.test(t)), 'B21 a refused copy never says copied: ' + coord.slice(-1));

  // ---- B19: bank average counts picture time ----
  const avg = await page.evaluate(() => StudyApp.__test.avgWords());
  check(avg > 5, 'B19 picture banks include looking time for bots: ' + avg.toFixed(1));

  // ---- B24: unreadable progress shows on the bank tile ----
  const tile = await page.evaluate((t) => [StudyApp.__test.describeBank('a.txt', t, 'not JSON'), StudyApp.__test.describeBank('a.txt', t, ''), StudyApp.__test.describeBank('a.txt', t, { error: 'denied' })], PLAIN);
  check(tile[0].ok && tile[0].progressError && !tile[1].progressError && tile[2].progressError === 'denied', 'B24 damaged or unreadable progress is reported, none is fine');

  // ---- B15: unknown nested game fields survive a save ----
  await page.evaluate(() => StudyApp.showScreen('landing'));
  await page.evaluate((t) => { const f = JSON.parse(localStorage.getItem('mockfs') || '{}');
    f['progress/Plain Unit'] = JSON.stringify({ format: 'study-website-completed', version: 3, schemas: {}, unitTitle: 'Plain Unit', completed: [],
      games: { progress: { boss: { xp: 10, newField: 'keep me' } }, fishing: { coins: 5, stats: { reel: 1, newStat: 7 }, newTop: { a: 1 } }, futureGame: { x: 1 } } });
    localStorage.setItem('mockfs', JSON.stringify(f)); }, PLAIN);
  await loadText(PLAIN, 'plain.txt');
  await page.evaluate(() => StudyApp.__test.persist()); await page.waitForTimeout(300);
  const back = await page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('mockfs'))['progress/Plain Unit']).games);
  check(back.progress.boss.newField === 'keep me' && back.fishing.stats.newStat === 7 && back.fishing.newTop.a === 1 && back.futureGame.x === 1 && back.fishing.coins === 5,
    'B15 nested unknown fields round-trip: ' + JSON.stringify({ b: back.progress.boss, s: back.fishing.stats }));

  // ---- B09: a bank deleted by title stays unsaved, even reopened ----
  await page.evaluate(() => { StudyApp.__test.markDeleted('Plain Unit'); });
  await loadText(PLAIN, 'plain2.txt');
  check(await page.evaluate(() => StudyApp.state.bankDeleted === true), 'B09 a reopened copy of a deleted bank knows it was deleted');
  const before = await page.evaluate(() => window.__mock.log.filter(c => c.startsWith('write_progress')).length);
  await page.evaluate(() => StudyApp.__test.persist()); await page.waitForTimeout(200);
  check(await page.evaluate((n) => window.__mock.log.filter(c => c.startsWith('write_progress')).length === n, before), 'B09 no progress written for a deleted bank');
  await page.evaluate(() => StudyApp.showScreen('landing'));

  // ---- B01: a failed checkpoint is retried on quit, with the same data ----
  await loadText(PLAIN.replace('Plain Unit', 'Save Unit'), 'save.txt');
  await page.click('#mode-quiz-btn'); await page.click('#quiz-start-btn'); await page.waitForTimeout(150);
  await page.evaluate(() => { window.__mock.fail.save_checkpoint = true; });
  await page.click('#save-progress-btn'); await page.waitForTimeout(300);
  check(await page.evaluate(() => StudyApp.__test.failedWrites()) === 1, 'B01 the failed checkpoint is remembered');
  check(await page.evaluate(() => StudyApp.__test.flush()) === false, 'B01 quitting still knows it failed');
  await page.evaluate(() => { window.__mock.fail.save_checkpoint = false; window.__mock.log = []; });
  check(await page.evaluate(() => StudyApp.__test.flush()) === true, 'B01 retry on quit succeeds');
  const cps = await page.evaluate(() => window.__mock.log.filter(c => c.startsWith('save_checkpoint')));
  check(cps.length === 1 && await page.evaluate(() => StudyApp.__test.failedWrites()) === 0, 'B01 the original checkpoint was sent again: ' + cps.join());

  // ---- B08: a start that's still waiting is dropped after leaving the screen ----
  await page.evaluate(() => StudyApp.showScreen('landing'));
  await page.evaluate(() => { window.__mock.delay.read_progress = 600; });
  await loadText(PLAIN.replace('Plain Unit', 'Slow Unit'), 'slow.txt');
  await page.click('#mode-quiz-btn'); await page.click('#quiz-start-btn');
  await page.evaluate(() => StudyApp.showScreen('home'));
  await page.waitForTimeout(900);
  check(await page.evaluate(() => StudyApp.state.screen) === 'home', 'B08 a late start does not pull you back into the quiz');
  await page.evaluate(() => { window.__mock.delay.read_progress = 0; });

  // ---- B20 / B22: reset text and the Deep Delve tile ----
  await page.click('#mode-games-btn'); await page.waitForTimeout(150);
  const tiles = await page.$$eval('#games-grid .checkpoint-tile', e => e.map(x => x.textContent));
  const dv = tiles.findIndex(t => /Deep Delve/.test(t));
  check(/100 floors/.test(tiles[dv]) && !/25 floors/.test(tiles[dv]), 'B22 Deep Delve tile says 100 floors');
  await page.click(`#games-grid .checkpoint-tile:nth-child(${dv + 1})`); await page.waitForTimeout(200);
  await page.click('#game-reset-btn');
  check(/lanterns/.test(await page.textContent('#game-reset-hint')), 'B20 Deep Delve reset names what it deletes');
  await page.click('#game-reset-cancel-btn');
  await page.click('#game-setup-back-btn');
  const bb = tiles.findIndex(t => /Boss Battle/.test(t));
  await page.click(`#games-grid .checkpoint-tile:nth-child(${bb + 1})`); await page.waitForTimeout(200);
  await page.click('#game-reset-btn');
  check(/campaign stars, gear/.test(await page.textContent('#game-reset-hint')), 'B20 Boss Battle reset names what it deletes');
  await page.click('#game-reset-cancel-btn');
  await page.click('#game-setup-back-btn');

  // ---- B10: towers built between waves are saved straight away ----
  const td = tiles.findIndex(t => /Hold the Line/.test(t));
  await page.click(`#games-grid .checkpoint-tile:nth-child(${td + 1})`); await page.waitForTimeout(200);
  await page.click('#game-start-btn'); await page.waitForTimeout(300);
  await page.click('#td-slots .td-slot', { force: true }); await page.waitForTimeout(100);
  await page.click('#td-panel .td-build-btn:not([disabled])'); await page.waitForTimeout(200);
  const towers = await page.evaluate(() => { const g = StudyApp.__test.game(); return [g.td.run.towers.length, g.profile.run && g.profile.run.towers.length]; });
  check(towers[0] === 1 && towers[1] === 1, 'B10 the saved map has the new tower: ' + towers.join('/'));
  await page.click('#game-exit-btn'); await page.click('#game-quit-btn'); await page.waitForTimeout(200);

  // ---- B16 / B17: saved sessions ----
  const p2 = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p2.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p2.goto(url);
  await p2.evaluate(() => localStorage.clear());
  { const p = tmp('bank.txt'); fs.writeFileSync(p, fs.readFileSync(fx('bank.txt'))); await p2.setInputFiles('#file-input', p); await p2.waitForTimeout(300); }
  await p2.click('#mode-quiz-btn'); await p2.fill('#quiz-count', '3'); await p2.check('#instant-feedback'); await p2.uncheck('#type-tf');
  await p2.click('#quiz-start-btn'); await p2.waitForTimeout(150);
  const right = await p2.evaluate(() => StudyApp.state.quiz.choices[0].correctSlot);
  await p2.click(`#quiz-choices button.choice[data-slot="${right}"]`);
  const [dl] = await Promise.all([p2.waitForEvent('download'), p2.click('#save-progress-btn')]);
  const sessFile = tmp('session.json'); await dl.saveAs(sessFile);
  const sess = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
  // B16: an answer on a blank, hidden option is refused.
  const bad = JSON.parse(JSON.stringify(sess)); const wrong = ['a', 'b', 'c', 'd'].find(s => s !== bad.choices[1].correctSlot);
  bad.choices[1][wrong] = ''; bad.answers[1] = wrong;
  const badFile = tmp('bad-session.json'); fs.writeFileSync(badFile, JSON.stringify(bad));
  const p3 = await b.newPage(); p3.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p3.goto(url); await p3.evaluate(() => localStorage.clear());
  await p3.setInputFiles('#resume-file-input', badFile); await p3.waitForTimeout(300);
  check(!(await p3.isVisible('#screen-quiz')), 'B16 a checkpoint answering a hidden blank option is refused');
  // B17: restoring into a fresh browser marks the right instant answer completed.
  await p3.evaluate(() => localStorage.clear());
  await p3.setInputFiles('#resume-file-input', sessFile); await p3.waitForTimeout(400);
  const done = await p3.evaluate(() => StudyApp.state.quiz && StudyApp.__test.key && Object.keys(StudyApp.state.completed).length);
  check(await p3.isVisible('#screen-quiz') && done === 1, 'B17 the restored right answer is marked completed: ' + done);
  await b.close();
})();
