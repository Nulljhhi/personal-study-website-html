  /* =====================================================================
     4. SCREEN CONTROLLERS
     Landing, Documentation, Home, Flashcard, Matching, Quiz and Exam.
     The games live further down, each in its own section.
     ===================================================================== */

  function byId(id) {
    return document.getElementById(id);
  }

  /* ------------------------ Saved folder (desktop) ------------------------
     In the Tauri desktop app, window.__TAURI__ exposes invoke(), which
     calls the Rust commands in src-tauri/src/main.rs. Those read and
     write ~/Documents/StudyWebsite/{banks,progress}. Opened as a plain
     web page there is no __TAURI__, so folder buttons are disabled and
     completed questions fall back to this browser's localStorage. */

  var tauriInvoke = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) || null;
  var hasDesktop = typeof tauriInvoke === "function";
  var DESKTOP_ONLY_NOTE = "Saving to a folder needs the Study Website desktop app.";

  function desktopCall(command, args) {
    if (!hasDesktop) return Promise.reject(new Error(DESKTOP_ONLY_NOTE));
    return Promise.resolve(tauriInvoke(command, args || {})).catch(function (err) {
      throw new Error(typeof err === "string" ? err : (err && err.message) || "Something went wrong.");
    });
  }

  function setFolderStatus(message, isError) {
    if (!message) return;
    if (isError) notifyError(message); else notify(message);
  }

  /* The "Saved to" box on Home: shown once the open bank is in the folder. */
  state.bankPath = "";
  function renderBankPath() {
    var box = byId("bank-path-box");
    if (!box) return;
    box.classList.toggle("hidden", !state.bankPath);
    byId("bank-path-text").textContent = state.bankPath;
  }

  var dataFolderPath = "";
  function bankPathFor(fileName) {
    return dataFolderPath ? dataFolderPath + "/banks/" + fileName : "";
  }
  /* Whether the open bank was saved as (or opened from) this file in
     banks/. By file name: a path from the desktop side uses the system's
     own separators (backslashes on Windows). */
  function openBankIsFile(fileName) {
    return !!state.bankPath && state.bankPath.split(/[\\/]/).pop() === fileName;
  }

  function saveBankToFolder() {
    if (!state.unit || !state.unitText) return;
    var unit = state.unit, text = state.unitText;
    retryableWrite("bank:" + unit.unitTitle, function () { return desktopCall("save_bank", { name: unit.unitTitle, text: text }); })
      .then(function (path) {
        notify("Question bank saved.");
        unmarkUnitDeleted(unit); // it's back in the folder, so its progress is saved again
        // Another bank may have been opened while this one was saving.
        if (state.unit !== unit) return;
        state.bankPath = path;
        renderBankPath();
        unmarkUnitDeleted(unit);
        if (state.bankDeleted) { state.bankDeleted = false; state.completedSaveWarned = false; persistCompleted(); } // saved again: keep its progress again
      })
      .catch(function (err) { setFolderStatus(err.message, true); });
  }

  /* ---------------------------- Question banks ----------------------------
     Desktop only: tiles for every bank in ~/Documents/StudyWebsite/banks,
     sorted alphabetically, with Rename and Delete on each. */

  var pendingBankRename = null;
  var pendingBankDelete = null;

  function openBanks() {
    showScreen("banks");
    renderBanks();
  }

  /* text is the bank's text, or the bank already parsed. */
  function describeBank(name, text, progressText, modified) {
    var info = { name: name, ok: false, title: name.replace(/\.txt$/i, ""), modified: modified };
    try {
      var unit = typeof text === "string" ? parseUnitFile(text) : text;
      // progressText is "" (none saved yet), the file's text, or { error }.
      var progressError = progressText && typeof progressText === "object" ? progressText.error || "it couldn't be read" : "";
      if (typeof progressText !== "string") progressText = "";
      if (!progressError && progressText) {
        try { migrateProgress(JSON.parse(progressText)); } catch (perr) { progressError = perr && perr.message || "it's damaged"; }
      }
      var done = progressError ? Object.create(null) : resolveCompleted(unit.questions, parseCompletedJson(progressText));
      if (progressError) info.progressError = progressError;
      info.ok = true;
      info.title = unit.unitTitle;
      info.total = questionTotal(unit);
      info.completed = completedCount(unit, done);
    } catch (err) {
      info.error = err && err.message ? err.message : "This file couldn't be read.";
    }
    return info;
  }

  /* fn over items, at most `limit` at a time, results in order (the desktop
     side does file work one at a time anyway; this keeps big lists from
     queueing every read and holding every bank in memory at once). */
  function mapLimited(items, limit, fn) {
    var out = new Array(items.length), i = 0;
    var next = function () {
      if (i >= items.length) return Promise.resolve();
      var k = i++;
      return Promise.resolve(fn(items[k], k)).then(function (r) { out[k] = r; return next(); });
    };
    var runners = [];
    for (var n = 0; n < Math.min(limit, items.length); n++) runners.push(next());
    return Promise.all(runners).then(function () { return out; });
  }

  /* Bank tiles, reused while a bank's file, size and progress file are
     unchanged. Kept between sessions too (in this app's own storage): with
     years of banks, reading and parsing every one each time the list opens
     takes seconds. Bump the version when describeBank's result changes. */
  var bankInfoCache = new Map(); // name -> { stamp, info }
  var BANK_SUMMARIES_KEY = "study-website-bank-summaries";
  var BANK_SUMMARIES_VERSION = 1;
  function loadBankSummaries() {
    try {
      var d = JSON.parse(window.localStorage.getItem(BANK_SUMMARIES_KEY) || "null");
      if (d && d.v === BANK_SUMMARIES_VERSION && d.items && typeof d.items === "object") {
        Object.keys(d.items).forEach(function (name) {
          if (!bankInfoCache.has(name)) bankInfoCache.set(name, d.items[name]);
        });
      }
    } catch (err) { /* no saved summaries: they're made again */ }
  }
  function saveBankSummaries() {
    var items = {};
    // Only good results: a bank that couldn't be read is tried again.
    bankInfoCache.forEach(function (v, name) { if (v.info && v.info.ok && !v.info.progressError) items[name] = v; });
    try { window.localStorage.setItem(BANK_SUMMARIES_KEY, JSON.stringify({ v: BANK_SUMMARIES_VERSION, items: items })); } catch (err) { /* full or blocked: fine */ }
  }
  var BANKS_PER_READ = 50;

  /* onProgress(done, total) while banks are being read. */
  function listBankInfo(onProgress) {
    var full = function () {
      return desktopCall("list_bank_details").then(function (entries) {
        // Progress that can't be read comes as "DAMAGED: why".
        return (entries || []).map(function (e) {
          var p = /^DAMAGED:/.test(e[2] || "") ? { error: e[2].replace(/^DAMAGED:\s*/, "") } : e[2];
          return describeBank(e[0], e[1], p, e[3]);
        });
      });
    };
    var describeRead = function (name, modified, text, progress, error) {
      if (error) return { name: name, ok: false, title: name.replace(/\.txt$/i, ""), modified: modified, error: error };
      var p = /^DAMAGED:/.test(progress || "") ? { error: progress.replace(/^DAMAGED:\s*/, "") } : progress;
      return describeBank(name, text, p, modified);
    };
    // One bank the old way (two calls), if reading many at once fails.
    var readOne = function (m) {
      return desktopCall("read_bank", { name: m[0] }).then(function (text) {
        var unit = null;
        try { unit = parseUnitFile(text); } catch (err) { return describeBank(m[0], text, "", m[1]); }
        return desktopCall("read_progress", { name: unit.unitTitle })
          .catch(function (err) { return { error: err && err.message || String(err) }; })
          .then(function (p) { return describeBank(m[0], unit, p, m[1]); });
      }, function (err) { return describeRead(m[0], m[1], "", "", err && err.message || String(err)); });
    };
    return desktopCall("list_bank_meta").catch(function () { return null; }).then(function (metas) {
      if (!Array.isArray(metas)) return full();
      if (!bankInfoCache.size) loadBankSummaries();
      var names = new Set(metas.map(function (m) { return m[0]; }));
      bankInfoCache.forEach(function (_, k) { if (!names.has(k)) bankInfoCache.delete(k); });
      // Sizes too: some drives keep file times to the second or two.
      var stampOf = function (m) { return m[1] + ":" + m[2] + ":" + m[3] + ":" + (m[4] || 0); };
      var out = new Array(metas.length), missing = [];
      metas.forEach(function (m, i) {
        var hit = bankInfoCache.get(m[0]);
        if (hit && hit.stamp === stampOf(m)) out[i] = hit.info; else missing.push(i);
      });
      var done = metas.length - missing.length;
      if (onProgress && missing.length) onProgress(done, metas.length);
      var chunks = [];
      for (var c = 0; c < missing.length; c += BANKS_PER_READ) chunks.push(missing.slice(c, c + BANKS_PER_READ));
      return mapLimited(chunks, 2, function (chunk) {
        var batch = chunk.map(function (i) { return metas[i]; });
        return desktopCall("read_banks", { names: batch.map(function (m) { return m[0]; }) })
          .then(function (rows) {
            // Anything but a list of answers in order: read them one at a time.
            if (!Array.isArray(rows) || rows.length > batch.length || !rows.every(Array.isArray)) return mapLimited(batch, 4, readOne);
            var got = rows.map(function (r, k) { return describeRead(batch[k][0], batch[k][1], r[0], r[1], r[2]); });
            // A batch stops early at its size budget (old banks holding
            // their pictures): keep what came, read only the rest.
            if (rows.length === batch.length) return got;
            return mapLimited(batch.slice(rows.length), 4, readOne).then(function (rest) { return got.concat(rest); });
          }, function () { return mapLimited(batch, 4, readOne); })
          .then(function (infos) {
            infos.forEach(function (info, k) {
              out[chunk[k]] = info;
              bankInfoCache.set(batch[k][0], { stamp: stampOf(batch[k]), info: info });
            });
            done += infos.length;
            if (onProgress) onProgress(done, metas.length);
          });
      }).then(function () {
        if (missing.length) saveBankSummaries();
        return out;
      });
    });
  }

  /* Natural order: "Week 2" before "Week 10". */
  function compareTitles(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  }

  function applyBankFilter() {
    var input = byId("bank-filter"), grid = byId("bank-grid");
    if (!input || !grid) return;
    // The typed text as a phrase: "week 4" finds Week 4 and Week 40, not
    // Week 14 day 4.
    var phrase = input.value.toLowerCase().replace(/\s+/g, " ").trim();
    var shown = 0, total = 0;
    Array.prototype.forEach.call(grid.children, function (tile) {
      if (!tile.dataset || tile.dataset.title === undefined) return;
      total++;
      var hit = !phrase || tile.dataset.title.indexOf(phrase) !== -1;
      tile.classList.toggle("hidden", !hit);
      if (hit) shown++;
    });
    var count = byId("bank-count");
    if (count) count.textContent = phrase ? shown + " of " + total + " banks" : total + (total === 1 ? " bank" : " banks");
  }

  var banksRender = 0; // only the newest list render draws
  function renderBanks() {
    var token = ++banksRender;
    var grid = byId("bank-grid");
    var errorEl = byId("banks-error");
    var status = byId("banks-status");
    if (!grid) return;
    if (errorEl) errorEl.textContent = "";
    grid.textContent = "";
    var showStatus = function (text) {
      if (!status) return;
      status.textContent = text;
      status.classList.toggle("hidden", !text);
    };
    listBankInfo(function (done, total) { if (token === banksRender) showStatus("Reading saved banks… " + done + " of " + total); })
      .then(function (items) {
        if (token !== banksRender) return;
        showStatus("");
        grid.textContent = "";
        items.sort(function (x, y) { return compareTitles(x.title, y.title); });
        var tools = byId("bank-tools");
        // A filter is worth having once the list is longer than a screen.
        if (tools) tools.classList.toggle("hidden", items.length <= 12);
        // No filter box, no filter: a word typed earlier mustn't hide banks.
        if (items.length <= 12 && byId("bank-filter")) byId("bank-filter").value = "";
        if (!items.length) {
          var empty = document.createElement("p");
          empty.className = "checkpoints-empty";
          empty.textContent = "No saved banks yet. Load a unit file, then press Save to folder on the Home screen.";
          grid.appendChild(empty);
          return;
        }
        // Files with the same title share one progress file (it follows the title).
        var byTitle = new Map();
        items.forEach(function (item) {
          if (!item.ok) return;
          if (!byTitle.has(item.title)) byTitle.set(item.title, []);
          byTitle.get(item.title).push(item.name);
        });
        var frag = document.createDocumentFragment();
        items.forEach(function (item) {
          var same = item.ok ? byTitle.get(item.title).filter(function (n) { return n !== item.name; }) : [];
          var tile = buildBankTile(item, same);
          tile.dataset.title = (item.title + " " + item.name).toLowerCase().replace(/\s+/g, " ");
          frag.appendChild(tile);
        });
        grid.appendChild(frag);
        applyBankFilter();
      })
      .catch(function (err) { if (token !== banksRender) return; showStatus(""); notifyError(err.message); });
  }

  function makeTileButton(label, ariaLabel, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", ariaLabel);
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  /* sameTitle: the other bank files with this title. */
  function buildBankTile(item, sameTitle) {
    item.sameTitle = sameTitle || [];
    var tile = document.createElement("div");
    tile.className = "checkpoint-tile" + (item.ok ? "" : " broken");
    var body = document.createElement("div");
    body.className = "tile-body";
    var title = document.createElement("p");
    title.className = "checkpoint-unit";
    title.textContent = item.title;
    body.appendChild(title);
    var meta = document.createElement("p");
    meta.className = "checkpoint-meta";
    meta.textContent = item.ok
      ? item.total + (item.total === 1 ? " question" : " questions") + " · " +
        (item.progressError ? "its saved progress can't be read (" + item.progressError + ")" : item.completed + " completed")
      : item.error;
    if (item.progressError) meta.classList.add("progress-warning");
    body.appendChild(meta);
    if (sameTitle && sameTitle.length) {
      var dup = document.createElement("p");
      dup.className = "checkpoint-meta progress-warning bank-same-title";
      dup.textContent = "File " + item.name + " has the same title as " + sameTitle.join(", ") +
        ", so they share one set of completed questions. Rename one to keep them apart.";
      body.appendChild(dup);
    }
    if (item.modified) {
      var when = document.createElement("p");
      when.className = "checkpoint-meta";
      when.textContent = "Saved " + formatSavedAt(new Date(item.modified).toISOString());
      body.appendChild(when);
    }
    tile.appendChild(body);

    var actions = document.createElement("div");
    actions.className = "tile-actions";
    if (item.ok) {
      actions.appendChild(makeTileButton("Rename", "Rename " + item.title, function () { showBankRename(item); }));
    }
    actions.appendChild(makeTileButton("Delete", "Delete " + item.title, function () {
      pendingBankDelete = item;
      byId("bank-delete-hint").textContent = item.title + " (" + item.name + "). " +
        (sameTitle && sameTitle.length
          ? "Its completed questions are kept, because " + sameTitle.join(", ") + " uses them too."
          : "Its completed-question progress is deleted too.") +
        " Checkpoints made from it are kept.";
      byId("bank-delete-modal").classList.remove("hidden");
    }));
    tile.appendChild(actions);

    if (item.ok) {
      tile.tabIndex = 0;
      tile.setAttribute("role", "button");
      tile.setAttribute("aria-label", "Open " + item.title);
      tile.addEventListener("click", function () { openSavedBank(item.name); });
      tile.addEventListener("keydown", function (event) {
        if (event.target === tile && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          openSavedBank(item.name);
        }
      });
    }
    return tile;
  }

  function openSavedBank(name) {
    var token = nextImport();
    desktopCall("read_bank", { name: name })
      .then(checkedBankText)
      .then(function (text) {
        if (!isLatestImport(token)) return;
        var result = loadUnitText(text);
        if (result.ok) {
          state.bankPath = bankPathFor(name);
          renderBankPath();
        }
      })
      .catch(function (err) { notifyError(err.message); });
  }

  function showBankRename(item) {
    pendingBankRename = item;
    var input = byId("bank-rename-input");
    byId("bank-rename-error").textContent = "";
    input.value = item.title;
    byId("bank-rename-modal").classList.remove("hidden");
    input.focus();
    input.select();
  }

  function hideBankRename() {
    pendingBankRename = null;
    byId("bank-rename-modal").classList.add("hidden");
  }

  function saveBankRename() {
    var item = pendingBankRename;
    if (!item) return;
    var input = byId("bank-rename-input");
    var newTitle = input.value.trim();
    if (!newTitle) { notifyError("The name can't be empty."); return; }
    if (newTitle === item.title) { hideBankRename(); return; }
    // When the open bank is renamed, finish its pending save first and hold
    // new ones until the rename is done, so nothing is written under the
    // old title halfway through.
    var isOpen = !!(state.unit && state.unit.unitTitle === item.title);
    // Which open bank is this file? When another file has the same title,
    // only the one opened from this file follows the rename.
    var sameTitle = (item.sameTitle || []).length > 0;
    var isThisFile = function () {
      if (!state.unit || state.unit.unitTitle !== item.title) return false;
      return state.bankPath ? openBankIsFile(item.name) : !sameTitle;
    };
    // Opened from elsewhere (no folder path): follow only if it holds the
    // same questions as the renamed file, so its own content isn't swapped.
    var sameQuestions = function (text) {
      if (state.bankPath) return true;
      try {
        var keys = function (u) { return u.questions.map(completedKey).join("|"); };
        return keys(parseUnitFile(text)) === keys(state.unit);
      } catch (err) { return false; }
    };
    var release = null;
    var op = trackOperation();
    // This bank's progress has to be on disk first: the rename moves the
    // file, and a save still waiting under the old title would bring the
    // old title's progress back later.
    var pending = function () { return unsaved.has(item.title) || (isOpen && !!state.lastSaveError); };
    (isOpen || pending() ? flushSaves(op.promise) : Promise.resolve())
      .then(function () {
        if (pending()) {
          var why = (unsaved.get(item.title) || {}).error || state.lastSaveError;
          throw new Error("This bank's progress couldn't be saved" + (why ? " (" + why + ")" : "") + ", so it wasn't renamed. Try again once saving works.");
        }
        if (!isOpen) return;
        state.progressHold = new Promise(function (r) { release = r; });
        // A save that started in the meantime finishes first.
        return Promise.resolve(saveQueued || saveInFlight).then(function (ok) {
          if (ok === false || pending()) throw new Error("This bank's progress couldn't be saved, so it wasn't renamed. Try again once saving works.");
        });
      })
      .then(function () { return desktopCall("rename_bank", { name: item.name, newTitle: newTitle }); })
      .then(function (result) {
        // Nothing is left to write under the old title.
        unsaved.delete(item.title);
        delete lastWritten[item.title];
        hideBankRename();
        notify("Renamed to " + newTitle + ".");
        if (result[2]) notifyError(result[2]);
        // A bank file has this title now, even if one with it was deleted
        // earlier this session: its progress saves again.
        unmarkUnitDeleted({ unitTitle: newTitle });
        // If this bank is the one currently open, follow the rename.
        if (isThisFile() && sameQuestions(result[1])) {
          try {
            state.unit = parseUnitFile(result[1]);
            state.unitText = result[1];
            state.completedFor = state.unit.unitTitle;
            if (state.bankPath) state.bankPath = bankPathFor(result[0]);
            renderHome(state.unit);
            renderBankPath();
          } catch (err) { /* leave the open unit as it was */ }
        }
        renderBanks();
      })
      .catch(function (err) { notifyError(err.message); })
      .then(function () {
        if (!release) return true;
        state.progressHold = null;
        release();
        // Anything that had to wait is saved now, under the new title.
        if (state.heldSave) { state.heldSave = false; return persistCompleted(); }
        return true;
      })
      .then(function (ok) { op.done(ok); }, function () { op.done(false); });
  }

  function confirmBankDelete() {
    var item = pendingBankDelete;
    pendingBankDelete = null;
    byId("bank-delete-modal").classList.add("hidden");
    if (!item) return;
    // When the open bank is deleted, finish its pending save first and hold
    // new ones, so a queued save can't recreate its progress afterwards.
    var unit = state.unit && state.unit.unitTitle === item.title ? state.unit : null;
    var release = function () {};
    if (unit) state.progressHold = new Promise(function (r) { release = r; });
    var op = trackOperation();
    var deleteOk = false;
    (unit ? flushSaves(op.promise) : Promise.resolve())
      .then(function () { return desktopCall("delete_bank", { name: item.name }); })
      .then(function (result) {
        deleteOk = true;
        // [progress kept for another file with this title, warning]
        var kept = !!(result && result[0]), warning = result && result[1];
        // By title, so a copy of this bank reopened meanwhile is covered too.
        // Not when another copy still uses the progress: it keeps saving.
        if (!kept) markUnitDeleted({ unitTitle: item.title });
        // The open bank was this file: it isn't saved there any more.
        if (kept && openBankIsFile(item.name)) { state.bankPath = ""; renderBankPath(); }
        if (!kept && state.unit && state.unit.unitTitle === item.title) {
          state.bankPath = "";
          renderBankPath();
          // Don't quietly recreate its progress with the next answer.
          state.bankDeleted = true;
          state.completedSaveWarned = false;
        }
        notify(item.title + " deleted.");
        if (warning) notifyError(warning);
        bankInfoCache.delete(item.name);
        renderBanks();
      })
      .catch(function (err) { notifyError(err.message); })
      .then(function () {
        if (!unit) return;
        state.progressHold = null;
        release();
        if (state.heldSave) { state.heldSave = false; return persistCompleted(); }
      })
      .then(function () { op.done(deleteOk); }, function () { op.done(false); });
  }
