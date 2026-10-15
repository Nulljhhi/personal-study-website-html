  /* ---------------------------- Games page ---------------------------- */

  function renderGamesPage() {
    var grid = byId("games-grid");
    if (!grid) return;
    grid.textContent = "";
    GAME_ORDER.forEach(function (id) {
      var info = GAMES[id];
      var tile = document.createElement("div");
      tile.className = "checkpoint-tile";
      tile.tabIndex = 0;
      tile.setAttribute("role", "button");
      tile.setAttribute("aria-label", "Play " + info.name);
      var body = document.createElement("div");
      body.className = "tile-body";
      var title = document.createElement("p");
      title.className = "checkpoint-unit";
      title.textContent = info.name;
      var desc = document.createElement("p");
      desc.className = "game-tile-desc";
      desc.textContent = info.desc;
      body.appendChild(title);
      body.appendChild(desc);
      var lines = [];
      if (id === "fishing") {
        var fp = state.gameData.fishing;
        var total = 0, got = 0;
        FISH_LOCATIONS.forEach(function (l) { l.species.forEach(function (sp) { total++; if (fp.caught[l.id + ":" + sp[0]]) got++; }); });
        lines.push(fmtScore(fp.coins) + " coins · " + got + " of " + total + " species caught");
      } else if (id === "tycoon") {
        var tp = state.gameData.tycoon;
        lines.push("Day " + tp.day + " · " + fmtMoney(tp.money) + " in the bank");
      }
      var hkt = gameHooks(id);
      if (hkt && hkt.tileLines) lines = lines.concat(hkt.tileLines());
      lines.push("Level " + playerLevel(id));
      if (!hkt || hkt.keepBest) ["rising", "easy", "medium", "hard"].forEach(function (mode) {
        var best = state.highScores[id + ":" + mode];
        if (best) lines.push("Best (" + (mode === "rising" ? "Rising" : LEVEL_NAMES[mode]) + "): " + (id === "tycoon" ? fmtMoney(best) : fmtScore(best)));
      });
      if (state.gameData.ratings[id] !== undefined) lines.push("Rating vs bots: " + Math.round(playerRating(id)));
      lines.forEach(function (text) {
        var line = document.createElement("p");
        line.className = "game-tile-best";
        line.textContent = text;
        body.appendChild(line);
      });
      tile.appendChild(body);
      var open = function () { openGameSetup(id); };
      tile.addEventListener("click", open);
      tile.addEventListener("keydown", function (e) {
        if (e.target === tile && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); }
      });
      grid.appendChild(tile);
    });
  }

  function openGameSetup(id) {
    gameSetupFor = id;
    var info = GAMES[id];
    byId("game-setup-title").textContent = info.name;
    byId("game-setup-rules").textContent = info.rules;
    byId("game-progress-options").classList.toggle("hidden", !info.progression);
    byId("game-fishing-options").classList.toggle("hidden", id !== "fishing");
    var hks = gameHooks(id);
    Object.keys(GAME_HOOKS).forEach(function (k) { var el = byId(GAME_HOOKS[k].setupPanel); if (el) el.classList.toggle("hidden", k !== id); });
    byId("game-bots-row").classList.toggle("hidden", !!(hks && hks.noBots));
    byId("game-setup-shop-btn").textContent = hks && hks.shopLabel ? hks.shopLabel : "Shop & collection";
    var startBtn = byId("game-start-btn");
    var shopBtn = byId("game-setup-shop-btn");
    startBtn.disabled = true;
    shopBtn.disabled = true;
    updateGameSetup();
    byId("game-setup-best").textContent = "Loading your saved progress\u2026";
    showScreen("game-setup");
    byId("game-progress-panel").textContent = "";
    byId("game-modifier-row").classList.add("hidden");
    state.completedReady.then(function () {
      if (gameSetupFor !== id) return;
      if (id === "fishing") byId("game-minutes").value = String(state.gameData.fishing.minutes);
      startBtn.disabled = false;
      shopBtn.disabled = false;
      rollModifier(id);
      renderProgressPanel(id);
      updateGameSetup();
      onGameSetupOpened(id);
    });
  }

  function readGameSetup() {
    var modeEl = document.querySelector('input[name="game-diff-mode"]:checked');
    var levelEl = document.querySelector('input[name="game-level"]:checked');
    var progression = GAMES[gameSetupFor] && GAMES[gameSetupFor].progression;
    return {
      diffMode: modeEl && modeEl.value === "single" ? "single" : "rising",
      level: levelEl ? levelEl.value : "easy",
      types: selectedTypes(byId("game-type-mc"), byId("game-type-tf")),
      bots: byId("game-bots").checked && !(gameHooks(gameSetupFor) && gameHooks(gameSetupFor).noBots),
      extra: gameHooks(gameSetupFor) && gameHooks(gameSetupFor).readSetup ? gameHooks(gameSetupFor).readSetup() : null,
      skipCompleted: byId("game-skip-completed").checked,
      modifier: byId("game-modifier").checked ? eligibleModifier(gameSetupFor) : null,
      clean: !!progression && byId("game-clean").checked,
      minutes: fishingMinutes(byId("game-minutes").value)
    };
  }

  function updateGameSetup() {
    var setup = readGameSetup();
    var single = setup.diffMode === "single";
    byId("game-single-levels").classList.toggle("disabled", !single);
    document.querySelectorAll('input[name="game-level"]').forEach(function (el) { el.disabled = !single; });
    var setupVariant = gameSetupFor === "blitz" && setup.extra && setup.extra.variant !== "classic" ? setup.extra.variant : null;
    var best = state.highScores[scoreKey(gameSetupFor, setup.diffMode, setup.level, setupVariant)];
    var label = setup.diffMode === "rising" ? "Rising" : LEVEL_NAMES[setup.level];
    var lines = [];
    lines.push(best ? "Your best on " + label + ": " + (gameSetupFor === "tycoon" ? fmtMoney(best) : fmtScore(best)) : "No score yet on " + label + ".");
    if (setup.bots) lines.push("Your rating vs bots: " + Math.round(playerRating(gameSetupFor)) + (setup.clean ? " (a clean run doesn't change it)" : ""));
    if (gameSetupFor === "fishing") {
      var fp = state.gameData.fishing;
      lines.push(setup.clean ? "Clean run: you start at the Pond with a Bamboo Rod and 0 coins. Nothing is saved."
        : "Fishing at the " + locationById(fp.location).name + " with the " + rodById(fp.rod).name + " · " + fmtScore(fp.coins) + " coins · bounties today: " +
          fishBounties(fp).filter(function (b) { return b.done; }).length + " of 3 done");
    } else if (gameSetupFor === "tycoon") {
      var tp = state.gameData.tycoon;
      lines.push(setup.clean ? "Clean run: a brand-new warehouse with $200. Nothing is saved."
        : "Your warehouse: day " + tp.day + ", " + fmtMoney(tp.money) + " in the bank.");
    }
    var hku = gameHooks(gameSetupFor);
    if (hku && hku.setupLines) lines = hku.setupLines(setup);
    byId("game-setup-best").textContent = lines.join("  ·  ");
    if (state.unit) {
      var total = questionTotal();
      byId("game-skip-hint").textContent = "— " + (total - completedCount()) + " of " + total + " not completed yet";
    }
    byId("game-setup-shop-btn").classList.toggle("hidden", !((gameSetupFor === "fishing" && !setup.clean) || (hku && hku.openShop)));
  }

  /* --------------------------- Starting a run --------------------------- */

  function startGame(id, setup) {
    if (!state.unit || !state.unit.questions.length) return;
    if (!setup.types.length) {
      notifyError("Select at least one question type: Multiple Choice or True/False.");
      return;
    }
    // Wait for the bank's saved progress so a run never starts from (and
    // then saves over) an empty profile.
    var startToken = ++gameRunToken;
    whenProgressReady(function () {
      if (startToken !== gameRunToken) return;
      if (setup.skipCompleted && completedCount() >= questionTotal()) {
        notifyError("Every question is completed. Press Reset completed on the Home screen to start over, or turn off Skip completed questions.");
        return;
      }
      beginGame(id, setup, startToken);
    });
  }

  function beginGame(id, setup, token) {
    var info = GAMES[id];
    var g = game = {
      id: id, info: info, token: token, setup: setup,
      diffMode: setup.diffMode, singleLevel: setup.level, types: setup.types.slice(),
      clean: !!setup.clean, botsOn: !!setup.bots,
      skipCompleted: !!setup.skipCompleted, poolExhausted: false,
      modifier: setup.modifier || null, rewardMult: (setup.modifier && setup.modifier.reward) || 1, xpEarned: 0,
      score: 0, combo: 0, bestStreak: 0, correct: 0, answered: 0,
      hearts: info.hearts ? MAX_HEARTS : 0,
      powerups: { fifty: 0, freeze: 0, heal: 0 },
      streakSinceReward: 0,
      deck: [], queue: [], turn: 0, lastId: null,
      missed: {}, missedOrder: [],
      current: null, locked: false, paused: false, over: false,
      elapsed: 0, botClock: 0,
      boss: { index: 0, hp: 0, max: 0, defeated: 0 },
      blitzLeft: BLITZ_SECONDS * 1000,
      lastFrame: 0, bots: [],
      avgWords: bankAverageWords()
    };
    if (id === "fishing") {
      g.profile = g.clean ? freshFishingProfile() : state.gameData.fishing;
      if (!g.clean) g.profile.minutes = setup.minutes;
      g.sessionLeft = setup.minutes * 60000;
      g.fish = { phase: "idle", biteIn: 0, catches: 0, coinsEarned: 0, newSpecies: 0, log: {},
        weather: fishRollWeather(), timeStart: Math.floor(Math.random() * FISH_TIMES.length) };
    }
    if (id === "tycoon") {
      g.profile = g.clean ? freshTycoonProfile() : state.gameData.tycoon;
      g.ty = { sessionProfit: 0, daysRun: 0, shipped: 0 };
      startTycoonDay(true);
    }
    if (id === "boss") newBoss(0);
    var hk = gameHooks(id);
    byId("game-idle-actions").textContent = "";
    byId("game-arena").className = "game-arena";
    byId("game-arena").dataset.biome = "";
    if (hk && hk.begin) hk.begin(g, setup);
    if (g.blitzTheme && g.blitzTheme !== "plain") byId("game-arena").classList.add("blitz-theme-" + g.blitzTheme);
    byId("screen-game").classList.toggle("wide-arena", !!(hk && hk.wide));
    document.body.classList.toggle("wide-game", !!(hk && hk.wide));
    if (g.botsOn) createBots();
    gameQuitTo = hk && hk.quitTo || "games";
    byId("game-keys").textContent = "Keys: 1–4 to answer · T / F for True/False" +
      (info.powerups ? " · Q 50/50 · W Freeze · E Heal" : "") +
      (id === "fishing" ? " · Space to cast" : "") + (hk && hk.keys ? hk.keys : "") + " · P pause";
    byId("game-shop-btn").classList.toggle("hidden", id !== "fishing");
    showScreen("game");
    renderArena(true);
    if (id === "fishing") enterFishingIdle();
    else if (hk && hk.start) hk.start();
    else nextGameQuestion();
    renderGameHud();
    renderBoard();
    g.lastFrame = performance.now();
    g.loop = function step(now) {
      if (!game || game.token !== token || game.over) return; // this run ended
      // Paused or off the game screen: stop scheduling frames until
      // wakeGameLoop() (resume or returning to the game screen).
      if (game.paused || state.screen !== "game") { game.loopIdle = true; return; }
      gameTick(now);
      requestAnimationFrame(step);
    };
    g.loopIdle = false;
    requestAnimationFrame(g.loop);
  }

  function wakeGameLoop() {
    var g = game;
    if (!g || g.over || !g.loopIdle || g.paused || state.screen !== "game") return;
    g.loopIdle = false;
    g.lastFrame = performance.now();
    requestAnimationFrame(g.loop);
  }

  function gameLevel() {
    var g = game;
    if (g.diffMode === "single") return g.singleLevel;
    var step;
    if (g.id === "boss") step = g.campaign ? Math.floor(g.boss.index / 8) : g.boss.index;
    else if (g.id === "survival") step = svHazard("volcano") ? 2 : g.correct < 8 ? 0 : g.correct < 20 ? 1 : 2;
    else if (g.id === "blitz") step = Math.min(2, Math.floor(3 * g.elapsed / ((g.blitzTotal || BLITZ_SECONDS) * 1000)));
    else if (g.id === "tycoon") step = g.profile.day <= 2 ? 0 : g.profile.day <= 5 ? 1 : 2;
    else if (gameHooks() && gameHooks().levelStep) step = gameHooks().levelStep();
    else step = 0;
    return ["easy", "medium", "hard"][Math.min(step, 2)];
  }

