
  /* =====================================================================
     1. PURE CORE FUNCTIONS
     Seeded RNG, parser, distractor/choice builders, board tiles, docs.
     Everything in this section is deterministic and side-effect free.
     ===================================================================== */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* A 106-bit hash of a string, as 28 hex digits: cyrb53 twice with
     different seeds. Used for completion keys and picture IDs. */
  function hashText(text) {
    // cyrb53 twice with different seeds, as hex.
    function cyrb53(str, seed) {
      var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
      for (var i = 0; i < str.length; i++) {
        var ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
    }
    return cyrb53(text, 0) + cyrb53(text, 0x9e3779b9);
  }

  /* A string's size in UTF-8, as it's stored on disk: the size limits are
     in bytes, and a character can take up to four. Counted, not encoded,
     so a big bank isn't copied to measure it. */
  function utf8Bytes(text) {
    var n = text.length;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) continue;
      if (c < 0x800) { n += 1; continue; }
      // A surrogate pair is 2 units and 4 bytes; any other is 3 bytes.
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
        var d = text.charCodeAt(i + 1);
        if (d >= 0xdc00 && d < 0xe000) { n += 2; i++; continue; }
      }
      n += 2;
    }
    return n;
  }

  function seededShuffle(items, seed) {
    var copy = items.slice();
    var rng = mulberry32(seed);
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function deriveSeed(base, i) {
    return (base ^ (i * 0x9E3779B9)) >>> 0;
  }

  /* ------------------------- unit file parser ------------------------- */

  var UNIT_TITLE_TAG = "unit_title";
  var BLOCK_TAGS = [
    "question",
    "answer",
    "medium_fake_answer_1",
    "medium_fake_answer_2",
    "medium_fake_answer_3",
    "hard_fake_answer_1",
    "hard_fake_answer_2",
    "hard_fake_answer_3"
  ];

  function tagNameOf(line) {
    var colon = line.indexOf(":");
    if (colon === -1) return line;
    return line.slice(0, colon).trim();
  }

  function tagValueOf(line) {
    var colon = line.indexOf(":");
    if (colon === -1) return "";
    return line.slice(colon + 1).trim();
  }

  /* Own-property lookup for keys read from files, so names like
     "constructor" never match something inherited. */
  function hasOwn(obj, key) {
    return obj != null && typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);
  }

  var MAX_QUESTIONS = 20000;

  var FAKE_TAGS = ["medium_fake_answer_1", "medium_fake_answer_2", "medium_fake_answer_3",
    "hard_fake_answer_1", "hard_fake_answer_2", "hard_fake_answer_3"];

  /* Hotspot questions: "hotspot: x, y" marks the spot to click on the
     question's image, in percent of its width and height from the top
     left; "hotspot_radius" is the leeway, in percent of the width. They
     take no fake answers, and "answer" is an optional label. */
  var HOTSPOT_TAGS = ["hotspot", "hotspot_radius"];
  var HOTSPOT_RADIUS = 6;

  /* ------------------------------ Images ------------------------------
     A .zip bank is a unit file plus images named Img.Q<n>.<ext>, one per
     question number. On import the images are written into the bank's
     text after this line, one per line, so a saved bank or checkpoint
     carries its pictures with it:
       Img.Q3.png 800x600 #<id>: data:image/png;base64,...
     The id is a hash of the picture, made once, so progress keys (see
     rawQuestionKey) stay the same wherever the picture is kept. The desktop
     app keeps its saved pictures in one folder instead, and writes
       Img.Q3.png 800x600 #<id>: asset:<sha-256>.png
     (src-tauri/src/images.rs); the page loads those when it shows them. */
  var IMAGE_SECTION = "=== images (added by Study Website from a .zip; don't edit below this line) ===";
  var IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp" };
  var IMAGE_NAME_RE = /^Img\.Q(\d+)\.([A-Za-z0-9]+)$/i;

  function splitImageSection(text) {
    // The marker starts a line after any of the line endings the parser accepts.
    var mark = text.match(new RegExp("(?:\\r\\n|\\r|\\n)" + IMAGE_SECTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ \\t]*(?=\\r|\\n|$)"));
    if (!mark) return { text: text, images: {} };
    var at = mark.index;
    var head = text.slice(0, at), tail = text.slice(at + mark[0].length).split(/\r\n|\r|\n/);
    var images = {};
    tail.forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var m = line.match(/^(Img\.Q(\d+)\.[A-Za-z0-9]+) (\d{1,6})x(\d{1,6})(?: #([0-9a-f]{8,40}))?: (data:image\/(?:png|jpeg|gif|webp|svg\+xml|bmp);base64,[A-Za-z0-9+/=]+|asset:[0-9a-f]{64}\.(?:png|jpg|gif|webp|svg|bmp))$/);
      if (!m) throw new Error("The images at the end of this bank are damaged. Load the original .zip again.");
      var n = Number(m[2]), w = Number(m[3]), h = Number(m[4]);
      if (hasOwn(images, String(n))) throw new Error("This bank has two images for question " + n + ".");
      // A stored picture always has its id; an older inline one gets it from its data.
      if (!m[5] && m[6].indexOf("asset:") === 0) throw new Error("The images at the end of this bank are damaged. Load the original .zip again.");
      images[n] = { name: m[1], src: m[6], id: m[5] || imageId(m[6]), aspect: w > 0 && h > 0 ? h / w : 1, width: w, height: h };
    });
    return { text: head, images: images };
  }

  /* A picture's identity: a hash of its data (see hashText). */
  function imageId(src) { return hashText(src); }

  /* The bank text with images attached (images: { n: {name, src, width, height, id} }). */
  function bundleImages(text, images) {
    var keys = Object.keys(images || {}).map(Number).sort(function (a, b) { return a - b; });
    if (!keys.length) return text;
    return text.replace(/\s+$/, "") + "\n\n" + IMAGE_SECTION + "\n" + keys.map(function (n) {
      var im = images[n];
      return im.name + " " + Math.round(im.width || 0) + "x" + Math.round(im.height || 0) + " #" + (im.id || imageId(im.src)) + ": " + im.src;
    }).join("\n") + "\n";
  }

  function parseHotspot(value, b) {
    var m = value.replace(/%/g, "").match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    var x = m ? Number(m[1]) : NaN, y = m ? Number(m[2]) : NaN;
    if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) {
      throw new Error('Question block ' + b + ': "hotspot" needs two numbers from 0 to 100, the spot\'s x and y in percent of the image, for example "hotspot: 42, 37".');
    }
    return { x: x, y: y };
  }

  /* Did a click at (x, y) (percent of the image) land on the hotspot?
     The radius is in percent of the width, so y is scaled by the image's
     shape to measure a true circle. */
  function hotspotHit(question, x, y) {
    var h = question && question.hotspot;
    if (!h || !(x >= 0) || !(y >= 0)) return false;
    var aspect = question.imageAspect || 1;
    var dx = x - h.x, dy = (y - h.y) * aspect;
    return dx * dx + dy * dy <= h.r * h.r;
  }
  /* A hotspot pick is stored as "hs:x,y" so it fits where a choice slot goes. */
  function hotspotAnswer(x, y) { return "hs:" + (Math.round(x * 100) / 100) + "," + (Math.round(y * 100) / 100); }
  function parseHotspotAnswer(answer) {
    var m = typeof answer === "string" && answer.match(/^hs:(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    var x = Number(m[1]), y = Number(m[2]);
    return x <= 100 && y <= 100 ? { x: x, y: y } : null;
  }
  function hotspotAnswerRight(question, answer) {
    var p = parseHotspotAnswer(answer);
    return !!p && hotspotHit(question, p.x, p.y);
  }

  function parseUnitFile(text) {
    if (typeof text !== "string") {
      throw new Error("The unit file is empty or unreadable: no text content was found.");
    }
    var split = splitImageSection(text);
    text = split.text;
    var rawLines = text.split(/\r\n|\r|\n/);
    var lines = [];
    for (var i = 0; i < rawLines.length; i++) lines.push(rawLines[i].trim());

    var firstNonBlank = -1;
    for (var f = 0; f < lines.length; f++) {
      if (lines[f] !== "") { firstNonBlank = f; break; }
    }
    if (firstNonBlank === -1) {
      throw new Error("The unit file is empty or unreadable: no content was found.");
    }

    var titleLineCount = 0;
    var firstTitleLine = -1;
    for (var t = 0; t < lines.length; t++) {
      if (lines[t].indexOf(":") !== -1 && tagNameOf(lines[t]) === UNIT_TITLE_TAG) {
        titleLineCount++;
        if (firstTitleLine === -1) firstTitleLine = t;
      }
    }
    if (titleLineCount === 0) {
      throw new Error('Missing unit_title: the file must contain a "unit_title:" line naming the study unit.');
    }
    if (firstTitleLine !== firstNonBlank) {
      throw new Error("The unit_title must be the first non-blank line of the file.");
    }
    if (titleLineCount > 1) {
      throw new Error("Duplicate unit_title: the file may contain only one unit_title line.");
    }

    var unitTitle = tagValueOf(lines[firstNonBlank]);
    if (unitTitle === "") {
      throw new Error('Empty unit_title: write the unit\'s name after "unit_title:", for example "unit_title: Cell Biology; Sep 2026".');
    }

    var blocks = [];
    var current = null;
    for (var m = firstNonBlank + 1; m < lines.length; m++) {
      var line = lines[m];
      if (line === "") {
        if (current) { blocks.push(current); current = null; }
        continue;
      }
      if (!current) current = [];
      current.push(line);
    }
    if (current) blocks.push(current);

    if (blocks.length === 0) {
      throw new Error("No question blocks found: the file must contain at least one question block.");
    }
    if (blocks.length > MAX_QUESTIONS) {
      throw new Error("This bank has " + blocks.length + " questions; the limit is " + MAX_QUESTIONS + ". Split it into smaller banks.");
    }

    var questions = [];
    for (var b = 0; b < blocks.length; b++) {
      var blockLines = blocks[b];
      var firstTag = tagNameOf(blockLines[0]);
      if (firstTag !== "question") {
        throw new Error('Every question block must start with a "question:" line; block ' + (b + 1) + ' starts with "' + firstTag + '".');
      }
      var values = {};
      for (var l = 0; l < blockLines.length; l++) {
        var tag = tagNameOf(blockLines[l]);
        if (tag === UNIT_TITLE_TAG) {
          throw new Error("Duplicate unit_title: the file may contain only one unit_title line.");
        }
        if (BLOCK_TAGS.indexOf(tag) === -1 && HOTSPOT_TAGS.indexOf(tag) === -1) {
          throw new Error('Unknown tag "' + tag + '": the unit file format does not include this tag.');
        }
        if (Object.prototype.hasOwnProperty.call(values, tag)) {
          throw new Error('Duplicate tag "' + tag + '": each tag may appear only once per question block.');
        }
        var value = tagValueOf(blockLines[l]);
        if (value === "") {
          throw new Error('Empty value for tag "' + tag + '": every tag needs a value after the colon.');
        }
        values[tag] = value;
      }
      if (hasOwn(values, "hotspot") || hasOwn(values, "hotspot_radius")) {
        if (!hasOwn(values, "hotspot")) {
          throw new Error('Question block ' + (b + 1) + ' has "hotspot_radius" but no "hotspot" line saying where to click.');
        }
        FAKE_TAGS.forEach(function (ft) {
          if (hasOwn(values, ft)) throw new Error('Question block ' + (b + 1) + ' is a hotspot question, so it doesn\'t use "' + ft + '". Remove the fake answers.');
        });
        var spot = parseHotspot(values.hotspot, b + 1);
        var radius = HOTSPOT_RADIUS;
        if (hasOwn(values, "hotspot_radius")) {
          radius = Number(String(values.hotspot_radius).replace(/%$/, ""));
          if (!(radius >= 0.5 && radius <= 50)) {
            throw new Error('Question block ' + (b + 1) + ': "hotspot_radius" is the leeway in percent of the image width, a number from 0.5 to 50.');
          }
        }
        questions.push({
          id: questions.length,
          question: values.question,
          answer: hasOwn(values, "answer") ? values.answer : "",
          hotspot: { x: spot.x, y: spot.y, r: radius },
          mediumFakes: [],
          hardFakes: []
        });
        continue;
      }
      for (var r = 0; r < BLOCK_TAGS.length; r++) {
        if (!Object.prototype.hasOwnProperty.call(values, BLOCK_TAGS[r])) {
          throw new Error('Question block ' + (b + 1) + ' is missing the required tag "' + BLOCK_TAGS[r] + '".');
        }
      }
      // Every question needs three wrong answers that differ from the real
      // answer and from each other, or a multiple-choice card would repeat
      // an option or leave one blank.
      var distinct = new Set();
      var realKey = normalizeAnswer(values.answer);
      FAKE_TAGS.forEach(function (ft) { var fk = normalizeAnswer(values[ft]); if (fk !== realKey) distinct.add(fk); });
      if (distinct.size < 3) {
        throw new Error('Question block ' + (b + 1) + ' ("' + values.question + '") needs at least three fake answers that differ from the real answer and from each other.');
      }
      questions.push({
        id: questions.length,
        question: values.question,
        answer: values.answer,
        mediumFakes: [values.medium_fake_answer_1, values.medium_fake_answer_2, values.medium_fake_answer_3],
        hardFakes: [values.hard_fake_answer_1, values.hard_fake_answer_2, values.hard_fake_answer_3]
      });
    }

    Object.keys(split.images).forEach(function (n) {
      var q = questions[Number(n) - 1];
      if (!q) throw new Error("There's an image for question " + n + " (" + split.images[n].name + "), but the bank has only " + questions.length + " questions.");
      q.image = split.images[n].src;
      q.imageId = split.images[n].id;
      q.imageAspect = split.images[n].aspect;
    });
    questions.forEach(function (q, i) {
      if (q.hotspot && !q.image) {
        throw new Error("Question " + (i + 1) + ' ("' + q.question + '") is a hotspot question, so it needs an image: put the unit file in a .zip with an image named Img.Q' + (i + 1) + ".png (or .jpg).");
      }
    });
    var unit = { unitTitle: unitTitle, questions: questions };
    if (Object.keys(split.images).length) unit.images = split.images;
    return unit;
  }

  /* ------------------- distractors / choices / tiles ------------------- */

  function easyDistractors(unit, questionId, seed) {
    var own = null;
    var others = [];
    var questions = unit && unit.questions ? unit.questions : [];
    for (var i = 0; i < questions.length; i++) {
      if (questions[i].id === questionId) own = questions[i];
      else if (!questions[i].hotspot) others.push(questions[i].answer);
    }
    if (others.length === 0) {
      return own ? own.mediumFakes.slice() : [];
    }
    if (others.length >= 3) {
      return seededShuffle(others, seed).slice(0, 3);
    }
    var rng = mulberry32(seed);
    var picks = [];
    for (var k = 0; k < 3; k++) {
      picks.push(others[Math.floor(rng() * others.length)]);
    }
    return picks;
  }

  function selectFirstN(questions, n, seed) {
    var shuffled = seededShuffle(questions, seed);
    var take = Math.min(n, shuffled.length);
    if (take < 0) take = 0;
    return shuffled.slice(0, take);
  }

  function assignTrueFalse(count, types) {
    var hasTf = false;
    var hasOther = false;
    for (var i = 0; i < types.length; i++) {
      if (types[i] === "tf") hasTf = true;
      else hasOther = true;
    }
    var flags = [];
    for (var j = 0; j < count; j++) {
      if (!hasTf) flags.push(false);
      else if (!hasOther) flags.push(true);
      else flags.push(j % 4 === 3);
    }
    return flags;
  }

  /* Generator v1: the original wrong-answer picker. Kept only so that
     checkpoints saved before v2 (which don't store their choices) rebuild
     exactly the choices they were answered against. */
  function wrongAnswersV1(unit, question, difficulty, seed) {
    if (difficulty === "easy") return easyDistractors(unit, question.id, seed);
    if (difficulty === "medium") return question.mediumFakes.slice();
    return question.hardFakes.slice();
  }

  /* What to say after a wrong answer. For True/False, the correct choice is
     just "True"/"False", so also name the real answer when the statement
     shown was a fake. */
  function missExplanation(question, isTf, data, correctText) {
    if (!isTf) return "The answer is " + answerSentence(correctText);
    return data.isReal ? "That one was true." : "That one was false. The answer is " + answerSentence(question.answer);
  }

  /* "The answer is X." without doubling X's own closing punctuation. */
  function answerSentence(text) {
    var t = String(text).trim();
    return /[.!?]$/.test(t) ? t : t + ".";
  }

  function normalizeAnswer(text) {
    return String(text).trim().replace(/\s+/g, " ").toLowerCase();
  }

  /* Generator v3: three wrong answers that never repeat each other and
     never match the real answer (a real answer shared by two questions
     used to show up twice, with only one copy accepted). Easy draws from
     the other questions' answers; medium and hard use the question's own
     fakes. Shortfalls are filled from the question's other fakes.
     Easy answers come from the bank's distinct answers, listed once per
     bank, so a question needs only a few draws even when many questions
     share one answer (drawing from every question could scan almost the
     whole bank each time). Checkpoints store their choices, so older ones
     resume as they were. */
  var distinctAnswerCache = new WeakMap();
  function distinctAnswers(questions) {
    var list = distinctAnswerCache.get(questions);
    if (list) return list;
    var seen = new Set();
    list = [];
    questions.forEach(function (q) {
      if (q.hotspot) return; // no answer text to offer
      var key = normalizeAnswer(q.answer);
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ key: key, text: q.answer });
    });
    distinctAnswerCache.set(questions, list);
    return list;
  }
  function lazyOthers(questions, question, seed) {
    // A Fisher-Yates shuffle over the distinct answers, done only as far as
    // it's read; swapped slots live in a Map.
    var list = distinctAnswers(questions), own = normalizeAnswer(question.answer);
    var n = list.length, rng = mulberry32(seed), swaps = new Map(), taken = 0;
    var at = function (i) { return swaps.has(i) ? swaps.get(i) : i; };
    return {
      next: function () {
        while (taken < n) {
          var j = taken + Math.floor(rng() * (n - taken));
          var pick = at(j);
          swaps.set(j, at(taken));
          taken++;
          if (list[pick].key !== own) return { value: list[pick].text };
        }
        return null;
      }
    };
  }
  function wrongAnswersV2(unit, question, difficulty, seed) {
    var questions = unit && unit.questions ? unit.questions : [];
    var others = function () { return lazyOthers(questions, question, seed); };
    var sources;
    if (difficulty === "easy") {
      sources = [others, question.mediumFakes, question.hardFakes];
    } else if (difficulty === "medium") {
      sources = [question.mediumFakes, question.hardFakes, others];
    } else {
      sources = [question.hardFakes, question.mediumFakes, others];
    }
    // A Set, so answers like "constructor" or "__proto__" are ordinary text.
    var seen = new Set([normalizeAnswer(question.answer)]);
    var picks = [];
    var take = function (text) {
      var key = normalizeAnswer(text);
      if (seen.has(key)) return;
      seen.add(key);
      picks.push(text);
    };
    for (var s = 0; s < sources.length && picks.length < 3; s++) {
      if (typeof sources[s] === "function") {
        var it = sources[s](), got;
        while (picks.length < 3 && (got = it.next())) take(got.value);
      } else {
        for (var k = 0; k < sources[s].length && picks.length < 3; k++) take(sources[s][k]);
      }
    }
    return picks;
  }

  function wrongAnswersFor(unit, question, difficulty, seed, legacy) {
    return legacy
      ? wrongAnswersV1(unit, question, difficulty, seed)
      : wrongAnswersV2(unit, question, difficulty, seed);
  }

  function buildMcChoices(unit, question, difficulty, seed, legacy) {
    var wrong = wrongAnswersFor(unit, question, difficulty, seed, legacy);
    var rng = mulberry32(seed);
    var correctSlot = "abcd".charAt(Math.floor(rng() * 4));
    for (var i = wrong.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = wrong[i];
      wrong[i] = wrong[j];
      wrong[j] = tmp;
    }
    var choices = { a: "", b: "", c: "", d: "", correctSlot: correctSlot };
    choices[correctSlot] = question.answer;
    var remaining = [];
    for (var s = 0; s < 4; s++) {
      var slot = "abcd".charAt(s);
      if (slot !== correctSlot) remaining.push(slot);
    }
    for (var w = 0; w < remaining.length && w < wrong.length; w++) {
      choices[remaining[w]] = wrong[w];
    }
    return choices;
  }

  function buildTfCandidate(unit, question, difficulty, seed, legacy) {
    var rng = mulberry32(seed);
    if (rng() < 0.5) {
      return { candidate: question.answer, isReal: true };
    }
    var pool = wrongAnswersFor(unit, question, difficulty, seed, legacy);
    if (!pool.length) return { candidate: question.answer, isReal: true };
    var pick = pool[Math.floor(rng() * pool.length)];
    return { candidate: pick, isReal: false };
  }

  function buildBoardTiles(pairs, seed) {
    var tiles = [];
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      tiles.push({ pairId: pair.id, kind: "question", text: pair.question });
      tiles.push({ pairId: pair.id, kind: "answer", text: pair.answer });
    }
    return seededShuffle(tiles, seed);
  }

