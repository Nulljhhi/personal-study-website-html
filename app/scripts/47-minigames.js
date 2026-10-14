
  /* ============================== Minigames ==============================
     In Boss Battle, Quiz Rally and Deep Delve a question is sometimes
     interrupted by a short reflex test that covers it. Everything (your
     timer, the bots, the race) waits while it's up, so it costs focus,
     not time. Tougher enemies (later bosses, elites, deeper floors, harder
     cups) bring them more often, with longer sequences, tighter timing
     and less time to react.

       Dodge     press the arrows shown, in order (arrow keys or WASD)
       Parry     stop the moving marker inside the zone (Space, Enter or click)
       Rune      type the letters shown

     Each game decides what a win and a loss mean (see GAME_HOOKS[id].minigame):
       Boss Battle  win: the answer hits 25% harder   lose: combo broken, boss heals 5%
       Deep Delve   win: +1 damage on this answer     lose: the monster hits you for half
       Quiz Rally   win: a short boost                lose: you spin out */

  var MG_KINDS = ["dodge", "parry", "rune"];
  var MG_ARROWS = { arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓" };
  var MG_WASD = { a: "arrowleft", d: "arrowright", w: "arrowup", s: "arrowdown" };
  var MG_LETTERS = "JKLHGFUIOMN";

  /* Chance per question for a level (0 = never). */
  function mgChance(level) { return level > 0 ? Math.min(0.45, 0.12 + 0.06 * level) : 0; }

  /* After a new question is shown: maybe schedule a minigame a moment in. */
  function mgMaybeSchedule() {
    var g = game, hk = gameHooks();
    if (!g || !g.current || !hk || !hk.minigame) return;
    var t = window.StudyApp && window.StudyApp.__test || {};
    if (t.minigames === "off" || window.__STUDY_TEST_NO_MINIGAMES) return; // automated tests
    var level = hk.minigame.level();
    if (t.minigames === "always" && level) { g.current.mgAt = 300; g.current.mgLevel = level; return; }
    if (!level || g.mgCooldown > 0) { if (g.mgCooldown > 0) g.mgCooldown--; return; }
    if (Math.random() >= mgChance(level)) return;
    g.current.mgAt = 600 + Math.random() * 1400; // ms into the question
    g.current.mgLevel = level;
    g.mgCooldown = 1; // never two in a row
  }

  function mgStart(level) {
    var g = game;
    var kind = MG_KINDS[Math.floor(Math.random() * MG_KINDS.length)];
    var M = g.minigame = { kind: kind, level: level, step: 0, done: false };
    // Keys go to the minigame, not a focused hotspot picture underneath.
    var focused = document.activeElement;
    if (focused && focused.closest && focused.closest("#game-question-pane .hs-pad")) focused.blur();
    M.time = M.total = Math.max(1600, 3600 - 300 * level);
    if (kind === "dodge") {
      var keys = Object.keys(MG_ARROWS);
      M.seq = [];
      for (var i = 0; i < Math.min(6, 1 + Math.ceil(level / 1.5)); i++) M.seq.push(keys[Math.floor(Math.random() * 4)]);
    } else if (kind === "rune") {
      M.seq = [];
      for (var j = 0; j < Math.min(6, 2 + Math.floor(level / 2)); j++) M.seq.push(MG_LETTERS.charAt(Math.floor(Math.random() * MG_LETTERS.length)).toLowerCase());
    } else {
      M.rounds = 1 + Math.floor(level / 3);
      M.zone = Math.max(0.1, 0.3 - 0.035 * level);
      M.speed = 0.6 + 0.12 * level; // sweeps per second
      mgNewZone(M);
      M.time = M.total = Math.max(2400, 4200 - 250 * level) * M.rounds;
    }
    mgRender();
  }
  function mgNewZone(M) { M.pos = 0; M.dir = 1; M.zoneAt = 0.2 + Math.random() * (0.8 - M.zone - 0.2); }

  function mgTick(dt) {
    var g = game, M = g.minigame;
    if (!M || M.done) return;
    M.time -= dt;
    if (M.kind === "parry") {
      M.pos += M.dir * M.speed * dt / 1000;
      if (M.pos >= 1) { M.pos = 1; M.dir = -1; }
      if (M.pos <= 0) { M.pos = 0; M.dir = 1; }
    }
    if (M.time <= 0) { mgFinish(false, "Too slow!"); return; }
    mgRenderLive();
  }

  /* Keys while a minigame is up. Returns true when handled. */
  function mgKey(k) {
    var M = game && game.minigame;
    if (!M || M.done) return false;
    if (M.kind === "dodge") {
      var key = MG_WASD[k] || k;
      if (!MG_ARROWS[key]) return true; // swallow other keys
      mgInput(key);
    } else if (M.kind === "rune") {
      if (k.length === 1 && /[a-z]/.test(k)) mgInput(k);
    } else if (k === " " || k === "enter") mgInput("hit");
    return true;
  }

  function mgInput(v) {
    var M = game.minigame;
    if (!M || M.done) return;
    if (M.kind === "parry") {
      var inside = M.pos >= M.zoneAt && M.pos <= M.zoneAt + M.zone;
      if (!inside) { mgFinish(false, "Missed the zone!"); return; }
      M.step++;
      if (M.step >= M.rounds) { mgFinish(true, "Parried!"); return; }
      mgNewZone(M);
      mgRender();
      return;
    }
    if (v !== M.seq[M.step]) { mgFinish(false, M.kind === "dodge" ? "Wrong way!" : "Wrong rune!"); return; }
    M.step++;
    if (M.step >= M.seq.length) { mgFinish(true, M.kind === "dodge" ? "Dodged!" : "Rune complete!"); return; }
    mgRender();
  }

  function mgFinish(won, text) {
    var g = game, M = g.minigame, hk = gameHooks();
    if (!M || M.done) return;
    M.done = true;
    var note = hk && hk.minigame ? hk.minigame.result(won) : "";
    var box = byId("minigame");
    if (box) {
      box.className = "minigame " + (won ? "won" : "lost");
      box.innerHTML = '<p class="mg-title"></p><p class="mg-note"></p>';
      box.querySelector(".mg-title").textContent = text;
      box.querySelector(".mg-note").textContent = note || "";
    }
    gameEvent(won ? "minigamewin" : "minigamelose");
    var token = g.token, turn = g.turn;
    setTimeout(function () {
      if (!game || game.token !== token) return;
      if (game.minigame === M) game.minigame = null;
      var b = byId("minigame");
      if (b) b.remove();
      if (game.turn === turn) game.lastFrame = performance.now();
      // Back to the hotspot picture it took the keys from.
      if (game.turn === turn && game.current && game.current.pad && !game.locked) game.current.pad.el.focus({ preventScroll: true });
      renderGameHud();
    }, 700);
  }

  /* Clear a minigame without a result (new question, run over). */
  function mgClear() {
    if (game) game.minigame = null;
    var b = byId("minigame");
    if (b) b.remove();
  }

  function mgRender() {
    var M = game.minigame, pane = byId("game-question-pane");
    if (!M || !pane) return;
    var box = byId("minigame");
    if (!box) { box = document.createElement("div"); box.id = "minigame"; pane.appendChild(box); }
    box.className = "minigame";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Minigame");
    var titles = { dodge: "Dodge!", parry: "Parry!", rune: "Cast the rune!" };
    var hints = { dodge: "Press the arrows in order (arrow keys or WASD).", parry: "Stop the marker inside the zone: Space, Enter, or click." + (M.rounds > 1 ? " " + (M.step + 1) + " of " + M.rounds + "." : ""), rune: "Type the letters in order." };
    var html = '<p class="mg-title">' + titles[M.kind] + '</p><p class="mg-hint">' + hints[M.kind] + '</p>';
    if (M.kind === "parry") html += '<div class="mg-track" id="mg-track"><div class="mg-zone" id="mg-zone"></div><div class="mg-marker" id="mg-marker"></div></div><button type="button" class="primary mg-hit" id="mg-hit">Now!</button>';
    else {
      html += '<div class="mg-seq">' + M.seq.map(function (s, i) {
        return '<span class="mg-key' + (i < M.step ? " done" : i === M.step ? " now" : "") + '">' + (M.kind === "dodge" ? MG_ARROWS[s] : s.toUpperCase()) + '</span>';
      }).join("") + '</div>';
      if (M.kind === "dodge") html += '<div class="mg-pad">' + ["arrowleft", "arrowup", "arrowdown", "arrowright"].map(function (k) { return '<button type="button" data-k="' + k + '" aria-label="' + k.slice(5) + '">' + MG_ARROWS[k] + '</button>'; }).join("") + '</div>';
    }
    html += '<div class="mg-time"><div id="mg-time"></div></div>';
    box.innerHTML = html;
    if (M.kind === "parry") {
      byId("mg-zone").style.left = (100 * M.zoneAt) + "%";
      byId("mg-zone").style.width = (100 * M.zone) + "%";
      byId("mg-hit").addEventListener("click", function () { mgInput("hit"); });
    }
    box.querySelectorAll(".mg-pad button").forEach(function (b) { b.addEventListener("click", function () { mgInput(b.dataset.k); }); });
    mgRenderLive();
  }
  function mgRenderLive() {
    var M = game.minigame;
    if (!M) return;
    var t = byId("mg-time");
    if (t) t.style.width = Math.max(0, 100 * M.time / M.total) + "%";
    var mk = byId("mg-marker");
    if (mk) mk.style.left = (100 * M.pos) + "%";
  }
