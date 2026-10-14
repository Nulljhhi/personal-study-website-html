// The pure core, run in plain Node with no browser: 01-core.js (parsing,
// hotspots, hashing, wrong-answer picking) and the zip reader that runs in
// a worker (makeZipKit in 13-zip-and-images.js). tools/check-scripts.js
// makes sure both keep standing alone, so they can be loaded like this.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const espree = require('module').createRequire(require.resolve('eslint'))('espree');
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const scripts = path.join(__dirname, '..', 'app', 'scripts');
const fx = (n) => path.join(__dirname, 'fixtures', n);

/* Runs the code in a fresh context and hands back everything it declares
   at the top level. */
function load(code, extra) {
  const ast = espree.parse(code, { ecmaVersion: 2022 });
  const names = [];
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') names.push(node.id.name);
    if (node.type === 'VariableDeclaration') node.declarations.forEach((d) => d.id.type === 'Identifier' && names.push(d.id.name));
  }
  const context = vm.createContext(Object.assign({ TextDecoder, btoa, atob, DecompressionStream: undefined, Uint8Array, Promise }, extra));
  return vm.runInContext('"use strict";\n' + code + '\n;({' + names.join(',') + '})', context);
}
const core = load(fs.readFileSync(path.join(scripts, '01-core.js'), 'utf8'));

// Size limits are in UTF-8 bytes, counted the way they're stored.
for (const t of ['', 'abc', 'é', '界'.repeat(1000), '😀x', '\ud800', 'a\udc00b', 'mixed é界😀 text']) {
  check(core.utf8Bytes(t) === Buffer.byteLength(t, 'utf8'), 'utf8Bytes counts ' + JSON.stringify(t.slice(0, 8)) + ' as ' + Buffer.byteLength(t, 'utf8'));
}
const zipSource = fs.readFileSync(path.join(scripts, '13-zip-and-images.js'), 'utf8');
const kitAst = espree.parse('(function(){' + zipSource + '})', { ecmaVersion: 2022, range: true });
const kitNode = kitAst.body[0].expression.body.body.find((d) => d.type === 'FunctionDeclaration' && d.id.name === 'makeZipKit');
const hashNode = espree.parse(fs.readFileSync(path.join(scripts, '01-core.js'), 'utf8'), { ecmaVersion: 2022, range: true }).body
  .find((d) => d.type === 'FunctionDeclaration' && d.id.name === 'hashText');
const coreText = fs.readFileSync(path.join(scripts, '01-core.js'), 'utf8');
const kitCode = coreText.slice(...hashNode.range) + '\n' + ('(function(){' + zipSource + '})').slice(...kitNode.range);
// Without DecompressionStream (the built-in decoder), and with Node's.
const kit = load(kitCode).makeZipKit();
const streamKit = load(kitCode, { DecompressionStream, Blob, Response }).makeZipKit();

// The hash of one question, as saved progress files already have it.
const PINNED_KEY = '0ed450db8dddbe07d36d3c2b3f04';

