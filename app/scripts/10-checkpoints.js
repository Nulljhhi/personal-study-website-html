  /* ---------------------------- Checkpoints ----------------------------
     Desktop only: "Save progress" writes a checkpoint to
     ~/Documents/StudyWebsite/checkpoints, and "Resume saved progress"
     shows them here as a two-column grid of tiles, newest first. */

  var checkpointsReturnTo = "landing";
  var pendingDeleteCheckpoint = null;
  var pendingDeleteCheckpointTitle = "";
  var pendingDoneCheckpoint = null;

  function formatSavedAt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "Unknown date";
    return d.toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit"
    });
  }

  function describeCheckpoint(id, text) {
    var info = { id: id, ok: false, savedAt: "", title: "Unreadable checkpoint" };
    try {
      var data = JSON.parse(text);
      if (!data || data.format !== "study-website-session") return info;
      var title = typeof data.unitTitle === "string" ? data.unitTitle : "";
      if (!title && typeof data.unitText === "string") {
        var m = data.unitText.match(/^\s*unit_title\s*:(.*)$/m);
        if (m) title = m[1].trim();
      }
      var total = typeof data.totalCount === "number" ? data.totalCount : (Array.isArray(data.answers) ? data.answers.length : 0);
      var answered = typeof data.answeredCount === "number" ? data.answeredCount
        : (Array.isArray(data.answers) ? data.answers.filter(function (a) { return a !== null; }).length : 0);
      info.title = title || "Untitled unit";
      // Only list as resumable what Resume would actually accept.
      try { validateSession(text); } catch (err) { info.title = title || info.title; return info; }
      info.ok = true;
      info.mode = data.mode === "exam" ? "exam" : "quiz";
      info.savedAt = typeof data.savedAt === "string" ? data.savedAt : "";
      info.difficulty = data.options && typeof data.options.difficulty === "string" ? data.options.difficulty : "";
      info.answered = answered;
      info.total = total;
    } catch (err) { /* leave as unreadable */ }
    return info;
  }

  /* Checkpoint tiles are cached by file time and size, so only new or
     changed checkpoints are read and validated again. */
  var checkpointInfoCache = new Map();
  /* Bumped by every list render: only the newest one draws, and only it
     updates the cache (an older answer may describe files since changed). */
  var checkpointsRender = 0;

  function listCheckpointInfo(isCurrent) {
    var current = isCurrent || function () { return true; };
    var describe = function (id, text) {
      try { return describeCheckpoint(id, text); }
      catch (err) { return { id: id, ok: false, savedAt: "", title: "Unreadable checkpoint" }; }
    };
    var full = function () {
      return desktopCall("list_checkpoints").then(function (entries) {
        return (entries || []).map(function (e) { return describe(e[0], e[1]); });
      });
    };
    return desktopCall("list_checkpoint_meta").then(function (metas) {
      if (!Array.isArray(metas)) return full();
      var ids = new Set(metas.map(function (m) { return m[0]; }));
      if (current()) checkpointInfoCache.forEach(function (_, k) { if (!ids.has(k)) checkpointInfoCache.delete(k); });
      return mapLimited(metas, 4, function (m) {
        var id = m[0], stamp = m[1] + ":" + m[2];
        var hit = checkpointInfoCache.get(id);
        if (hit && hit.stamp === stamp) return hit.info;
        return desktopCall("read_checkpoint", { id: id })
          .then(function (text) { return describe(id, text); }, function () { return describe(id, ""); })
          .then(function (info) { if (current()) checkpointInfoCache.set(id, { stamp: stamp, info: info }); return info; });
      });
    }, full);
  }

  function openCheckpoints(from) {
    checkpointsReturnTo = from || "landing";
    showScreen("checkpoints");
    renderCheckpoints();
  }

  function renderCheckpoints() {
    var grid = byId("checkpoint-grid");
    var errorEl = byId("checkpoints-error");
    if (!grid) return;
    if (errorEl) errorEl.textContent = "";
    grid.textContent = "";
    var mine = ++checkpointsRender;
    var current = function () { return mine === checkpointsRender; };
    listCheckpointInfo(current)
      .then(function (items) {
        if (!current()) return;
        grid.textContent = "";
        items.sort(function (a, b) { return (b.savedAt || "").localeCompare(a.savedAt || ""); });
        if (!items.length) {
          var empty = document.createElement("p");
          empty.className = "checkpoints-empty";
          empty.textContent = "No checkpoints yet. Press Save progress during a quiz or exam to create one.";
          grid.appendChild(empty);
          return;
        }
        items.forEach(function (item) { grid.appendChild(buildCheckpointTile(item)); });
      })
      .catch(function (err) { if (current()) notifyError(err.message); });
  }

  function buildCheckpointTile(item) {
    var outer = document.createElement("div");
    outer.className = "checkpoint-tile" + (item.ok ? "" : " broken");
    var tile = document.createElement("div");
    tile.className = "tile-body";
    outer.appendChild(tile);
    var title = document.createElement("p");
    title.className = "checkpoint-unit";
    title.textContent = item.title;
    tile.appendChild(title);
    if (item.ok) {
      var mode = document.createElement("span");
      mode.className = "checkpoint-mode" + (item.mode === "exam" ? " exam" : "");
      mode.textContent = item.mode === "exam" ? "Exam" : "Quiz";
      tile.appendChild(mode);
      var when = document.createElement("span");
      when.className = "checkpoint-meta";
      when.textContent = formatSavedAt(item.savedAt);
      tile.appendChild(when);
      var meta = document.createElement("p");
      meta.className = "checkpoint-meta";
      var diff = item.difficulty ? item.difficulty.charAt(0).toUpperCase() + item.difficulty.slice(1) + " · " : "";
      meta.textContent = diff + item.answered + " of " + item.total + " answered";
      tile.appendChild(meta);
      outer.tabIndex = 0;
      outer.setAttribute("role", "button");
      outer.setAttribute("aria-label", "Resume " + mode.textContent + ": " + item.title + ", saved " + when.textContent);
      outer.addEventListener("click", function () { resumeCheckpoint(item.id); });
      outer.addEventListener("keydown", function (event) {
        if (event.target === outer && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          resumeCheckpoint(item.id);
        }
      });
    } else {
      var broken = document.createElement("p");
      broken.className = "checkpoint-meta";
      broken.textContent = "This file couldn't be read. You can delete it.";
      tile.appendChild(broken);
    }
    var actions = document.createElement("div");
    actions.className = "tile-actions";
    actions.appendChild(makeTileButton("Delete", "Delete checkpoint: " + item.title, function () {
      pendingDeleteCheckpoint = item.id;
      pendingDeleteCheckpointTitle = item.title;
      byId("checkpoint-delete-hint").textContent = item.title +
        (item.ok ? " (" + (item.mode === "exam" ? "Exam" : "Quiz") + ", saved " + formatSavedAt(item.savedAt) + ")" : "");
      byId("checkpoint-delete-modal").classList.remove("hidden");
    }));
    outer.appendChild(actions);
    return outer;
  }

  function resumeCheckpoint(id) {
    // Like every other import: only the newest one is opened.
    var token = nextImport();
    desktopCall("read_checkpoint", { id: id })
      .then(function (text) { if (isLatestImport(token)) return restoreQuizProgress(text, id, function () { return isLatestImport(token); }); })
      .catch(function (err) {
        if (!isLatestImport(token)) return;
        notifyError(err && err.message && err.message.indexOf("valid") !== -1
          ? "That checkpoint couldn't be resumed. It may be damaged or from a different version."
          : (err.message || "That checkpoint couldn't be resumed."));
      });
  }

  function deleteCheckpoint(id) {
    // Forget the id only once the file is really gone, so a failed delete
    // keeps later "Save progress" clicks updating the same checkpoint.
    return trackWrite(desktopCall("delete_checkpoint", { id: id })).then(function (r) {
      if (state.quiz.checkpointId === id) state.quiz.checkpointId = null;
      // A save of it that failed earlier must not bring it back on quit.
      forgetWrite("checkpoint:" + id);
      return r;
    });
  }

