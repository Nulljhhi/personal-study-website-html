  /* ------------------------- Completed questions -------------------------
     A question is completed when it was answered correctly in Quiz mode
     and the quiz reached the review page. Completed questions are keyed
     by their question text (not position), so editing or reordering the
     bank later doesn't mark the wrong ones. One progress file per unit,
     named after the unit title. */

  /* Completed questions are keyed by question text plus answer, so two
     identical prompts with different answers are tracked separately and
     fixing a question's answer clears its completed status. Files saved
     before v1.3 list question text only; those entries still count for
     every question with that text, and are rewritten with the new keys on
     the next save. */
  state.completed = Object.create(null);          // completedKey(question) -> true
  state.completedFor = null;     // unit title the set belongs to
  state.completedReady = Promise.resolve();
  state.completedLoadFailed = false;
  var completedLoadToken = 0;
  var LOCAL_PREFIX = "study-website-completed:";

  /* Completion keys are a hash of the question and its answer
     ("k1:" + 106 bits), so editing either still counts as a new question,
     but saved files don't repeat every question's full text. Files from
     before progress version 3 used the raw text; those keys are converted
     on load (see migrateProgress). hashText is in 01-core.js. */
  var questionKeyCache = new WeakMap();
  /* A question's identity: its text and answer (or a hotspot's spot), plus
     its picture's content when it has one, so the same words over a
     different picture are a different question. Text-only questions keep
     the keys they always had. */
  function rawQuestionKey(question) {
    var h = question.hotspot;
    var raw = question.question + "\n" + (h ? "@hotspot " + h.x + "," + h.y + "," + h.r : question.answer);
    return question.image ? raw + "\n@image " + (question.imageId || imageId(question.image)) : raw;
  }
  function keyForRaw(raw) { return "k1:" + hashText(raw); }
  function completedKey(question) {
    var k = questionKeyCache.get(question);
    if (!k) { k = keyForRaw(rawQuestionKey(question)); questionKeyCache.set(question, k); }
    return k;
  }

  /* ------------------------- Progress file versions -------------------------
     version 1  { completed: [question text] }                 (before v1.3)
     version 2  + highScores, games, raw "question\nanswer" keys
     version 3  + schemas (one version per games section), hashed keys,
                bankId (added by the desktop app)
     Each step is a small function; files are upgraded in memory on load and
     saved in the newest format. A file from a newer app version is refused
     (and never overwritten) instead of being read wrongly. */
  var PROGRESS_VERSION = 3;
  var GAME_SCHEMAS = { ratings: 1, skill: 1, progress: 1, fishing: 1, tycoon: 1, td: 1, rally: 1, garden: 2, boss: 1,
    delve: 2, survival: 1, blitz: 1, rivals: 1 };

  var PROGRESS_MIGRATIONS = {
    1: function (d) { d.highScores = d.highScores || {}; d.games = d.games || {}; d.version = 2; return d; },
    2: function (d) {
      // Raw keys become hashes; question-only keys from v1 stay as they are
      // (they're matched by question text on load).
      if (Array.isArray(d.completed)) {
        d.completed = d.completed.map(function (k) { return typeof k === "string" && k.indexOf("\n") !== -1 ? keyForRaw(k) : k; });
      }
      d.schemas = {};
      Object.keys(GAME_SCHEMAS).forEach(function (name) { d.schemas[name] = 1; });
      d.version = 3;
      return d;
    }
  };

  var GAME_MIGRATIONS = {
    delve: {
      // The relic pool is gone (every relic can drop now): refund the
      // lanterns spent adding relics to it.
      1: function (d) {
        if (d && d.relicPool && typeof d.relicPool === "object") {
          var refund = 0;
          Object.keys(d.relicPool).forEach(function (id) {
            var r = d.relicPool[id] === true && typeof dvRelic === "function" ? dvRelic(id) : null;
            if (r && !r.pool) refund += r.price;
          });
          if (typeof d.lanterns === "number" && isFinite(d.lanterns)) d.lanterns += refund;
          delete d.relicPool;
        }
        return d;
      }
    },
    garden: {
      // Plants were keyed by the raw question text; key them by the hash.
      1: function (g) {
        if (g && g.plants && typeof g.plants === "object") {
          var plants = {};
          Object.keys(g.plants).forEach(function (k) { plants[k.indexOf("k1:") === 0 ? k : keyForRaw(k)] = g.plants[k]; });
          g.plants = plants;
        }
        return g;
      }
    }
  };

  /* Parsed progress -> newest format, or throws for a newer/unknown one. */
  function migrateProgress(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("the saved progress file is damaged");
    var v = d.version === undefined ? 1 : d.version;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new Error("the saved progress file is damaged (unknown version " + JSON.stringify(d.version) + ")");
    if (v > PROGRESS_VERSION) throw new Error("it was saved by a newer version of Study Website. Update the app to open it");
    // Wrong shapes mean a damaged or hand-broken file: refuse it rather than
    // quietly start over and overwrite it on the next save.
    var isObj = function (x) { return !!x && typeof x === "object" && !Array.isArray(x); };
    if (d.completed !== undefined && !Array.isArray(d.completed)) throw new Error("the saved progress file is damaged (completed isn't a list)");
    ["highScores", "games", "schemas"].forEach(function (k) {
      if (d[k] !== undefined && d[k] !== null && !isObj(d[k])) throw new Error("the saved progress file is damaged (" + k + " isn't an object)");
    });
    if (isObj(d.games)) Object.keys(d.games).forEach(function (k) {
      if (hasOwn(GAME_SCHEMAS, k) && d.games[k] !== null && d.games[k] !== undefined && !isObj(d.games[k])) {
        throw new Error("the saved progress file is damaged (" + k + " data isn't an object)");
      }
    });
    while (v < PROGRESS_VERSION) { d = PROGRESS_MIGRATIONS[v](d); v = d.version; }
    var schemas = d.schemas && typeof d.schemas === "object" ? d.schemas : {};
    var games = d.games && typeof d.games === "object" ? d.games : {};
    // A section this version doesn't know comes from a newer app: refuse
    // rather than drop it on the next save.
    Object.keys(schemas).forEach(function (name) {
      if (!hasOwn(GAME_SCHEMAS, name)) throw new Error("it has " + name + " data from a newer version of Study Website. Update the app to open it");
    });
    Object.keys(GAME_SCHEMAS).forEach(function (name) {
      // A section version has to be a whole number from 1 up; anything else
      // (negative, fractional, huge, text) is damage, not a version to step through.
      var raw = schemas[name];
      if (raw !== undefined && raw !== null && !(Number.isSafeInteger(raw) && raw >= 1)) {
        throw new Error("the saved progress file is damaged (" + name + " has version " + JSON.stringify(raw) + ")");
      }
      var sv = raw === undefined || raw === null ? 1 : raw;
      if (sv > GAME_SCHEMAS[name]) throw new Error("its " + name + " data was saved by a newer version of Study Website. Update the app to open it");
      while (sv < GAME_SCHEMAS[name]) {
        var step = GAME_MIGRATIONS[name] && GAME_MIGRATIONS[name][sv];
        if (step && games[name] !== undefined) games[name] = step(games[name]);
        sv++;
      }
    });
    d.games = games;
    d.schemas = Object.assign({}, GAME_SCHEMAS);
    return d;
  }

  function readCompletedStore(title) {
    if (hasDesktop) return desktopCall("read_progress", { name: title });
    try { return Promise.resolve(window.localStorage.getItem(LOCAL_PREFIX + title) || ""); }
    catch (err) { return Promise.reject(new Error("this browser's storage can't be read here (" + (err && err.name || "blocked") + ")")); }
  }

  function writeCompletedStore(title, json) {
    if (hasDesktop) return desktopCall("write_progress", { name: title, json: json });
    try { window.localStorage.setItem(LOCAL_PREFIX + title, json); }
    catch (err) {
      // Changes stay in this session only; say so instead of claiming a save.
      return Promise.reject(new Error("Progress is kept for this session only: this browser's storage " +
        (err && err.name === "QuotaExceededError" ? "is full." : "isn't available.")));
    }
    return Promise.resolve();
  }

  /* The raw entries in a progress file: new-style keys and/or legacy
     question-text entries. */
  function parseCompletedJson(text) {
    var result = Object.create(null);
    if (!text) return result;
    try {
      var data = JSON.parse(text);
      if (data && Array.isArray(data.completed)) {
        data.completed.forEach(function (q) { if (typeof q === "string") result[q] = true; });
      }
    } catch (err) { /* unreadable file: start fresh */ }
    return result;
  }

  /* Game high scores ({ "boss:rising": 1200, ... }) stored in the same file. */
  state.highScores = Object.create(null);
  function parseHighScores(text) {
    var result = Object.create(null);
    if (!text) return result;
    try {
      var data = JSON.parse(text);
      if (data && data.highScores && typeof data.highScores === "object") {
        Object.keys(data.highScores).forEach(function (k) {
          var v = data.highScores[k];
          if (typeof v === "number" && isFinite(v) && v >= 0) result[k] = Math.floor(v);
        });
      }
    } catch (err) { /* unreadable: no scores */ }
    return result;
  }

  /* Raw entries -> { completedKey: true } for the questions in this unit. */
  function resolveCompleted(questions, raw) {
    var result = Object.create(null);
    questions.forEach(function (q) {
      // Hashed keys (v3), raw keys (v2, e.g. a listing of an old file), or
      // question-only keys (v1).
      if (raw[completedKey(q)] === true || raw[rawQuestionKey(q)] === true || raw[q.question] === true) result[completedKey(q)] = true;
    });
    return result;
  }

  /* Runs fn once the bank's saved progress has loaded, but only if the same
     bank is still open and the person is still on the same screen (or the
     one given): a click shouldn't start a game or reset progress after
     they've moved on or opened another bank. */
  function whenProgressReady(fn, screen) {
    var unit = state.unit, where = screen || state.screen;
    return state.completedReady.then(function () {
      if (state.unit !== unit || state.screen !== where) return;
      return fn();
    });
  }

  function isCompleted(question) {
    return state.completed[completedKey(question)] === true;
  }

  /* Identical question + answer blocks are one question for completion
     (see warnDuplicateBlocks), so the counts use distinct keys. Built once
     per bank: each distinct key, with the positions of its questions (so
     marking one updates its rows without scanning the bank). */
  var keyIndexCache = new WeakMap();
  function keyIndex(unit) {
    var index = keyIndexCache.get(unit);
    if (!index) {
      var rows = new Map();
      unit.questions.forEach(function (q, i) {
        var k = completedKey(q), at = rows.get(k);
        if (at) at.push(i); else rows.set(k, [i]);
      });
      index = { rows: rows, keys: Array.from(rows.keys()) };
      keyIndexCache.set(unit, index);
    }
    return index;
  }
  function uniqueKeys(unit) { return keyIndex(unit).keys; }
  function questionTotal(unit) {
    unit = unit || state.unit;
    return unit ? uniqueKeys(unit).length : 0;
  }
  /* The open bank's count is kept up to date as questions are marked
     (markCompleted), instead of recounted after every answer. Any other
     bank or set is counted. */
  var countCache = { unit: null, done: null, rev: -1, n: 0 };
  var completedRev = 0; // bumped by every change to state.completed
  function countKeys(unit, done) {
    return uniqueKeys(unit).filter(function (k) { return done[k] === true; }).length;
  }
  function completedCount(unit, done) {
    unit = unit || state.unit;
    done = done || state.completed;
    if (!unit) return 0;
    if (unit !== state.unit || done !== state.completed) return countKeys(unit, done);
    var c = countCache;
    if (c.unit !== unit || c.done !== done || c.rev !== completedRev) {
      c.unit = unit; c.done = done; c.n = countKeys(unit, done); c.rev = completedRev;
    }
    return c.n;
  }
  /* Marks a question of the open bank completed. Returns whether it's new. */
  function markCompleted(question) {
    var k = completedKey(question);
    if (state.completed[k] === true) return false;
    var c = countCache, fresh = c.unit === state.unit && c.done === state.completed && c.rev === completedRev;
    state.completed[k] = true;
    completedRev++;
    if (fresh && state.unit && keyIndex(state.unit).rows.has(k)) { c.n++; c.rev = completedRev; }
    return true;
  }
  /* Replaces the whole set (load, reset). */
  function setCompleted(done) {
    state.completed = done;
    completedRev++;
  }

  /* Loads in the background. Anything marked before the load finishes is
     merged with what's on disk (not overwritten by it), and saves wait for
     the load so they never replace older completions with a partial list. */
  function loadCompletedForUnit() {
    if (!state.unit) return;
    var unit = state.unit;
    var title = unit.unitTitle;
    flushQueuedForSwitch();
    var token = ++completedLoadToken;
    setCompleted(Object.create(null));
    state.highScores = Object.create(null);
    state.gameData = freshGameData();
    state.completedFor = title;
    state.completedLoadFailed = false;
    state.completedSaveWarned = false;
    state.lastSaveError = null;
    state.bankDeleted = deletedTitles.has(title);
    state.progressExtra = {};
    state.gamesExtra = {};
    renderCompletedMarks();
    // A save still being written (for this bank, reopened, or the one being
    // left) lands first, so the read sees it instead of the older file.
    var pending = saveQueued || saveInFlight;
    state.completedReady = Promise.resolve(pending).catch(function () {})
      .then(function () { return token === completedLoadToken ? readCompletedStore(title) : ""; })
      .then(function (text) {
        if (token !== completedLoadToken) return; // another unit loaded meanwhile
        // A file that exists but isn't valid progress is never replaced by
        // a fresh one: flag it and stop saving until it's dealt with.
        if (text) {
          var parsed = null;
          try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
          // Upgrade older formats in memory (throws for damaged or newer files).
          parsed = migrateProgress(parsed);
          state.bankId = typeof parsed.bankId === "string" ? parsed.bankId : null;
          // Fields this version doesn't use are written back unchanged.
          state.progressExtra = {};
          Object.keys(parsed).forEach(function (k) { if (PROGRESS_FIELDS.indexOf(k) === -1) state.progressExtra[k] = parsed[k]; });
          text = JSON.stringify(parsed);
        } else { state.bankId = null; state.progressExtra = {}; }
        var games = parseGameData(text);
        state.gamesExtra = text ? gameExtras(JSON.parse(text).games, games) : {};
        var loaded = resolveCompleted(unit.questions, parseCompletedJson(text));
        Object.keys(state.completed).forEach(function (k) { loaded[k] = true; });
        setCompleted(loaded);
        // High scores live in the same file; keep the better of disk vs. memory.
        var scores = parseHighScores(text);
        Object.keys(state.highScores).forEach(function (k) { scores[k] = Math.max(scores[k] || 0, state.highScores[k]); });
        state.highScores = scores;
        state.gameData = games;
        renderCompletedMarks();
      })
      .catch(function (err) {
        if (token !== completedLoadToken) return;
        state.completedLoadFailed = true;
        var msg = String(err && err.message || err).replace(/^DAMAGED:\s*/, "");
        notifyError(hasDesktop
          ? "Saved progress couldn't be loaded, so nothing will be saved for this bank until it's fixed (the old file is left untouched): " + msg
          : "Saved progress couldn't be loaded from this browser's storage, so nothing will be saved for this bank in this session: " + msg);
      });
  }

  /* Saves are serialized and coalesced: while one write is in flight,
     any number of new requests collapse into a single follow-up write of
     the latest state. Resolves to true once the current state is on disk,
     false if it couldn't be saved (the error has been shown). */
  var saveInFlight = null;
  var saveQueued = null;
  var saveQueuedToken = 0;

  var PROGRESS_FIELDS = ["format", "version", "schemas", "unitTitle", "bankId", "updatedAt", "completed", "highScores", "games"];
  /* Game data this version doesn't use (a game or a field added by a newer
     version, or by hand) is kept and written back as it was, at any depth:
     a field inside a known game's record or stats survives a save just like
     a whole unknown game does. The kept parts are a tree shaped like the
     data; on save they go underneath the live data, which always wins. */
  var GAME_MAP_SECTIONS = { ratings: 1, progress: 1, rivals: 1, skill: 1 };
  function isPlainObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  /* What raw has that neither the parsed data nor a fresh profile knows. */
  function extrasOf(raw, parsed, fresh) {
    if (!isPlainObj(raw)) return undefined;
    var out = {}, any = false;
    Object.keys(raw).forEach(function (k) {
      var p = isPlainObj(parsed) && hasOwn(parsed, k) ? parsed[k] : undefined;
      var f = isPlainObj(fresh) && hasOwn(fresh, k) ? fresh[k] : undefined;
      var known = (isPlainObj(parsed) && hasOwn(parsed, k)) || (isPlainObj(fresh) && hasOwn(fresh, k));
      if (!known) { out[k] = raw[k]; any = true; return; }
      if (isPlainObj(raw[k]) && (isPlainObj(p) || isPlainObj(f))) {
        var sub = extrasOf(raw[k], p, f);
        if (sub) { out[k] = sub; any = true; }
      }
    });
    return any ? out : undefined;
  }
  function gameExtras(raw, parsed) {
    return extrasOf(raw, parsed, freshGameData()) || {};
  }
  /* live with the kept extras merged in underneath it. */
  function mergeExtras(live, extra) {
    if (!isPlainObj(extra)) return live;
    if (live === undefined) return extra;
    if (!isPlainObj(live)) return live;
    var out = Object.assign({}, live);
    Object.keys(extra).forEach(function (k) {
      out[k] = hasOwn(live, k) ? mergeExtras(live[k], extra[k]) : extra[k];
    });
    return out;
  }
  function gamesForSave() {
    var extras = state.gamesExtra || {};
    if (!Object.keys(extras).length) return state.gameData;
    return mergeExtras(state.gameData, extras);
  }
  /* Reset drops what was kept for that game too. */
  function dropGameExtras(id) {
    var ex = state.gamesExtra;
    if (!ex) return;
    delete ex[id];
    Object.keys(GAME_MAP_SECTIONS).forEach(function (sec) { if (isPlainObj(ex[sec])) delete ex[sec][id]; });
  }

  /* The completed list is most of a big bank's file and changes only when
     a question is marked, so its JSON is kept and reused until then. Each
     distinct key is listed once, in bank order. */
  var listCache = { unit: null, done: null, rev: -1, json: "[]" };
  function completedListJson(unit) {
    var c = listCache;
    if (c.unit !== unit || c.done !== state.completed || c.rev !== completedRev) {
      var done = state.completed;
      c.json = JSON.stringify(uniqueKeys(unit).filter(function (k) { return done[k] === true; }));
      c.unit = unit; c.done = done; c.rev = completedRev;
    }
    return c.json;
  }
  function progressJson(unit) {
    // Compact: the file is read by the app, and smaller writes are faster.
    // Built in parts so the kept list is pasted in, not serialized again;
    // the same text JSON.stringify gives for the whole object (extras never
    // hold the fields listed last, see PROGRESS_FIELDS).
    var head = JSON.stringify(Object.assign({}, state.progressExtra || {}, {
      format: "study-website-completed", version: PROGRESS_VERSION, schemas: GAME_SCHEMAS,
      unitTitle: unit.unitTitle
    }));
    var tail = [["completed", completedListJson(unit)], ["highScores", JSON.stringify(state.highScores)], ["games", JSON.stringify(gamesForSave())]]
      .filter(function (f) { return f[1] !== undefined; })
      .map(function (f) { return '"' + f[0] + '":' + f[1]; });
    return head.slice(0, -1) + (head.length > 2 ? "," : "") + tail.join(",") + "}";
  }
  var STAMP_RE = /^\{/;
  function stampJson(json) { return json.replace(STAMP_RE, '{"updatedAt":' + JSON.stringify(new Date().toISOString()) + ","); }

  /* Banks deleted from the folder this session, by title: no copy of one
     (open before, during or after the delete) writes its progress back
     until it's saved to the folder again. */
  var deletedTitles = new Set();
  function unitDeleted(unit) { return !!unit && deletedTitles.has(unit.unitTitle); }
  var lastWritten = Object.create(null); // title -> JSON last saved (without updatedAt)
  // Banks whose latest progress couldn't be written: title -> { unit, json }.
  // Kept across bank switches, so quitting still knows (and retries) them.
  var unsaved = new Map();
  var writeSeq = 0; // orders progress writes, so a newer success clears an older failure
  var writtenSeq = Object.create(null); // title -> seq of the last successful write

  function writeProgressNow(unit, token, json) {
    if (json === undefined) {
      if (token !== completedLoadToken || state.unit !== unit) return Promise.resolve(true);
      if (state.completedLoadFailed || state.bankDeleted) return Promise.resolve(false);
      json = progressJson(unit);
    }
    if (unitDeleted(unit)) return Promise.resolve(false);
    // Nothing changed since the last save: skip the write.
    if (lastWritten[unit.unitTitle] === json && !state.lastSaveError) {
      // Already on disk, so an older failure for this bank is settled too.
      var had = unsaved.get(unit.unitTitle);
      if (had && (had.json === json || had.seq < (writtenSeq[unit.unitTitle] || 0))) unsaved.delete(unit.unitTitle);
      return Promise.resolve(true);
    }
    var seq = ++writeSeq;
    setSaveStatus("saving");
    return writeCompletedStore(unit.unitTitle, stampJson(json))
      .then(function (id) {
        state.lastSaveError = null;
        lastWritten[unit.unitTitle] = json;
        writtenSeq[unit.unitTitle] = Math.max(writtenSeq[unit.unitTitle] || 0, seq);
        // Anything that failed before this write is replaced by it.
        var u = unsaved.get(unit.unitTitle);
        if (u && (u.json === json || u.seq < seq)) unsaved.delete(unit.unitTitle);
        setSaveStatus("saved");
        // The desktop app answers with the bank's ID (new banks get one on
        // their first save), so checkpoints made right away carry it too.
        if (typeof id === "string" && /^bank-[0-9a-f]+$/.test(id) && state.unit === unit) state.bankId = id;
        return true;
      })
      .catch(function (err) {
        var msg = err && err.message || String(err);
        var prev = unsaved.get(unit.unitTitle);
        if (!unitDeleted(unit) && !(prev && prev.seq > seq)) unsaved.set(unit.unitTitle, { unit: unit, json: json, error: msg, seq: seq });
        // The same failure on every answer would bury the screen in toasts.
        if (state.lastSaveError !== msg) notifyError(msg);
        state.lastSaveError = msg;
        setSaveStatus("failed", msg);
        return false;
      });
  }

  /* Small "Saving… / Saved / Not saved" status in the corner (O12). */
  var saveStatusTimer = null;
  function setSaveStatus(kind, detail) {
    var el = byId("save-status");
    if (!el) return;
    clearTimeout(saveStatusTimer);
    el.className = "save-status " + kind;
    el.textContent = kind === "saving" ? "Saving…" : kind === "saved" ? "Saved" : "Not saved";
    el.title = detail || "";
    el.classList.remove("hidden");
    if (kind === "saved") saveStatusTimer = setTimeout(function () { el.classList.add("hidden"); }, 1500);
  }

  var queuedUnit = null; // the bank a queued save belongs to

  /* Before another bank replaces the in-memory state, write the queued
     save for the old one from the state it still has. */
  function flushQueuedForSwitch() {
    if (!saveQueued || !queuedUnit || state.completedLoadFailed || state.bankDeleted) return;
    var unit = queuedUnit, json = progressJson(unit);
    saveQueued = saveQueued.then(function () { return writeProgressNow(unit, null, json); });
    queuedUnit = null;
  }

  function markUnitDeleted(unit) {
    if (unit) { deletedTitles.add(unit.unitTitle); delete lastWritten[unit.unitTitle]; unsaved.delete(unit.unitTitle); forgetWrite("bank:" + unit.unitTitle); }
  }
  function unmarkUnitDeleted(unit) { if (unit) deletedTitles.delete(unit.unitTitle); }

  function persistCompleted() {
    if (!state.unit) return Promise.resolve(true);
    var unit = state.unit;
    var token = completedLoadToken;
    return state.completedReady.then(function () {
      if (token !== completedLoadToken) return true; // a different unit is open now
      // A rename or delete of this bank is in progress; it saves again when done.
      if (state.progressHold) { state.heldSave = true; return state.progressHold.then(function () { return true; }); }
      if (state.bankDeleted) {
        if (!state.completedSaveWarned) {
          state.completedSaveWarned = true;
          notifyError("This bank was deleted from the saved folder, so progress isn't saved. Save it to the folder again to keep it.");
        }
        return false;
      }
      if (state.completedLoadFailed) {
        // Warn once per bank load, not on every answer.
        if (!state.completedSaveWarned) {
          state.completedSaveWarned = true;
          notifyError(hasDesktop
            ? "Progress wasn't saved, because the saved file couldn't be read. Fix or move that file, then reopen the bank."
            : "Progress wasn't saved, because this browser's storage couldn't be read.");
        }
        return false;
      }
      var start = function () {
        var me = writeProgressNow(unit, token);
        saveInFlight = me;
        me.then(function () { if (saveInFlight === me) saveInFlight = null; });
        return me;
      };
      if (!saveInFlight && !saveQueued) return start();
      // Join the queued write only if it's for this same bank load;
      // otherwise queue a fresh one behind it.
      if (!saveQueued || saveQueuedToken !== token) {
        var prev = saveQueued || saveInFlight;
        var mine = prev.then(function () { if (saveQueued === mine) saveQueued = null; return start(); });
        saveQueued = mine;
        saveQueuedToken = token;
        queuedUnit = unit;
      }
      return saveQueued;
    });
  }

  /* Every other write the app makes (checkpoints, bank saves, renames,
     deletes) is tracked too, so quitting waits for them and knows whether
     they worked. trackWrite returns the original promise. */
  var pendingWrites = new Set();
  /* Saves that failed (a checkpoint, a bank copy), kept with what they were
     writing so quitting can try them again instead of forgetting them:
     key -> { retry: function returning the write's promise, error }.
     A later success under the same key clears it. */
  var failedWrites = new Map();
  var writeAttempts = new Map();
  function trackWrite(promise, key, retry) {
    var n = 0;
    if (key) { n = (writeAttempts.get(key) || 0) + 1; writeAttempts.set(key, n); }
    // Only the newest attempt under a key decides; an older one finishing
    // late (or failing late) changes nothing.
    var newest = function () { return key && writeAttempts.get(key) === n; };
    var settled = Promise.resolve(promise).then(function (v) {
      if (newest()) {
        if (v !== false) failedWrites.delete(key);
        else failedWrites.set(key, { retry: retry, error: "the save didn't finish" });
      }
      return v !== false;
    }, function (err) {
      if (newest()) failedWrites.set(key, { retry: retry, error: err && err.message || String(err) });
      return false;
    });
    pendingWrites.add(settled);
    settled.then(function () { pendingWrites.delete(settled); });
    if (promise && typeof promise === "object") promise.__tracked = settled;
    return promise;
  }
  /* What was being saved under key is gone (a deleted checkpoint or bank):
     don't retry it on quit, and ignore attempts still running. */
  function forgetWrite(key) {
    failedWrites.delete(key);
    writeAttempts.set(key, (writeAttempts.get(key) || 0) + 1);
  }
  /* Start a tracked, retryable write: make() issues it (and again on a retry). */
  function retryableWrite(key, make) {
    var run = function () { return trackWrite(make(), key, run); };
    return run();
  }
  /* An operation that runs flushSaves itself first (rename, delete): it's
     tracked from the start, so a quit meanwhile waits for it, and its own
     flush skips it. Returns { promise, done }. */
  function trackOperation() {
    var done;
    var promise = new Promise(function (r) { done = r; });
    trackWrite(promise);
    return { promise: promise, done: done };
  }

  /* Waits for every save that's queued or running (used before quitting).
     Resolves true when everything is on disk; false when something failed
     (including an earlier progress save that never succeeded, which is
     retried once here). */
  function flushSaves(skip, retried) {
    return Promise.resolve(state.completedReady).catch(function () {}).then(function () {
      // Saves that failed earlier get one more try per flush.
      var again = [];
      if (!retried) failedWrites.forEach(function (f) {
        if (typeof f.retry === "function") again.push(Promise.resolve(f.retry()).then(function () { return true; }, function () { return false; }));
      });
      var cur = state.unit;
      var retryCurrent = cur && !state.progressHold && !state.completedLoadFailed && !state.bankDeleted &&
        (state.lastSaveError || unsaved.has(cur.unitTitle));
      var retry = retryCurrent ? persistCompleted() : null;
      // Banks that were left with an unsaved change get one more try.
      var others = [];
      unsaved.forEach(function (u, title) {
        if (cur && title === cur.unitTitle) return;
        others.push(writeProgressNow(u.unit, null, u.json));
      });
      var progress = retry || saveQueued || saveInFlight || true;
      var waited = Array.from(pendingWrites).filter(function (w) { return !skip || w !== skip.__tracked; });
      return Promise.all([progress].concat(others, waited, again)).then(function (results) {
        // A write started while waiting is waited for too.
        var newer = Array.from(pendingWrites).some(function (w) { return waited.indexOf(w) === -1 && (!skip || w !== skip.__tracked); });
        if (newer || (saveQueued && saveQueued !== progress) || (saveInFlight && saveInFlight !== progress)) return flushSaves(skip, true);
        if (failedWrites.size && !state.lastSaveError) state.lastSaveError = Array.from(failedWrites.values())[0].error;
        return results.every(function (r) { return r !== false; }) && !state.lastSaveError && unsaved.size === 0 && failedWrites.size === 0;
      });
    });
  }


  /* Called when a quiz reaches the review page. Returns how many
     questions were newly marked. */
  function markCorrectAsCompleted() {
    var q = state.quiz;
    if (q.mode !== "quiz" || !state.unit) return 0;
    var added = 0;
    for (var i = 0; i < q.order.length; i++) {
      if (quizAnswerRight(i) && markCompleted(q.order[i])) {
        added++;
        q.markedThisAttempt = (q.markedThisAttempt || 0) + 1;
      }
    }
    if (added) {
      persistCompleted();
      renderCompletedMarks();
    }
    return added;
  }

  function resetCompleted() {
    var token = completedLoadToken;
    // Wait for the load so it can't bring the old list back afterwards.
    state.completedReady.then(function () {
      if (token !== completedLoadToken) return;
      setCompleted(Object.create(null));
      renderCompletedMarks();
      return persistCompleted().then(function (ok) {
        if (ok) notify("Completed questions reset.");
        else notifyError("Completed questions were reset for now, but the change couldn't be saved.");
      });
    });
  }

  /* With a question, only that question's rows are updated (games mark one
     at a time); without, every row is redrawn and the count is redone. */
  function renderCompletedMarks(onlyQuestion) {
    if (!onlyQuestion) completedRev++;
    var summary = byId("completed-summary");
    var total = questionTotal();
    var done = completedCount();
    if (summary) summary.textContent = state.unit ? done + " of " + total + " questions completed" : "";
    var bar = byId("completed-bar");
    if (bar) bar.style.width = total ? (100 * done / total) + "%" : "0%";
    var reset = byId("reset-completed-btn");
    if (reset) reset.disabled = done === 0;
    // Row i is question i (the list shows the first questions, in order,
    // then a Show more button).
    var list = byId("qa-list");
    var pairs = list ? list.children : [];
    var row = function (i) { var p = pairs[i]; return p && p.classList.contains("qa-pair") ? p : null; };
    if (onlyQuestion && state.unit && state.unit.questions[onlyQuestion.id] === onlyQuestion) {
      // Identical questions share a key, so update every row with this key.
      (keyIndex(state.unit).rows.get(completedKey(onlyQuestion)) || []).forEach(function (idx) {
        renderCompletedRow(row(idx), state.unit.questions[idx]);
      });
    } else {
      for (var i = 0; i < pairs.length && state.unit; i++) renderCompletedRow(row(i), state.unit.questions[i]);
    }
    if (state.screen === "quiz-options") updateQuizCountLimit();
  }

  function renderCompletedRow(pair, question) {
    if (!pair) return;
    var tag = pair.querySelector(".completed-tag");
    if (question && isCompleted(question)) {
      if (!tag) {
        tag = document.createElement("span");
        tag.className = "completed-tag";
        tag.textContent = "Completed";
        pair.querySelector(".qa-q").appendChild(tag);
      }
    } else if (tag) {
      tag.remove();
    }
  }

  /* Quiz Options: the count's max follows the pool the quiz will draw
     from (all questions, or only the ones not yet completed). */
  function quizPool() {
    if (!state.unit) return [];
    var skip = byId("skip-completed");
    if (skip && skip.checked) {
      return state.unit.questions.filter(function (q) { return !isCompleted(q); });
    }
    return state.unit.questions;
  }

  function updateQuizCountLimit(resetValue) {
    var input = byId("quiz-count");
    var hint = byId("skip-completed-hint");
    if (!state.unit) return;
    var total = questionTotal();
    var remaining = total - completedCount();
    if (hint) hint.textContent = remaining + " of " + total + " questions not completed yet.";
    if (!input) return;
    var poolSize = quizPool().length;
    var max = Math.max(poolSize, 1);
    input.max = String(max);
    var current = parseInt(input.value, 10);
    if (resetValue || !isFinite(current) || current > max) input.value = String(max);
  }