(async () => {
  // Completion keys and picture IDs are hashes of text; if this changes,
  // everyone's saved progress stops matching their questions.
  check(/^[0-9a-f]{28}$/.test(core.hashText('')), 'hashText is 28 hex digits');
  check(core.hashText('What is 2 + 2?\n4') === PINNED_KEY, 'hashText is unchanged (saved progress depends on it): ' + core.hashText('What is 2 + 2?\n4'));

  // Parsing.
  const block = (q, a) => `question: ${q}\nanswer: ${a}\nmedium_fake_answer_1: m1\nmedium_fake_answer_2: m2\nmedium_fake_answer_3: m3\nhard_fake_answer_1: h1\nhard_fake_answer_2: h2\nhard_fake_answer_3: h3\n\n`;
  const unit = core.parseUnitFile('unit_title: Picture Test; Oct 2026\n\n' + block('Q1?', 'A1') + block('What is 2 + 2?', '4'));
  check(unit.unitTitle === 'Picture Test; Oct 2026', 'unit title');
  check(unit.questions.length === 2 && unit.questions[1].answer === '4' && unit.questions[1].question === 'What is 2 + 2?', 'questions and answers');
  let err = '';
  try { core.parseUnitFile('unit_title: X\n\nquestion: Q?\n'); } catch (e) { err = e.message; }
  check(/answer/i.test(err), 'a question with no answer is refused: ' + err);
  try { err = ''; core.parseUnitFile('unit_title: X\n\nquestion: Where?\nhotspot: 30, 60\n'); } catch (e) { err = e.message; }
  check(/picture|image/i.test(err), 'a hotspot question needs a picture: ' + err);
  const crlf = core.parseUnitFile(('unit_title: Y\n\n' + block('A?', 'B')).replace(/\n/g, '\r\n'));
  check(crlf.questions[0].answer === 'B', 'CRLF line endings');

  // Pictures and hotspots.
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const bundled = core.bundleImages('unit_title: Z\n\nquestion: Where?\nhotspot: 50, 50\n', { 1: { name: 'Img.Q1.png', src: png, width: 200, height: 100 } });
  for (const nl of ['\n', '\r\n', '\r']) {
    const pic = core.parseUnitFile(bundled.replace(/\n/g, nl));
    const q = pic.questions[0];
    check(q.image === png && q.imageAspect === 0.5 && q.hotspot.r === core.HOTSPOT_RADIUS, 'picture attached (' + JSON.stringify(nl) + ')');
  }
  const q = core.parseUnitFile(bundled).questions[0];
  check(core.hotspotHit(q, 55, 50) && !core.hotspotHit(q, 57, 50), 'hit test across the width');
  // The picture is half as tall as wide, so 10% of its height is 5% of its width.
  check(core.hotspotHit(q, 50, 61) && !core.hotspotHit(q, 50, 63), 'hit test is a true circle on a wide picture');
  check(core.hotspotAnswerRight(q, core.hotspotAnswer(52.123, 49.5)) && !core.hotspotAnswerRight(q, 'hs:90,90') && !core.hotspotAnswerRight(q, 'a'), 'stored picks');
  check(core.parseHotspotAnswer('hs:101,5') === null, 'picks outside the picture are refused');
  err = '';
  try { core.parseUnitFile(bundled.replace('base64,', 'base64,!!')); } catch (e) { err = e.message; }
  check(/damaged/.test(err), 'damaged picture lines are refused');

  // Wrong answers: deterministic for a seed, never the right answer.
  const big = core.parseUnitFile(fs.readFileSync(fx('big.txt'), 'utf8'));
  const one = big.questions[5];
  const w1 = core.wrongAnswersFor(big, one, 'medium', 1234), w2 = core.wrongAnswersFor(big, one, 'medium', 1234);
  check(JSON.stringify(w1) === JSON.stringify(w2) && w1.length === 3, 'same seed, same wrong answers');
  check(w1.indexOf(one.answer) === -1, 'the right answer is never a wrong one');
  const mc = core.buildMcChoices(big, one, 'hard', 99);
  check(mc[mc.correctSlot] === one.answer, 'the right answer sits in its slot');

  // The zip reader, as the worker runs it.
  const opts = { maxZip: 40 << 20, maxImage: 8 << 20, maxImagesTotal: 25 << 20, maxText: 40 << 20, types: core.IMAGE_TYPES, nameRe: core.IMAGE_NAME_RE.source };
  for (const name of ['pictures.zip', 'pictures-stored.zip']) {
    const out = await kit.extract(new Uint8Array(fs.readFileSync(fx(name))), opts);
    check(/^unit_title: Picture Test/.test(out.text) && out.images.length >= 2 && out.images.every((im) => /^[0-9a-f]{28}$/.test(im.id)), name + ': unit file and ' + out.images.length + ' pictures');
    check(out.images.every((im) => core.imageId('data:' + im.type + ';base64,' + im.b64) === im.id), name + ': worker IDs match the page\'s');
  }
  const viaStream = await streamKit.extract(new Uint8Array(fs.readFileSync(fx('pictures.zip'))), opts);
  const viaOwn = await kit.extract(new Uint8Array(fs.readFileSync(fx('pictures.zip'))), opts);
  check(viaStream.text === viaOwn.text && JSON.stringify(viaStream.images) === JSON.stringify(viaOwn.images), 'DecompressionStream and the built-in decoder agree');
  // The built-in decoder agrees with zlib.
  const sample = Buffer.from('Study Website '.repeat(5000) + Array.from({ length: 3000 }, (_, i) => String.fromCharCode(32 + (i * 7919) % 90)).join(''));
  for (const level of [0, 1, 9]) {
    const raw = zlib.deflateRawSync(sample, { level });
    check(Buffer.from(kit.inflateRaw(new Uint8Array(raw), sample.length)).equals(sample), 'inflateRaw matches zlib at level ' + level);
  }
  // Some Windows tools write "unit\\Img.Q1.png": the pictures are still found.
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const storedZip = (files) => {
    const parts = [], central = []; let off = 0;
    for (const [name, data] of files) {
      const n = Buffer.from(name), d = Buffer.from(data), h = Buffer.alloc(30), c = Buffer.alloc(46);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc(d), 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc(d), 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
      parts.push(h, n, d); central.push(c, n); off += 30 + n.length + d.length;
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return new Uint8Array(Buffer.concat([...parts, cd, end]));
  };
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
  const winZip = await kit.extract(storedZip([['unit\\unit.txt', 'unit_title: W\n'], ['unit\\Img.Q1.png', pngBytes], ['unit\\__MACOSX\\x', 'junk']]), opts);
  check(winZip.images.length === 1 && winZip.images[0].name === 'Img.Q1.png' && winZip.textName === 'unit.txt', 'backslash folders in a zip: ' + JSON.stringify(winZip.images.map((i) => i.name)));
  err = '';
  try { await kit.extract(new Uint8Array(fs.readFileSync(fx('pictures.zip'))).slice(0, 200), opts); } catch (e) { err = e.message; }
  check(err.length > 0, 'a cut-off zip is refused: ' + err);
  err = '';
  try { kit.decodeUnitBytes(new Uint8Array([0x75, 0xff, 0x6e]), 'bad.txt'); } catch (e) { err = e.message; }
  check(/UTF-8/.test(err), 'text that isn\'t UTF-8 is refused');
})().catch((e) => { console.log('FAIL', e && e.stack || e); process.exitCode = 1; });
