  /* ------------------------- Question timers -------------------------
     Every timed question gets reading time (the words in the question and
     all its answer choices, at the player's reading speed) plus thinking
     time. Game pressure only trims the thinking time (never below 1.5 s);
     bonuses like a better rod or conveyor add to it. */

  var READING_SPEEDS = { relaxed: 120, normal: 150, quick: 200 };
  var READING_KEY = "study-website-reading-speed";
  var BASE_THINK_MS = 4000;
  var MIN_THINK_MS = 1500;

  var readingSpeedMemory = null;
  function readingSpeedSetting() {
    var v = readingSpeedMemory;
    if (!v) try { v = window.localStorage.getItem(READING_KEY); } catch (err) { /* no storage */ }
    return READING_SPEEDS[v] ? v : "normal";
  }
  function readingWpm() { return READING_SPEEDS[readingSpeedSetting()]; }
  function countWords(text) {
    var t = String(text || "").trim();
    return t ? t.split(/\s+/).length : 0;
  }
  /* Looking at a picture takes a moment too, counted as extra words: about
     3 s to find a hotspot's spot, about 1.5 s to take in a picture. The
     live timer and the bank average (for bots) both use these. */
  var HOTSPOT_LOOK_WORDS = 8, IMAGE_LOOK_WORDS = 4;
  function choiceWords(q, tf, data) {
    var w = countWords(q.question);
    if (q.hotspot) return w + HOTSPOT_LOOK_WORDS;
    if (q.image) w += IMAGE_LOOK_WORDS;
    if (tf) w += countWords(data.candidate);
    else ["a", "b", "c", "d"].forEach(function (s) { w += countWords(data[s]); });
    return w;
  }
  function readingMs(words) { return words / readingWpm() * 60000; }

  /* Average words per question in this bank (question + answer + three
     wrong answers of similar length, plus picture time), used for bots and
     Blitz scoring. */
  function bankAverageWords() {
    var qs = state.unit.questions;
    var total = 0;
    qs.forEach(function (q) {
      // A hotspot shows no answers to read (its label isn't shown), just the picture.
      if (q.hotspot) { total += countWords(q.question) + HOTSPOT_LOOK_WORDS; return; }
      if (q.image) total += IMAGE_LOOK_WORDS;
      var fakes = q.mediumFakes.concat(q.hardFakes);
      var fakeAvg = fakes.reduce(function (n, f) { return n + countWords(f); }, 0) / Math.max(1, fakes.length);
      total += countWords(q.question) + countWords(q.answer) + 3 * fakeAvg;
    });
    return Math.max(4, total / Math.max(1, qs.length));
  }

  /* Thinking time for the current question in the current game. */
  function gameThinkingMs(who) {
    var g = game;
    who = who || { bossIndex: g.boss.index, correct: g.correct };
    var think = BASE_THINK_MS, bonus = 0, floor = MIN_THINK_MS;
    if (g.id === "boss") think -= g.campaign && !who.bot ? 150 * CB_BOSSES[g.boss.index].world : 350 * who.bossIndex;
    else if (g.id === "survival") think -= 100 * who.correct;
    else if (g.id === "fishing") {
      var r = who.rarity || g.fish.rarity;
      think -= r === "rare" ? 1000 : r === "legendary" ? 2000 : 0;
      if (!who.bot) bonus = rodById(g.profile.rod).time + 1000 * g.profile.stats.reel;
    } else if (g.id === "tycoon") {
      // Bots add their own conveyor in botLimit; yours is only for you.
      if (!who.bot) bonus = 1000 * g.profile.upgrades.conveyor;
      if (typeof tycoonThinkAdjust === "function" && !who.bot) {
        var adj = tycoonThinkAdjust();
        think += adj.think;
        bonus += adj.bonus;
        floor = adj.minThink;
      }
    }
    // Game hooks (your gear, perks, map tier...) and your modifier are
    // yours; bots get their own through botLimit.
    var hkth = gameHooks();
    if (hkth && hkth.thinkAdjust && !who.bot) think += hkth.thinkAdjust(who);
    if (g.modifier && g.modifier.think && !who.bot) think += g.modifier.think;
    return Math.max(floor, think) + bonus;
  }

  function questionTimeLimit(words) {
    var reading = readingMs(words);
    var think = gameThinkingMs();
    if (game.id === "tycoon" && typeof tycoonReadingCut === "function") reading *= tycoonReadingCut();
    return { limit: reading + think, reading: reading, thinking: think };
  }

  /* Missed questions are re-queued a few turns later; otherwise questions
     come from a shuffled deck that's reshuffled when it runs out. */
  /* With "Skip completed questions", only questions that aren't completed
     are drawn (ones answered correctly during the run drop out). If every
     question gets completed mid-run, the game says so and carries on with
     the whole bank. */
  function gameQuestionPool() {
    var g = game;
    var all = state.unit.questions;
    if (!g.skipCompleted || g.poolExhausted) return all;
    var open = all.filter(function (q) { return !isCompleted(q); });
    if (open.length) return open;
    g.poolExhausted = true;
    notify("You've completed every question! The rest of this game uses the whole bank.");
    return all;
  }

  function pickGameQuestion() {
    var g = game;
    var hkp = gameHooks();
    if (hkp && hkp.pick) { g.turn++; var hq = hkp.pick(); if (hq) return hq; g.turn--; }
    var questions = gameQuestionPool();
    g.turn++;
    if (g.skipCompleted && !g.poolExhausted) {
      // Drop anything completed since it was dealt.
      g.deck = g.deck.filter(function (q) { return !isCompleted(q); });
      g.queue = g.queue.filter(function (item) { return !isCompleted(item.q); });
    }
    for (var i = 0; i < g.queue.length; i++) {
      if (g.queue[i].due <= g.turn && (questions.length === 1 || g.queue[i].q.id !== g.lastId)) {
        return g.queue.splice(i, 1)[0].q;
      }
    }
    if (!g.deck.length) {
      g.deck = seededShuffle(questions, (Date.now() + g.turn * 7919) >>> 0);
      if (g.deck.length > 1 && g.deck[0].id === g.lastId) g.deck.push(g.deck.shift());
    }
    return g.deck.shift();
  }

  function nextGameQuestion(levelOverride) {
    var g = game;
    var q = pickGameQuestion();
    var level = levelOverride || gameLevel();
    if (g.modifier && g.modifier.forceHard) level = "hard";
    var seed = (Date.now() ^ (g.turn * 2654435761)) >>> 0;
    var tf;
    if (g.types.length === 2) tf = mulberry32(seed)() < 0.25;
    else tf = g.types[0] === "tf";
    if (q.hotspot) tf = false; // answered on the picture
    var data = q.hotspot ? { hotspot: true }
      : tf ? buildTfCandidate(state.unit, q, level, seed, false)
      : buildMcChoices(state.unit, q, level, seed, false);
    var words = choiceWords(q, tf, data);
    var timing = questionTimeLimit(words);
    var limit = timing.limit;
    g.current = {
      q: q, tf: tf, hs: !!q.hotspot, data: data, level: level, words: words,
      readMs: timing.reading, thinkMs: timing.thinking,
      correctSlot: q.hotspot ? null : tf ? (data.isReal ? "true" : "false") : data.correctSlot,
      limit: limit, remaining: limit, spent: 0, frozen: false, fiftyUsed: false,
      secondChances: 0
    };
    if (g.id === "fishing" && g.profile.rod === "pro") g.current.secondChances = 1;
    g.lastId = q.id;
    g.locked = false;
    showQuestionPane(true);
    mgClear();
    renderGameQuestion();
    mgMaybeSchedule();
    if (g.id === "tycoon") renderTycoonPowerups();
    renderGameHud();
  }

  /* ------------------------------ Rendering ------------------------------ */

  function showQuestionPane(on) {
    byId("game-question-pane").classList.toggle("hidden", !on);
    byId("game-idle-pane").classList.toggle("hidden", on);
  }

  /* Fog and storm effects are removed by timers that only fire for the
     same turn; clear them outright on every new question and run. */
  function clearGameFog() {
    var box = byId("game-choices");
    if (box) box.classList.remove("fogged");
    document.querySelectorAll(".fogged-q").forEach(function (el) { el.classList.remove("fogged-q"); });
    document.querySelectorAll("#game-choices .struck").forEach(function (el) { el.classList.remove("struck"); });
  }

  function renderGameQuestion() {
    var c = game.current;
    clearGameFog();
    byId("game-question").textContent = c.q.question;
    var cand = byId("game-tf-candidate");
    cand.classList.toggle("hidden", !c.tf);
    cand.textContent = c.tf ? c.data.candidate : "";
    var box = byId("game-choices");
    box.textContent = "";
    box.classList.remove("locked");
    c.pad = renderQuestionFigure("game", c.q, {
      onPick: function (x, y) {
        if (game && game.current === c && gameHotspotAvailable()) resolveGameAnswer(hotspotAnswer(x, y));
        else if (c.pad) c.pad.setPick(null);
      }
    });
    // The clock is running: a hotspot question takes the keys straight away.
    if (c.pad && !game.minigame) c.pad.el.focus({ preventScroll: true });
    box.classList.toggle("hs-hidden", c.hs);
    var slots = c.hs ? [] : c.tf ? ["true", "false"] : ["a", "b", "c", "d"];
    slots.forEach(function (slot, i) {
      if (!c.tf && !c.data[slot]) return; // never a blank option
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice";
      btn.dataset.slot = slot;
      var key = document.createElement("span");
      key.className = "key";
      key.textContent = c.tf ? (slot === "true" ? "T" : "F") : String(i + 1);
      btn.appendChild(key);
      btn.appendChild(document.createTextNode(c.tf ? (slot === "true" ? "True" : "False") : c.data[slot]));
      box.appendChild(btn);
    });
    var fb = byId("game-feedback");
    fb.textContent = "";
    fb.classList.remove("right", "wrong");
    if (gameHooks() && gameHooks().decorate) gameHooks().decorate(box, c);
    if (game.campaign && cbHas("fog")) {
      box.classList.add("fogged");
      gameAfter(1000, function () { box.classList.remove("fogged"); }, true);
    }
    if (game.id === "tycoon" && game.ty.active.inspector) {
      if (c.tf || c.hs) {
        // Nothing to remove on True/False; keep the inspector for the next order.
        game.ty.active.inspector = false;
        game.ty.pending.inspector = true;
      } else {
        var wrong = ["a", "b", "c", "d"].filter(function (s) { return s !== c.correctSlot; });
        seededShuffle(wrong, (Date.now() >>> 0)).slice(0, 2).forEach(function (s) {
          var b = box.querySelector('button.choice[data-slot="' + s + '"]');
          if (b) b.classList.add("removed");
        });
      }
    }
  }

  function hudStat(label, value, id) {
    var wrap = document.createElement("div");
    wrap.className = "game-stat";
    var l = document.createElement("span");
    l.className = "game-stat-label";
    l.textContent = label;
    var v = document.createElement("span");
    v.textContent = value;
    if (id) v.id = id;
    wrap.appendChild(l);
    wrap.appendChild(v);
    return wrap;
  }

  function renderGameHud() {
    var g = game;
    var hearts = byId("game-hearts");
    hearts.classList.toggle("hidden", !g.info.hearts);
    if (g.info.hearts) {
      hearts.textContent = "";
      for (var i = 0; i < maxHearts(); i++) {
        var h = document.createElement("span");
        h.textContent = "♥";
        if (i >= g.hearts) h.className = "lost";
        hearts.appendChild(h);
      }
      hearts.setAttribute("aria-label", g.hearts + " of " + maxHearts() + " hearts");
    }
    var stats = byId("game-stats");
    stats.textContent = "";
    if (g.id === "fishing") {
      stats.appendChild(hudStat("Time", fmtClock(g.sessionLeft), "game-session-clock"));
      stats.appendChild(hudStat("Coins", fmtScore(g.profile.coins)));
      stats.appendChild(hudStat("Caught", String(g.fish.catches)));
    } else if (g.id === "tycoon") {
      stats.appendChild(hudStat("Day", String(g.profile.day)));
      stats.appendChild(hudStat("Bank", fmtMoney(g.profile.money)));
      stats.appendChild(hudStat("Today", fmtMoney(g.ty.dayRevenue - g.ty.dayPenalties)));
      stats.appendChild(hudStat("Time left", fmtClock(Math.max(0, g.ty.dayLeft)), "ty-hud-clock"));
    } else if (gameHooks() && gameHooks().hud) {
      gameHooks().hud(stats);
    } else {
      stats.appendChild(hudStat("Score", fmtScore(g.score), "game-score"));
    }
    var combo = hudStat("Combo", "×" + comboMultiplier() + (g.combo ? " (" + g.combo + ")" : ""), "game-combo");
    if (g.combo >= 3) combo.lastChild.classList.add("hot");
    stats.appendChild(combo);
    var questionUp = g.current && !byId("game-question-pane").classList.contains("hidden");
    var lvlText = questionUp ? LEVEL_NAMES[g.current.level]
      : g.id === "fishing" ? (g.diffMode === "single" ? LEVEL_NAMES[g.singleLevel] : "By rarity")
      : LEVEL_NAMES[gameLevel()];
    stats.appendChild(hudStat("Level", lvlText, "game-level"));
    var pu = byId("game-powerups");
    pu.classList.toggle("hidden", !g.info.powerups);
    if (g.info.powerups) {
      pu.textContent = "";
      Object.keys(POWERUP_INFO).forEach(function (name) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.powerup = name;
        btn.disabled = !canUsePowerup(name);
        btn.title = POWERUP_INFO[name].label + " (key " + POWERUP_INFO[name].key + ")";
        btn.appendChild(document.createTextNode(POWERUP_INFO[name].label));
        var count = document.createElement("span");
        count.className = "count";
        count.textContent = "×" + g.powerups[name];
        btn.appendChild(count);
        btn.addEventListener("click", function () { usePowerup(name); });
        pu.appendChild(btn);
      });
    }
    renderGameTimer();
  }

  var renderDefer = null; // set while a frame's clock steps run (see gameTick)
  function renderGameTimer() {
    if (renderDefer) { renderDefer.timer = true; return; }
    var g = game;
    var bar = byId("game-timer-bar");
    var frac;
    var questionUp = g.current && !g.locked && !byId("game-question-pane").classList.contains("hidden");
    if (g.info.perQuestionTimer) frac = questionUp ? g.current.remaining / g.current.limit : (g.locked && g.current ? g.current.remaining / g.current.limit : 1);
    else frac = g.blitzLeft / ((g.blitzTotal || BLITZ_SECONDS) * 1000);
    frac = clamp(frac, 0, 1);
    // Clipped rather than resized: a new width would lay out the page again
    // every frame, a new clip only repaints the bar. Written only when the
    // drawn value changes (kept on the element: reading a style back costs
    // more than writing it).
    var clip = "inset(0 " + (100 - frac * 100).toFixed(1) + "% 0 0 round 5px)";
    if (bar.__clip !== clip) { bar.__clip = clip; bar.style.clipPath = clip; }
    bar.classList.toggle("low", frac < 0.3);
    bar.classList.toggle("frozen", !!(g.current && g.current.frozen));
    var mark = byId("game-timer-mark");
    var showMark = g.info.perQuestionTimer && questionUp && g.current.thinkMs < g.current.limit;
    mark.classList.toggle("hidden", !showMark);
    if (showMark) {
      var left = (100 * g.current.thinkMs / g.current.limit).toFixed(1) + "%";
      if (mark.__left !== left) { mark.__left = left; mark.style.left = left; }
    }
    if (g.id === "blitz") {
      var big = byId("arena-big");
      if (big) {
        var secs = Math.max(0, Math.ceil(g.blitzLeft / 1000));
        if (big.textContent !== String(secs)) big.textContent = String(secs);
        big.classList.toggle("low", secs <= 10);
      }
    }
    if (gameHooks() && gameHooks().timerExtra) gameHooks().timerExtra();
    if (g.id === "fishing") {
      var clock = byId("game-session-clock");
      var txt = fmtClock(g.sessionLeft);
      if (clock && clock.textContent !== txt) clock.textContent = txt;
    }
  }

  function bossSvg(kind, hue) {
    var main = "hsl(" + hue + ",65%,52%)";
    var dark = "hsl(" + hue + ",60%,32%)";
    var light = "hsl(" + hue + ",80%,75%)";
    var eyes = '<circle cx="100" cy="112" r="13" fill="#fff"/><circle cx="160" cy="112" r="13" fill="#fff"/>' +
      '<circle cx="103" cy="115" r="6" fill="#1b1b1b"/><circle cx="157" cy="115" r="6" fill="#1b1b1b"/>';
    var body;
    if (kind === "slime") {
      body = '<ellipse cx="130" cy="236" rx="96" ry="12" fill="rgba(0,0,0,.18)"/>' +
        '<path d="M34 226 C30 150 70 70 130 70 C190 70 230 150 226 226 Z" fill="' + main + '" stroke="' + dark + '" stroke-width="5"/>' +
        '<ellipse cx="96" cy="100" rx="18" ry="10" fill="' + light + '" opacity=".7"/>' + eyes +
        '<path d="M108 160 Q130 176 152 160" stroke="' + dark + '" stroke-width="6" fill="none" stroke-linecap="round"/>';
    } else if (kind === "wisp") {
      body = '<ellipse cx="130" cy="240" rx="70" ry="9" fill="rgba(0,0,0,.14)"/>' +
        '<path d="M60 200 C40 130 70 50 130 50 C190 50 220 130 200 200 L185 185 L170 215 L150 190 L130 220 L110 190 L90 215 L75 185 Z" fill="' + main + '" stroke="' + dark + '" stroke-width="5" opacity=".92"/>' +
        '<circle cx="130" cy="40" r="10" fill="' + light + '" opacity=".8"/><circle cx="98" cy="70" r="6" fill="' + light + '" opacity=".6"/>' + eyes +
        '<ellipse cx="130" cy="150" rx="14" ry="10" fill="' + dark + '"/>';
    } else if (kind === "beetle") {
      body = '<ellipse cx="130" cy="236" rx="100" ry="11" fill="rgba(0,0,0,.18)"/>' +
        '<path d="M60 150 L20 120 M60 180 L18 190 M200 150 L240 120 M200 180 L242 190 M80 210 L50 236 M180 210 L210 236" stroke="' + dark + '" stroke-width="8" stroke-linecap="round"/>' +
        '<ellipse cx="130" cy="165" rx="78" ry="62" fill="' + main + '" stroke="' + dark + '" stroke-width="5"/>' +
        '<path d="M130 105 L130 226" stroke="' + dark + '" stroke-width="4"/>' +
        '<ellipse cx="102" cy="150" rx="16" ry="22" fill="' + light + '" opacity=".45"/>' +
        '<circle cx="130" cy="96" r="38" fill="' + dark + '"/><path d="M110 64 L96 30 M150 64 L164 30" stroke="' + dark + '" stroke-width="6" stroke-linecap="round"/>' +
        '<circle cx="116" cy="92" r="8" fill="#fff"/><circle cx="144" cy="92" r="8" fill="#fff"/><circle cx="118" cy="94" r="4" fill="#111"/><circle cx="142" cy="94" r="4" fill="#111"/>';
    } else if (kind === "golem") {
      body = '<ellipse cx="130" cy="240" rx="100" ry="10" fill="rgba(0,0,0,.18)"/>' +
        '<rect x="40" y="128" width="40" height="80" rx="10" fill="' + dark + '"/><rect x="180" y="128" width="40" height="80" rx="10" fill="' + dark + '"/>' +
        '<rect x="70" y="120" width="120" height="100" rx="14" fill="' + main + '" stroke="' + dark + '" stroke-width="5"/>' +
        '<rect x="84" y="60" width="92" height="76" rx="12" fill="' + main + '" stroke="' + dark + '" stroke-width="5"/>' +
        '<rect x="80" y="220" width="36" height="20" rx="6" fill="' + dark + '"/><rect x="144" y="220" width="36" height="20" rx="6" fill="' + dark + '"/>' +
        '<path d="M100 160 l20 14 M150 150 l-14 22" stroke="' + dark + '" stroke-width="4"/>' +
        '<rect x="100" y="88" width="18" height="12" rx="3" fill="' + light + '"/><rect x="142" y="88" width="18" height="12" rx="3" fill="' + light + '"/>' +
        '<rect x="112" y="112" width="36" height="7" rx="3" fill="' + dark + '"/>';
    } else {
      body = '<ellipse cx="130" cy="240" rx="100" ry="10" fill="rgba(0,0,0,.18)"/>' +
        '<path d="M70 120 L10 60 L40 150 Z" fill="' + dark + '"/><path d="M190 120 L250 60 L220 150 Z" fill="' + dark + '"/>' +
        '<ellipse cx="130" cy="170" rx="72" ry="60" fill="' + main + '" stroke="' + dark + '" stroke-width="5"/>' +
        '<ellipse cx="130" cy="186" rx="40" ry="34" fill="' + light + '" opacity=".6"/>' +
        '<circle cx="130" cy="100" r="50" fill="' + main + '" stroke="' + dark + '" stroke-width="5"/>' +
        '<path d="M98 60 L90 30 L112 54 Z M162 60 L170 30 L148 54 Z" fill="' + dark + '"/>' +
        '<circle cx="112" cy="96" r="9" fill="#ffd34d"/><circle cx="148" cy="96" r="9" fill="#ffd34d"/>' +
        '<rect x="110" y="93" width="4" height="10" fill="#1b1b1b"/><rect x="146" y="93" width="4" height="10" fill="#1b1b1b"/>' +
        '<path d="M112 124 Q130 136 148 124" stroke="' + dark + '" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        '<rect x="88" y="222" width="22" height="18" rx="5" fill="' + dark + '"/><rect x="150" y="222" width="22" height="18" rx="5" fill="' + dark + '"/>';
    }
    return '<svg class="boss-figure" id="boss-figure" viewBox="0 0 260 260" role="img" aria-hidden="true">' + body + '</svg>';
  }

  /* A simple original fish drawing, coloured by species hue and rarity. */
  function fishSvg(hue, rarity, size) {
    var main = "hsl(" + hue + ",70%,55%)";
    var dark = "hsl(" + hue + ",60%,33%)";
    var light = "hsl(" + hue + ",85%,78%)";
    var glow = rarity === "legendary" ? '<ellipse cx="110" cy="60" rx="100" ry="52" fill="hsl(' + hue + ',90%,70%)" opacity=".25"/>' :
      rarity === "rare" ? '<ellipse cx="110" cy="60" rx="92" ry="46" fill="hsl(' + hue + ',90%,70%)" opacity=".15"/>' : "";
    var fin = rarity === "legendary" ? '<path d="M90 20 L110 0 L128 22 Z" fill="' + dark + '"/>' : '<path d="M92 24 L112 10 L126 26 Z" fill="' + dark + '"/>';
    return '<svg viewBox="0 0 220 120" width="' + (size || 200) + '" aria-hidden="true">' + glow + fin +
      '<path d="M170 60 L212 30 L206 60 L212 90 Z" fill="' + dark + '"/>' +
      '<ellipse cx="105" cy="60" rx="72" ry="36" fill="' + main + '" stroke="' + dark + '" stroke-width="4"/>' +
      '<ellipse cx="96" cy="72" rx="44" ry="14" fill="' + light + '" opacity=".6"/>' +
      '<path d="M120 34 Q130 60 120 86" stroke="' + dark + '" stroke-width="3" fill="none"/>' +
      '<circle cx="60" cy="52" r="8" fill="#fff"/><circle cx="58" cy="53" r="4" fill="#1b1b1b"/></svg>';
  }

  function waterSvg(color, phase) {
    var bob = phase === "waiting" ? '<g class="bobber-wait">' : phase === "bite" ? '<g class="bobber-bite">' : '<g>';
    var line = phase === "idle" ? "" : '<path d="M250 0 Q240 60 150 112" stroke="#333" stroke-width="2" fill="none"/>' + bob +
      '<circle cx="150" cy="114" r="9" fill="#e5484d" stroke="#fff" stroke-width="3"/></g>';
    return '<svg viewBox="0 0 300 200" class="fish-water" aria-hidden="true">' +
      '<rect x="0" y="110" width="300" height="90" fill="' + color + '"/>' +
      '<path d="M0 116 Q37 108 75 116 T150 116 T225 116 T300 116" stroke="rgba(255,255,255,.5)" stroke-width="3" fill="none"/>' +
      '<path d="M20 150 Q50 144 80 150 M180 170 Q210 164 240 170" stroke="rgba(255,255,255,.25)" stroke-width="3" fill="none"/>' +
      line + '</svg>';
  }

  var BOSS_KINDS = [
    { kind: "slime", name: "Slime", hue: 135 },
    { kind: "golem", name: "Stone Golem", hue: 30 },
    { kind: "dragon", name: "Ember Dragon", hue: 5 }
  ];
  var ROMAN = ["", " II", " III", " IV", " V", " VI", " VII", " VIII", " IX", " X"];

  function bossInfo(index) {
    if (game && game.campaign) { var cb = CB_BOSSES[index]; return { kind: cb.kind, name: cb.name, hue: cb.hue }; }
    var base = BOSS_KINDS[index % BOSS_KINDS.length];
    var round = Math.floor(index / BOSS_KINDS.length);
    return {
      kind: base.kind,
      name: base.name + (round < ROMAN.length ? ROMAN[round] : " " + (round + 1)),
      hue: (base.hue + round * 70) % 360
    };
  }

  function bossMaxHp(index) { return Math.round(100 * Math.pow(1.45, index)); }

  function newBoss(index) {
    game.boss.index = index;
    game.bossLost = 0;
    game.boss.max = bossMaxHp(index);
    game.boss.hp = game.boss.max;
    game.boss.shields = bossShieldPlan(index, false);
  }

  /* Shield layers: bars a boss's health hides behind. Each layer is about
     30% of its health; a hit that breaks a layer stops there, and a miss
     recharges the outer layer by 10%. Endless bosses get one layer from
     boss 6 and two from boss 13; in the campaign, worlds 3-4 bring one
     and world 5 two. */
  function bossShieldPlan(index, campaign) {
    var layers, max;
    if (campaign) {
      var w = CB_BOSSES[index].world;
      layers = w >= 4 ? 2 : w >= 2 ? 1 : 0;
      max = cbHp(index);
    } else {
      layers = index >= 12 ? 2 : index >= 5 ? 1 : 0;
      max = bossMaxHp(index);
    }
    var out = [];
    for (var i = 0; i < layers; i++) out.push({ hp: Math.round(max * 0.3), max: Math.round(max * 0.3) });
    return out;
  }
  function bossShieldTotal(index, campaign) { return bossShieldPlan(index, campaign).reduce(function (n, s) { return n + s.max; }, 0); }

  /* Damage to the boss: shields first. Returns { toHp, note }. */
  function bossTakeDamage(points) {
    var b = game.boss;
    if (points > 0 && b.shields && b.shields.length) {
      var sh = b.shields[0];
      sh.hp = Math.max(0, sh.hp - points);
      if (sh.hp <= 0) { b.shields.shift(); return { toHp: 0, note: b.shields.length ? " Shield broken! One more layer." : " Shield broken! Now its health." }; }
      return { toHp: 0, note: " The shield takes it (" + sh.hp + " left)." };
    }
    b.hp -= points;
    return { toHp: points, note: "" };
  }
  function bossShieldRecharge() {
    var b = game.boss;
    if (!b.shields || !b.shields.length) return "";
    var sh = b.shields[0];
    if (sh.hp >= sh.max) return "";
    sh.hp = Math.min(sh.max, sh.hp + Math.round(sh.max * 0.1));
    return "Its shield recharges.";
  }

  function renderArena(enter) {
    var g = game;
    var arena = byId("game-arena");
    if (g.id === "boss") {
      var b = bossInfo(g.boss.index);
      arena.innerHTML =
        '<p class="arena-name" id="arena-name"></p>' +
        '<p class="arena-sub" id="arena-sub"></p>' +
        '<div id="boss-shields" class="boss-shields"></div><div class="boss-hp-track"><div class="boss-hp" id="boss-hp"></div></div>' +
        '<p class="boss-hp-text" id="boss-hp-text"></p>' + bossSvg(b.kind, b.hue);
      byId("arena-name").textContent = b.name;
      byId("arena-sub").textContent = g.campaign ? cbStatusText() : "Boss " + (g.boss.index + 1) + " · " + LEVEL_NAMES[gameLevel()];
      if (enter) byId("boss-figure").classList.add("enter");
      renderBossHp();
    } else if (g.id === "survival") {
      arena.innerHTML =
        '<p class="arena-name">Survival</p><p class="arena-sub" id="arena-sub"></p>' +
        '<div class="arena-big" id="arena-big"></div><div class="arena-caption">Correct answers</div>' +
        '<div class="arena-row"><div><span class="arena-caption">Thinking time</span><strong id="arena-timer"></strong></div>' +
        '<div><span class="arena-caption">Best streak</span><strong id="arena-streak"></strong></div></div>';
      renderSurvivalArena();
    } else if (g.id === "blitz") {
      arena.innerHTML =
        '<p class="arena-name">Blitz</p><p class="arena-sub">' + (g.league ? BZ_TIERS[g.profile.tier].name + " league match" : g.blitzVariant ? bzVariant(g.blitzVariant).name + ": " + bzVariant(g.blitzVariant).desc : "Answer as many as you can") + '</p>' +
        '<div class="arena-big" id="arena-big"></div><div class="arena-caption">Seconds left</div>' +
        '<div class="arena-row"><div><span class="arena-caption">Correct</span><strong id="arena-correct"></strong></div>' +
        '<div><span class="arena-caption">Accuracy</span><strong id="arena-accuracy"></strong></div></div>';
      renderBlitzArena();
      renderGameTimer();
    } else if (g.id === "fishing") {
      renderFishingArena();
    } else if (gameHooks()) {
      gameHooks().renderArena(enter);
    } else {
      renderTycoonArena();
    }
  }

  function renderBossHp() {
    var b = game.boss;
    byId("boss-hp").style.width = Math.max(0, 100 * b.hp / b.max) + "%";
    var sh = b.shields || [];
    byId("boss-hp-text").textContent = Math.max(0, b.hp) + " / " + b.max + " HP" +
      (sh.length ? " · " + sh.length + (sh.length === 1 ? " shield layer" : " shield layers") + " (" + sh[0].hp + " / " + sh[0].max + ")" : "");
    var box = byId("boss-shields");
    if (!box) return;
    box.textContent = "";
    sh.forEach(function (s, i) {
      var t = document.createElement("div");
      t.className = "boss-shield-track" + (i ? " inner" : "");
      var f = document.createElement("div");
      f.className = "boss-shield";
      f.style.width = (100 * s.hp / s.max) + "%";
      t.appendChild(f);
      box.appendChild(t);
    });
  }

  function renderSurvivalArena() {
    var b = svBiome();
    var sub = byId("arena-sub");
    if (sub) sub.textContent = game.survival ? b.name + " · " + b.desc : "Keep going as long as you can";
    byId("game-arena").dataset.biome = game.survival ? b.id : "";
    byId("arena-big").textContent = String(game.correct);
    byId("arena-timer").textContent = (gameThinkingMs() / 1000).toFixed(1) + "s";
    byId("arena-streak").textContent = String(game.bestStreak);
  }

  function renderBlitzArena() {
    byId("arena-correct").textContent = String(game.correct);
    byId("arena-accuracy").textContent = game.answered ? Math.round(100 * game.correct / game.answered) + "%" : "—";
  }

  function floatText(text, cls) {
    var arena = byId("game-arena");
    var el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    arena.appendChild(el);
    setTimeout(function () { el.remove(); }, 950);
  }

  function flashScreen(kind) {
    var f = byId("game-flash");
    f.className = "game-flash";
    void f.offsetWidth;
    f.className = "game-flash " + kind;
  }

