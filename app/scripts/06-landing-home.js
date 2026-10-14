  /* ---------------------------- Popups ----------------------------
     notify() shows a message in the bottom-left corner with a blue bar
     that shrinks to the left; when it runs out the popup goes away.
     Errors use red and stay twice as long. */

  var TOAST_MS = 4000;
  var ERROR_TOAST_MS = 8000;

  function showToast(message, isError) {
    var stack = byId("toast-stack");
    if (!stack || !message) return;
    var toast = document.createElement("div");
    toast.className = "toast" + (isError ? " error" : "");
    toast.setAttribute("role", isError ? "alert" : "status");
    var text = document.createElement("div");
    text.textContent = message;
    var bar = document.createElement("div");
    bar.className = "toast-bar";
    if (isError) bar.style.backgroundColor = "var(--danger-strong)";
    var ms = isError ? ERROR_TOAST_MS : TOAST_MS;
    bar.style.animationDuration = ms + "ms";
    toast.appendChild(text);
    toast.appendChild(bar);
    stack.appendChild(toast);
    // In a game, keep at most two popups so they stay in the HUD row.
    if (state.screen === "game") while (stack.children.length > 2) stack.removeChild(stack.firstChild);
    setTimeout(function () {
      toast.classList.add("leaving");
      setTimeout(function () { toast.remove(); }, 220);
    }, ms);
  }

  function notify(message) { showToast(message, false); }
  function notifyError(message) { showToast(message, true); }

  /* ---------------------------- Landing ---------------------------- */

  function setLandingError(message) {
    if (message) notifyError(message);
  }

  function loadUnitText(text) {
    var unit;
    try {
      unit = parseUnitFile(text);
      // Pictures the desktop app keeps in its picture folder can't be shown
      // in a plain browser; say so rather than show broken pictures.
      if (!hasDesktop && unit.questions.some(function (q) { return q.image && q.image.indexOf("asset:") === 0; })) {
        throw new Error("This bank's pictures are stored in the desktop app's picture folder, so they can only be shown there. Here, load the original .zip instead.");
      }
    } catch (err) {
      var message = err && err.message ? err.message : "The unit file could not be read.";
      setLandingError(message);
      return { ok: false, error: message };
    }
    if (state.unit && state.unit !== unit) releaseImageUrls();
    state.unit = unit;
    state.unitText = text;
    state.bankPath = "";
    renderBankPath();
    renderHome(unit);
    loadCompletedForUnit();
    showScreen("home");
    warnDuplicateBlocks(unit);
    return { ok: true };
  }

  /* Identical question + answer blocks share one completion mark and one
     garden plant, so point them out. */
  function warnDuplicateBlocks(unit) {
    var seen = new Set(), repeated = new Set();
    unit.questions.forEach(function (q) { var k = completedKey(q); if (seen.has(k)) repeated.add(k); else seen.add(k); });
    var dups = repeated.size;
    if (dups) notify(dups + (dups === 1 ? " question appears" : " questions appear") + " more than once in this bank with the same answer. Copies count as one question for completion and the garden.");
  }

  // The same limits as the desktop reader, so every way in behaves alike.
  // A unit file's text is up to 5 MB; with its pictures written in (from a
  // .zip) a bank is up to 40 MB, and a saved session holding one up to 64 MB.
  // src-tauri/src/files.rs uses the same numbers.
  var MAX_BANK_BYTES = 5 * 1024 * 1024, MAX_BUNDLE_BYTES = 40 * 1024 * 1024, MAX_JSON_BYTES = 64 * 1024 * 1024;

  /* Only the most recent import (file picker, drop or saved bank) is
     opened; one that finishes after a newer one is ignored. */
  var importToken = 0;
  function nextImport() { return ++importToken; }
  function isLatestImport(token) { return token === importToken; }

  /* One shared path for the file input and drag-and-drop. */
  function readUnitFile(file) {
    if (!file) return;
    if (isZipName(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
      if (file.size > MAX_ZIP_BYTES) { setLandingError("\"" + file.name + "\" is too large (the limit for a .zip is 40 MB)."); return; }
      var zipReader = new FileReader();
      var zipToken = nextImport();
      zipReader.onload = function () { if (isLatestImport(zipToken)) loadUnitZip(new Uint8Array(zipReader.result), zipToken); };
      zipReader.onerror = function () { if (isLatestImport(zipToken)) setLandingError("The file could not be read."); };
      zipReader.readAsArrayBuffer(file);
      return;
    }
    // A saved bank can carry its pictures, so it may be bigger than a plain unit file.
    if (file.size > MAX_BUNDLE_BYTES) { setLandingError("\"" + file.name + "\" is too large to be a unit file (the limit is 5 MB of text, or 40 MB with pictures)."); return; }
    var reader = new FileReader();
    var token = nextImport();
    reader.onload = function () {
      if (!isLatestImport(token)) return;
      var text;
      try { text = checkedUnitText(decodeUnitBytes(new Uint8Array(reader.result), file.name), file.name); }
      catch (err) { setLandingError(err.message); return; }
      loadUnitText(text);
    };
    reader.onerror = function () {
      if (isLatestImport(token)) setLandingError("The file could not be read.");
    };
    reader.readAsArrayBuffer(file);
  }

  /* The text of a unit file is at most 5 MB; pictures written into a saved
     bank don't count toward that. */
  function checkedUnitText(text, name) {
    if (splitImageSection(text).text.length > MAX_BANK_BYTES) throw new Error("\"" + name + "\" is too large to be a unit file (the limit is 5 MB of text).");
    return text;
  }

  /* --------------------------- Drag and drop ---------------------------
     In the desktop app, file drops are handled natively: the window
     reports the dropped file's path, and Rust reads it (WebKitGTK doesn't
     reliably pass dropped files to the page). In a browser, the drop
     zone's own drop event is used instead. Either way, a drop that can't
     be used shows an error instead of silently doing nothing. */

  function setDropHighlight(on) {
    var zone = byId("drop-zone");
    if (zone) zone.classList.toggle("drag-over", !!on && state.screen === "landing");
  }

  function handleDroppedPaths(paths) {
    if (state.screen !== "landing") {
      notifyError("To load a unit file, go back to the start screen and drop it there.");
      return;
    }
    if (!paths || !paths.length) {
      notifyError("That wasn't a file. Drag a unit file (.txt or .zip) from your file manager.");
      return;
    }
    if (paths.length > 1) notify("Several files were dropped; loading the first one.");
    var token = nextImport();
    if (isZipName(paths[0])) {
      desktopCall("read_dropped_zip", { path: paths[0] })
        .then(function (buf) {
          if (!isLatestImport(token)) return;
          loadUnitZip(buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf || []), token);
        })
        .catch(function (err) { if (isLatestImport(token)) notifyError(err.message); });
      return;
    }
    desktopCall("read_dropped_file", { path: paths[0] })
      .then(function (text) {
        if (!isLatestImport(token)) return;
        try { text = checkedUnitText(text, paths[0].split(/[\\/]/).pop()); } catch (err) { notifyError(err.message); return; }
        loadUnitText(text);
      })
      .catch(function (err) { if (isLatestImport(token)) notifyError(err.message); });
  }

  /* Fit the 1920x1080 design to the actual window: scale by width and
     height (never above the designed 125%), and below ~1100px wide use
     the stacked layout at 100% instead. */
  var DESIGN_W = 1536, DESIGN_H = 864, NARROW_PX = 1100;
  function fitLayoutZoom() {
    var w = window.innerWidth || DESIGN_W * 1.25, h = window.innerHeight || DESIGN_H * 1.25;
    var narrow = w < NARROW_PX;
    var z = narrow ? 1 : Math.max(0.7, Math.min(1.25, w / DESIGN_W, h / DESIGN_H));
    z = Math.round(z * 1000) / 1000;
    document.documentElement.style.zoom = String(z);
    document.documentElement.style.setProperty("--page-zoom", String(z));
    document.body.classList.toggle("narrow", narrow);
  }

  /* F11 switches between fullscreen and a normal, resizable window. */
  function toggleFullscreen() {
    var api = window.__TAURI__ || {};
    var win = null;
    try { if (api.window && api.window.getCurrentWindow) win = api.window.getCurrentWindow(); } catch (err) { win = null; }
    if (!win || typeof win.isFullscreen !== "function") return;
    Promise.resolve(win.isFullscreen()).then(function (fs) { return win.setFullscreen(!fs); }).catch(function () {});
  }

  /* Quitting (the Quit button, Alt+F4 or the desktop's close action) waits
     for pending saves. If one fails, or saving takes more than a few
     seconds, the window stays open and asks what to do instead of closing
     with unsaved work. */
  var quitForced = false;
  function waitForSaves() {
    return Promise.race([
      flushSaves().catch(function () { return false; }),
      new Promise(function (r) { setTimeout(function () { r("timeout"); }, 3000); })
    ]);
  }
  function showQuitProblem(result) {
    byId("quit-hint").textContent = result === "timeout"
      ? "Saving is taking longer than usual. Wait a moment and try again, or quit now and lose what hasn't been written yet."
      : "A save didn't work" + (state.lastSaveError ? " (" + state.lastSaveError + ")" : "") +
        ". Try again, or quit now and lose the changes that weren't saved.";
    byId("quit-modal").classList.remove("hidden");
    byId("quit-retry-btn").focus();
  }
  function forceQuit() {
    quitForced = true;
    return desktopCall("quit_app");
  }
  function requestQuit() {
    return waitForSaves().then(function (r) {
      if (r === true) return forceQuit();
      showQuitProblem(r);
      return false;
    });
  }
  function setupQuitDialog() {
    var modal = byId("quit-modal");
    byId("quit-cancel-btn").addEventListener("click", function () { modal.classList.add("hidden"); });
    byId("quit-retry-btn").addEventListener("click", function () { modal.classList.add("hidden"); requestQuit(); });
    byId("quit-anyway-btn").addEventListener("click", function () { modal.classList.add("hidden"); forceQuit(); });
  }

  function setupCloseFlush() {
    var api = window.__TAURI__ || {};
    var win = null;
    try { if (api.window && api.window.getCurrentWindow) win = api.window.getCurrentWindow(); } catch (err) { win = null; }
    if (!win || typeof win.onCloseRequested !== "function") return;
    Promise.resolve(win.onCloseRequested(function (event) {
      if (quitForced) return;
      return waitForSaves().then(function (r) {
        if (r === true) return;
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        showQuitProblem(r);
      });
    })).catch(function () {});
  }

  /* Starting the app a second time closes the new copy (see main.rs) and
     brings this window forward; say why. */
  function setupSingleInstanceNotice() {
    var api = window.__TAURI__ || {};
    var modal = byId("instance-modal");
    if (!modal) return;
    byId("instance-ok-btn").addEventListener("click", function () { modal.classList.add("hidden"); });
    if (!api.event || typeof api.event.listen !== "function") return;
    Promise.resolve(api.event.listen("second-instance", function () {
      modal.classList.remove("hidden");
      byId("instance-ok-btn").focus();
    })).catch(function () {});
  }

  function setupNativeDrop() {
    var api = window.__TAURI__ || {};
    var view = null;
    try {
      if (api.webview && api.webview.getCurrentWebview) view = api.webview.getCurrentWebview();
      else if (api.webviewWindow && api.webviewWindow.getCurrentWebviewWindow) view = api.webviewWindow.getCurrentWebviewWindow();
    } catch (err) { view = null; }
    if (!view || typeof view.onDragDropEvent !== "function") return false;
    Promise.resolve(view.onDragDropEvent(function (event) {
      var p = event && event.payload ? event.payload : {};
      if (p.type === "enter" || p.type === "over") setDropHighlight(true);
      else if (p.type === "leave") setDropHighlight(false);
      else if (p.type === "drop") {
        setDropHighlight(false);
        handleDroppedPaths(p.paths);
      }
    })).catch(function (err) {
      notifyError("Drag and drop isn't available (" + (err && err.message ? err.message : err) + "). Use Select file instead.");
    });
    return true;
  }

  /* -------------------------- Documentation -------------------------- */

  function downloadDocs() {
    if (hasDesktop) {
      desktopCall("save_download", { name: "study-website-documentation.md", text: docsMarkdown() })
        .then(function (path) { notify("Documentation saved to " + path); })
        .catch(function (err) { notifyError(err.message); });
      return;
    }
    var blob = new Blob([docsMarkdown()], { type: "text/markdown" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "study-website-documentation.md";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  /* ------------------------------ Home ------------------------------ */

  /* The question list shows a page at a time, so a 20,000-question bank
     doesn't build 20,000 rows before Home appears. */
  var HOME_PAGE = 300;
  var homeShown = 0;
  function renderHome(unit) {
    var title = byId("unit-title");
    if (title) title.textContent = unit.unitTitle;
    var list = byId("qa-list");
    if (!list) return;
    forgetNearView(list);
    list.textContent = "";
    homeShown = 0;
    appendHomeRows(unit);
    renderCompletedMarks();
  }
  /* Clicking a picture in the list tells you where you clicked, as a
     ready-made hotspot line (and copies it), to help write hotspot questions. */
  function listCoordinates(img) {
    img.title = "Click to get the hotspot coordinates of a spot";
    img.style.cursor = "crosshair";
    img.addEventListener("click", function (event) {
      var r = img.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var x = Math.round(1000 * (event.clientX - r.left) / r.width) / 10, y = Math.round(1000 * (event.clientY - r.top) / r.height) / 10;
      var line = "hotspot: " + x + ", " + y;
      // Say "copied" only once the clipboard has really taken it.
      var copy = null;
      try { if (navigator.clipboard && navigator.clipboard.writeText) copy = navigator.clipboard.writeText(line); } catch (err) { copy = null; }
      Promise.resolve(copy ? copy.then(function () { return true; }, function () { return false; }) : false)
        .then(function (copied) { notify(line + (copied ? " (copied)" : " (copy it from here)")); });
    });
  }

  function appendHomeRows(unit) {
    var list = byId("qa-list");
    var old = byId("qa-more-btn");
    if (old) old.remove();
    var end = Math.min(unit.questions.length, homeShown + HOME_PAGE);
    var frag = document.createDocumentFragment();
    for (var i = homeShown; i < end; i++) {
      var question = unit.questions[i];
      var pair = document.createElement("div");
      pair.className = "qa-pair";
      var q = document.createElement("div");
      q.className = "qa-q";
      q.textContent = question.question;
      var a = document.createElement("div");
      a.className = "qa-a";
      if (question.hotspot) {
        var view = hotspotAnswerView(question, true);
        a.appendChild(view);
        listCoordinates(view.querySelector("img"));
      } else a.textContent = question.answer;
      if (question.image && !question.hotspot) {
        var img = questionImage(question, "qa-img", true);
        listCoordinates(img);
        q.appendChild(img);
      }
      pair.appendChild(q);
      pair.appendChild(a);
      frag.appendChild(pair);
      renderCompletedRow(pair, question);
    }
    list.appendChild(frag);
    homeShown = end;
    if (end < unit.questions.length) {
      var more = document.createElement("button");
      more.type = "button";
      more.id = "qa-more-btn";
      more.className = "qa-more-btn";
      var left = unit.questions.length - end;
      more.textContent = "Show " + Math.min(HOME_PAGE, left) + " more (" + end + " of " + unit.questions.length + " shown)";
      more.addEventListener("click", function () {
        if (state.unit !== unit) return;
        appendHomeRows(unit);
        var next = byId("qa-more-btn");
        // Row i is question i, so the first new row is child number end.
        var first = list.children[end];
        if (first && first.classList.contains("qa-pair")) { first.tabIndex = -1; first.focus({ preventScroll: false }); }
        else if (next) next.focus();
      });
      list.appendChild(more);
    }
  }

