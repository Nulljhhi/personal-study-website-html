  /* ------------------------------ The clock ------------------------------ */

  /* Real elapsed time, run in steps of at most 250 ms so a slow frame
     can't skip past a timeout or a spawn. A gap longer than 10 s means the
     app was suspended; that pauses the game instead of fast-forwarding it. */
  var GAME_SUBSTEP = 250, GAME_AWAY_MS = 10000;
  function gameTick(now) {
    var g = game;
    var total = Math.max(0, now - g.lastFrame);
    g.lastFrame = now;
    if (state.screen !== "game" || g.paused) return;
    if (total > GAME_AWAY_MS) {
      setGamePaused(true, "Paused", "The game paused while you were away.");
      return;
    }
    // Steps inside one frame only mark the timer and board as changed;
    // they're drawn once at the end of the frame.
    renderDefer = {};
    try {
      while (total > 0 && game === g && !g.over && !g.paused && state.screen === "game") {
        var d = Math.min(GAME_SUBSTEP, total);
        total -= d;
        gameTickStep(d);
        // Waits run after the step, so clocks and timers have had this
        // step's time first. One that finishes (the next question, say)
        // ends the frame: the rest of a long frame belongs to the time
        // before it, not to the new question. Waits stand still with
        // everything else while a minigame is up.
        if (game === g && !g.over && !g.paused && !g.minigame) tickGameWaits(d);
        if (g.waitFired) { g.waitFired = false; break; }
      }
    } finally {
      var due = renderDefer;
      renderDefer = null;
      if (game === g && !g.over) {
        if (due.cars && g.rally && g.rally.phase === "race") rlRenderCars();
        if (due.board) renderBoard();
        if (due.timer) renderGameTimer();
      }
    }
  }

  /* Run fn after ms of game time: it waits while the game is paused, a
     shop is open, a minigame is up or the window is away, the same as the
     question timer. With forTurn, it's dropped once the next question
     comes (for effects on this question, like fog). A finished run's
     waits never fire: they belong to its own game object. */
  function gameAfter(ms, fn, forTurn) {
    var g = game;
    if (!g) return;
    (g.waits || (g.waits = [])).push({ left: ms, fn: fn, turn: forTurn ? g.turn : null });
  }
  function tickGameWaits(dt) {
    var g = game, list = g.waits;
    if (!list || !list.length) return;
    g.waits = [];
    var due = [];
    list.forEach(function (w) {
      if (w.turn !== null && w.turn !== g.turn) return;
      w.left -= dt;
      (w.left > 0 ? g.waits : due).push(w);
    });
    // Run after the list is settled, so a wait that adds another keeps it.
    if (due.length) g.waitFired = true;
    due.forEach(function (w) { if (game === g && !g.over) w.fn(); });
  }

  function gameTickStep(dt) {
    var g = game;
    // A minigame holds everything else still while it's up.
    if (g.minigame) { mgTick(dt); return; }
    if (g.current && g.current.mgAt !== undefined && !g.locked && !g.current.mgDone && g.current.spent >= g.current.mgAt &&
        !byId("game-question-pane").classList.contains("hidden")) {
      g.current.mgDone = true;
      mgStart(g.current.mgLevel);
      return;
    }
    var hkk = gameHooks();
    if (hkk && hkk.tick && hkk.tick(dt)) return;
    if (g.id === "fishing") {
      // The session clock keeps running through waits and feedback.
      g.sessionLeft -= dt;
      g.botClock += dt;
      if (g.fish.phase === "waiting") {
        g.fish.biteIn -= dt;
        if (g.fish.biteIn <= 0) fishBite();
      } else if (g.fish.phase === "bite" && !g.locked && g.current) {
        g.current.spent += dt;
        g.current.remaining -= dt;
        if (g.current.remaining <= 0) { g.current.remaining = 0; resolveGameAnswer(null); }
      }
      if (g.sessionLeft <= 0) {
        g.sessionLeft = 0;
        if (g.fish.phase !== "bite") { renderGameTimer(); endGame(false); return; }
      }
      runBots();
      renderGameTimer();
      return;
    }
    if (g.id === "tycoon" && g.ty && g.ty.dayOpen) {
      // The day clock runs in real time, feedback included.
      g.ty.dayLeft = Math.max(0, g.ty.dayLeft - dt);
      tyRenderClock();
    }
    if (!g.info.perQuestionTimer) {
      // Blitz: the match clock keeps running through answer feedback.
      g.blitzLeft -= dt;
      if (g.blitzLeft <= 0) {
        g.blitzLeft = 0;
        renderGameTimer();
        endGame(false);
        return;
      }
    }
    if (g.locked) {
      // Where the match or day clock keeps running through feedback, the
      // bots keep playing too, so they get the same time you do.
      var clockRuns = !g.info.perQuestionTimer || (g.id === "tycoon" && g.ty && g.ty.dayOpen);
      if (clockRuns) { g.botClock += dt; runBots(); }
      if (!g.info.perQuestionTimer) renderGameTimer();
      return;
    }
    g.elapsed += dt;
    g.botClock += dt;
    if (g.current) g.current.spent += dt;
    if (g.info.perQuestionTimer) {
      if (g.current && !g.current.frozen) {
        g.current.remaining -= dt;
        if (g.current.remaining <= 0) {
          g.current.remaining = 0;
          renderGameTimer();
          resolveGameAnswer(null);
        }
      }
    }
    runBots();
    renderGameTimer();
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && game && !game.over && !game.paused && state.screen === "game") {
      setGamePaused(true, "Paused", "The game paused while the window was hidden.");
    }
  });

  /* An app notice over a running game (another copy was started, a quit
     problem) holds the game still until it's closed, then lets it go on
     as it was: a game that was already paused stays paused. */
  var heldByNotice = null;
  function holdGameFor(modalId) {
    if (heldByNotice || !game || game.over || game.paused || state.screen !== "game") return;
    heldByNotice = modalId;
    setGamePausedQuiet(true);
  }
  function releaseGameFrom(modalId) {
    if (heldByNotice !== modalId) return;
    heldByNotice = null;
    if (game && !game.over && game.paused) setGamePausedQuiet(false);
  }

  function setGamePausedQuiet(paused) {
    if (!game || game.over) return;
    game.paused = paused;
    // Hide the question while a shop is open over it, like the pause menu does.
    byId("screen-game").classList.toggle("game-paused", paused);
    if (!paused) { game.lastFrame = performance.now(); wakeGameLoop(); }
  }

  function setGamePaused(paused, title, hint) {
    if (!game || game.over) return;
    game.paused = paused;
    if (game.id === "tycoon" && game.ty && byId("ty-pu-list")) renderTycoonPowerups();
    var modal = byId("game-pause-modal");
    if (paused) {
      byId("game-pause-title").textContent = title || "Paused";
      byId("game-pause-hint").textContent = hint || "The timer is stopped.";
      modal.classList.remove("hidden");
      byId("screen-game").classList.add("game-paused");
      byId("game-resume-btn").focus();
    } else {
      modal.classList.add("hidden");
      byId("screen-game").classList.remove("game-paused");
      gameQuitTo = gameHooks() && gameHooks().quitTo || "games";
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      game.lastFrame = performance.now();
      wakeGameLoop();
      if (game.id === "tycoon" && game.ty && byId("ty-pu-list")) renderTycoonPowerups();
    }
  }

  /* ------------------------------ Answering ------------------------------ */

  function comboMultiplier(combo) {
    var c = typeof combo === "number" ? combo : game.combo;
    return c >= 10 ? 3 : c >= 5 ? 2 : c >= 3 ? 1.5 : 1;
  }

  /* The one check for whether an answer can be picked right now, shared
     by clicks and every answer key (removed by 50/50, struck by a storm,
     or hidden by fog). */
  function gameChoiceAvailable(slot) {
    var box = byId("game-choices");
    if (game && game.minigame) return false; // answer after the minigame
    if (!box || box.classList.contains("fogged") || box.classList.contains("locked")) return false;
    var b = box.querySelector('button.choice[data-slot="' + slot + '"]');
    return !!b && !b.disabled && !b.classList.contains("removed") && !b.classList.contains("struck");
  }

  /* A hotspot question can be answered unless a minigame is up or the
     answer is already in. */
  function gameHotspotAvailable() {
    var box = byId("game-choices");
    // Fog (Boss Battle's Fog, Deep Delve's Shade) hides the picture too.
    return !!(game && !game.minigame && !game.paused && !game.locked && box &&
      !box.classList.contains("locked") && !box.classList.contains("fogged"));
  }

  function onGameChoiceClick(event) {
    var btn = event.target.closest ? event.target.closest("button.choice") : null;
    if (!btn || !gameChoiceAvailable(btn.dataset.slot)) return;
    resolveGameAnswer(btn.dataset.slot);
  }

  function markGameCompleted(question) {
    // Clean runs save nothing, completions included.
    if (!state.unit || (game && game.clean) || !markCompleted(question)) return;
    persistCompleted();
    renderCompletedMarks(question);
  }

  function awardPowerup() {
    var g = game;
    var total = g.powerups.fifty + g.powerups.freeze + g.powerups.heal;
    if (total >= MAX_POWERUPS) return "";
    var pool = ["freeze"];
    if (g.types.indexOf("mc") !== -1) pool.push("fifty");
    if (g.hearts < maxHearts()) pool.push("heal", "heal");
    var pick = pool[Math.floor(Math.random() * pool.length)];
    g.powerups[pick]++;
    return POWERUP_INFO[pick].label;
  }

  /* slot === null means the timer ran out. */
  function resolveGameAnswer(slot) {
    var g = game;
    if (!g || g.over || g.locked || g.paused || !g.current) return;
    if (byId("game-question-pane").classList.contains("hidden")) return;
    var c = g.current;
    var right = slot !== null && (c.hs ? hotspotAnswerRight(c.q, slot) : slot === c.correctSlot);

    // Fishing: the Pro Rod or line strength can keep a fish after a wrong
    // pick, on multiple choice and hotspot questions. (True/False has only
    // two answers, so a second try would be a sure catch.)
    if (g.id === "fishing" && slot !== null && !right && !c.tf) {
      var lineSave = !c.lineUsed && Math.random() < 0.1 * g.profile.stats.line;
      var keep = c.secondChances > 0 || lineSave;
      var btn = c.hs ? null : document.querySelector('#game-choices button.choice[data-slot="' + slot + '"]');
      if (keep && (c.hs || (btn && !btn.classList.contains("removed")))) {
        if (c.secondChances > 0) c.secondChances--;
        else c.lineUsed = true;
        if (btn) btn.classList.add("removed");
        if (c.hs && c.pad) c.pad.setPick(null); // try again, without showing the spot
        var fb0 = byId("game-feedback");
        fb0.classList.remove("right");
        fb0.classList.add("wrong");
        fb0.textContent = "The line held! Try again before the fish escapes.";
        return;
      }
    }

    g.locked = true;
    g.answered++;
    recordSkill(c, right, slot === null);
    var box = byId("game-choices");
    box.classList.add("locked");
    if (c.hs && c.pad) {
      c.pad.setPick(parseHotspotAnswer(slot));
      c.pad.lock();
      c.pad.reveal();
    }
    var correctText = "";
    box.querySelectorAll("button.choice").forEach(function (b) {
      if (b.dataset.slot === c.correctSlot) {
        b.classList.add("correct-outline");
        correctText = b.lastChild.textContent;
      } else if (b.dataset.slot === slot) {
        b.classList.add("picked-outline", "selected");
      }
    });
    var fb = byId("game-feedback");
    var bossDown = false;
    var extra = "";
    var message;
    if (right) {
      g.combo++;
      g.correct++;
      g.bestStreak = Math.max(g.bestStreak, g.combo);
      var mult = comboMultiplier();
      var speed = g.info.perQuestionTimer ? c.remaining / c.limit
        : Math.max(0, 1 - c.spent / (readingMs(c.words) + BASE_THINK_MS));
      var points;
      if (g.id === "boss") {
        points = Math.round(20 * (1 + 0.5 * speed) * mult * (c.mgBonus || 1));
        var cbNote = "";
        if (g.campaign) { var cbr = cbDamage(points, speed); points = cbr.dmg; cbNote = cbr.note; }
        var shieldHit = g.boss.shields && g.boss.shields.length && points > 0;
        var taken = bossTakeDamage(points);
        cbNote += taken.note;
        floatText(points ? "-" + points + (shieldHit ? " shield" : "") : "Blocked", "dmg-float" + (shieldHit ? " shield" : "") + (mult >= 2 ? " crit" : ""));
        var fig = byId("boss-figure");
        if (g.boss.hp <= 0) {
          bossDown = true;
          g.boss.hp = 0;
          g.boss.defeated++;
          points += 100 * (g.boss.index + 1);
          extra = " " + bossInfo(g.boss.index).name + " defeated!";
          gameEvent("boss");
          if (!g.bossLost) gameEvent("flawless");
          gameEvent("bossreach", { value: g.boss.index + 2 });
          if (fig) { fig.classList.remove("hit"); fig.classList.add("dead"); }
        } else if (fig) {
          fig.classList.remove("hit"); void fig.getBoundingClientRect(); fig.classList.add("hit");
        }
        renderBossHp();
        message = "Correct! +" + fmtScore(points) + extra + cbNote;
      } else if (g.id === "survival") {
        points = Math.round(10 * (1 + speed) * mult);
        message = "Correct! +" + fmtScore(points);
      } else if (g.id === "blitz") {
        // Longer questions are worth more, so long-question banks score fairly.
        var weight = clamp(c.words / g.avgWords, 0.5, 2);
        points = Math.round(10 * (1 + 0.5 * speed) * mult * weight);
        message = "Correct! +" + fmtScore(points);
      } else if (gameHooks()) {
        var hres = gameHooks().correct(c, speed, mult);
        points = hres.points;
        message = hres.message;
      } else if (g.id === "fishing") {
        var loc = locationById(g.fish.locId || g.profile.location); // where the fish bit
        var sp = g.fish.species;
        var diffBonus = g.diffMode === "single" ? ({ easy: 1, medium: 1.5, hard: 2 })[g.singleLevel] : 1;
        var luck = 1 + 0.08 * g.profile.stats.luck + (g.profile.rod === "carbon" ? 0.1 : 0);
        var count = g.profile.rod === "fiberglass" && Math.random() < 0.1 ? 2 : 1;
        points = Math.round(speciesValue(loc, sp) * diffBonus * luck * mult * g.rewardMult) * count;
        if (sp[2] !== "common") gameEvent("rarefish", { n: count });
        if (sp[2] === "legendary") gameEvent("legendfish", { n: count });
        var key = loc.id + ":" + sp[0];
        if (!g.profile.caught[key]) { g.fish.newSpecies++; extra = " New species!"; }
        g.profile.caught[key] = (g.profile.caught[key] || 0) + count;
        extra += fishBountyCatch(g.profile, key, count);
        g.fish.log[sp[1]] = (g.fish.log[sp[1]] || 0) + count;
        g.profile.coins += points;
        g.fish.coinsEarned += points;
        g.fish.catches += count;
        if (!g.clean) persistCompleted();
        renderFishScene({ sp: sp });
        message = (count === 2 ? "Double catch! 2 × " : "Caught a ") + sp[1] + "! +" + fmtScore(points) + " coins." + extra;
      } else {
        var order = g.ty.order;
        var boost = g.ty.active;
        points = Math.round(order.value * tycoonMultiplier() * boost.mult * tyTrucks(g.profile) * (g.profile.staff.manager ? 1.1 : 1) * g.rewardMult);
        gameEvent("ship");
        gameEvent("crate", { value: boost.mult });
        g.ty.dayCorrect++;
        // Counted for the contract when the day closes, so a day that's
        // thrown away (quitting mid-day) doesn't count towards it.
        if (g.profile.contract) { tyDayContract(g).shipped++; tyDayContract(g).correct++; }
        g.ty.dayRevenue += points;
        g.ty.dayShipped++;
        g.ty.shipped++;
        floatText("+" + fmtMoney(points), "dmg-float money");
        message = (boost.mult > 1 ? "×" + fmtScore(boost.mult) + " crate shipped! +" : "Shipped! +") + fmtMoney(points);
      }
      if (g.id === "boss" || g.id === "survival" || g.id === "blitz") {
        points = Math.round(points * g.rewardMult);
        g.score += points;
      }
      addXp(xpForCorrect(g.combo));
      gameEvent("correct");
      gameEvent("streak", { value: g.combo });
      if (g.info.perQuestionTimer && c.remaining / c.limit > 0.5) gameEvent("fast");
      if (g.id === "fishing") g.score = g.fish.coinsEarned;
      if (g.info.powerups) {
        g.streakSinceReward++;
        var every = g.survival && g.survival.perks.lucky ? 4 : (g.modifier && g.modifier.powerupEvery) || 5;
        if (svHazard("swamp")) g.streakSinceReward = 0; // the swamp swallows power-ups
        if (g.streakSinceReward >= every) {
          g.streakSinceReward = 0;
          var earned = awardPowerup();
          if (earned) message += " " + earned + " earned!";
        }
      }
      if (!(gameHooks() && gameHooks().noComplete)) markGameCompleted(c.q);
      if (g.survival) svAfterCorrect();
      flashScreen("good");
      fb.classList.add("right");
      fb.textContent = message;
    } else {
      var comboBefore = g.combo;
      g.combo = 0;
      g.streakSinceReward = 0;
      var mkey = completedKey(c.q);
      if (!g.missed[mkey]) { g.missed[mkey] = c.q; g.missedOrder.push(c.q); }
      if (!g.queue.some(function (item) { return item.q.id === c.q.id; })) {
        g.queue.push({ q: c.q, due: g.turn + 3 + Math.floor(Math.random() * 3) });
      }
      if (g.info.hearts) {
        var heartsBefore = g.hearts;
        g.hearts = Math.max(0, g.hearts - 1);
        // Hearts actually lost to this boss (healing doesn't undo them).
        g.bossLost = (g.bossLost || 0) + (heartsBefore - g.hearts);
      }
      var windNote = "";
      if (g.survival && g.hearts <= 0 && g.survival.perks.secondwind && !g.survival.windUsed) {
        g.survival.windUsed = true;
        g.hearts = 1;
        windNote = "Second wind keeps you going! ";
      }
      if (g.id === "blitz" && g.blitzVariant === "sudden") g.suddenOut = true;
      if (g.id === "blitz") {
        g.blitzLeft = Math.max(0, g.blitzLeft - BLITZ_PENALTY_MS);
        floatText("−3s", "arena-penalty");
      }
      var lead = (slot === null ? "Time's up! " : "Not quite. ") + windNote;
      if (g.id === "fishing") {
        lead = slot === null ? "The fish got away! " : "The fish slipped off! ";
        byId("fish-status").textContent = "It got away…";
      }
      if (g.id === "tycoon") {
        var ta = g.ty.active, to = g.ty.order, tprof = g.profile;
        var late = slot === null;
        var penalty = Math.round(tyInsuredShare(ta) * to.value * (late ? 0.15 : 0.3) * to.line.penalty *
          tyPenaltyScale(tprof, ta, comboBefore) * (late && tprof.staff.driver ? 0.5 : 1));
        g.ty.dayPenalties += penalty;
        if (late) g.ty.dayLate++; else g.ty.dayReturned++;
        if (ta.guard) g.combo = comboBefore;
        floatText("-" + fmtMoney(penalty), "arena-penalty");
        lead = (late ? "Too slow, the order shipped late (-" : "Wrong item, it came back (-") + fmtMoney(penalty) + ")" +
          (ta.insurance ? (penalty ? ", partly covered by insurance" : ", covered by insurance") : "") + (ta.guard ? ". Streak guarded" : "") + ". ";
      }
      if (gameHooks() && gameHooks().wrong) lead = gameHooks().wrong(slot === null) || lead;
      if (g.campaign) { var cmiss = cbMiss(); if (cmiss) lead += cmiss + " "; }
      if (g.id === "boss") { var rech = bossShieldRecharge(); if (rech) lead += rech + " "; renderBossHp(); }
      flashScreen("miss");
      fb.classList.add("wrong");
      fb.textContent = lead + (c.hs ? "The right spot is circled." + (c.q.answer ? " (" + c.q.answer + ")" : "") : missExplanation(c.q, c.tf, c.data, correctText));
    }
    if (g.campaign && !bossDown) {
      cbAfterQuestion();
      renderBossHp();
      byId("arena-sub").textContent = cbStatusText();
    }
    if (g.id === "survival") renderSurvivalArena();
    if (g.id === "blitz") renderBlitzArena();
    if (g.id === "tycoon") {
      g.ty.dayAnswered++;
      if (g.profile.contract) tyDayContract(g).answered++;
      renderTycoonPowerups();
    }
    renderGameHud();
    renderBoard();
    var wait = g.id === "blitz" ? BLITZ_FEEDBACK_MS : GAME_FEEDBACK_MS;
    if (bossDown) wait += 500;
    if (g.id === "fishing") wait += 400;
    // Feedback time only counts while the game runs.
    gameAfter(wait, function () { afterGameFeedback(bossDown); });
  }

  function afterGameFeedback(bossDown) {
    var g = game;
    if (g.info.hearts && g.hearts <= 0) { endGame(false); return; }
    if (g.id === "blitz" && (g.blitzLeft <= 0 || g.suddenOut)) { endGame(false); return; }
    if (g.id === "fishing") {
      if (g.sessionLeft <= 0) { endGame(false); return; }
      enterFishingIdle();
      return;
    }
    if (gameHooks() && gameHooks().afterFeedback && gameHooks().afterFeedback()) return;
    if (g.id === "tycoon") {
      if (g.ty.dayLeft <= 0) { endTycoonDay(); return; }
      newOrder();
      renderTycoonArena();
    }
    if (bossDown && g.campaign) {
      if (cbBossDefeated()) { endGame(false); return; }
      cbStartBoss(g.boss.index + 1);
      renderArena(true);
    } else if (bossDown) {
      newBoss(g.boss.index + 1);
      renderArena(true);
    } else if (g.id === "boss") {
      byId("arena-sub").textContent = g.campaign ? cbStatusText() : "Boss " + (g.boss.index + 1) + " · " + LEVEL_NAMES[gameLevel()];
    }
    nextGameQuestion();
    game.lastFrame = performance.now();
  }

  /* ------------------------------ Power-ups ------------------------------ */

  function canUsePowerup(name) {
    var g = game;
    if (!g || !g.info.powerups || g.over || g.locked || !g.current || g.powerups[name] <= 0) return false;
    if (svHazard("blizzard")) return false;
    if (name === "fifty") return !g.current.tf && !g.current.hs && !g.current.fiftyUsed;
    if (name === "freeze") return !g.current.frozen;
    return g.hearts < maxHearts();
  }

  function usePowerup(name) {
    var g = game;
    if (!canUsePowerup(name) || g.paused) return;
    g.powerups[name]--;
    gameEvent("powerup");
    var c = g.current;
    if (name === "fifty") {
      c.fiftyUsed = true;
      var wrong = ["a", "b", "c", "d"].filter(function (s) { return s !== c.correctSlot; });
      seededShuffle(wrong, (Date.now() >>> 0)).slice(0, 2).forEach(function (s) {
        var b = document.querySelector('#game-choices button.choice[data-slot="' + s + '"]');
        if (b) b.classList.add("removed");
      });
    } else if (name === "freeze") {
      c.frozen = true;
    } else {
      g.hearts = Math.min(maxHearts(), g.hearts + 1);
    }
    renderGameHud();
  }

  /* ------------------------------ Ending ------------------------------ */

  function endGame(quit) {
    var g = game;
    if (!g || g.over) return;
    g.over = true;
    document.body.classList.remove("board-on");
    clearGameFog();
    mgClear();
    g.paused = false;
    byId("game-pause-modal").classList.add("hidden");
    byId("fish-shop-modal").classList.add("hidden");
    byId("screen-game").classList.remove("game-paused");
    if (quit) {
      var hkq = gameHooks(g.id);
      if (hkq && hkq.quit) hkq.quit(g);
      if (!g.clean) persistCompleted();
      // Fishing/Tycoon progress already earned stays saved (it's saved as
      // it happens); a quit just doesn't count as a finished run.
      showScreen(gameQuitTo);
      if (gameQuitTo === "games") renderGamesPage();
      return;
    }
    // Run-end events and XP (normal runs only; gameEvent/addXp skip clean runs).
    var accPct = g.answered ? Math.round(100 * g.correct / g.answered) : 0;
    gameEvent("run");
    if (g.answered >= 10) gameEvent("runacc", { value: accPct });
    if (g.id === "survival") gameEvent("survivebest", { value: g.correct });
    if (g.id === "blitz") {
      gameEvent("blitzscore", { value: g.score });
      if (g.answered >= 8 && g.correct === g.answered) gameEvent("blitzclean");
    }
    if (g.id === "fishing") gameEvent("coins", { value: g.fish.coinsEarned });
    // Bots finish first, so hooks (the Blitz league) and the results screen
    // read one set of final standings.
    var standing = g.botsOn ? settleBots() : null;
    // Without bots the rating still learns from the run, ready for next time.
    if (!standing && !g.info.noProgress && !g.skillSettled) g.skillSettled = settleSkill(g);
    g.standing = standing;
    settleRivals(g);
    onGameEnded(g);
    addXp(25, true);
    var key = scoreKey(g.id, g.diffMode, g.singleLevel, g.blitzVariant);
    var best = state.highScores[key];
    var newBest = !g.clean && !g.campaign && g.score > 0 && (best === undefined || g.score > best);
    if (newBest) state.highScores[key] = g.score;
    if (!g.clean) persistCompleted();

    var titles = { blitz: ": time's up!", fishing: ": session over", tycoon: ": warehouse closed for now" };
    var hke = gameHooks(g.id);
    byId("game-results-title").textContent = g.info.name + (hke && hke.resultTitle ? hke.resultTitle(g) : titles[g.id] || ": game over");
    byId("game-results-best").classList.toggle("hidden", !newBest);
    var xpEl = byId("game-results-xp");
    xpEl.classList.toggle("hidden", g.clean);
    if (!g.clean) xpEl.textContent = "+" + fmtScore(g.xpEarned) + " XP \u00b7 " + g.info.name + " level " + playerLevel(g.id);
    var placeEl = byId("game-results-place");
    placeEl.classList.toggle("hidden", !standing);
    if (standing) {
      var ord = ["1st", "2nd", "3rd", "4th"][standing.place - 1];
      placeEl.textContent = "You finished " + ord + " of 4." + (standing.changed
        ? " Rating " + standing.before + " → " + standing.after + " (" + (standing.after >= standing.before ? "+" : "") + (standing.after - standing.before) + ")" +
          (standing.acc !== null && standing.acc !== undefined ? ": " + Math.round(100 * standing.acc) + "% right, using about " + Math.round(100 * standing.pace) + "% of each question's read-and-think time." : ".")
        : g.clean ? " Clean run, so your rating didn't change." : " Too few answers to update your rating.");
      if (g.leagueNote) placeEl.textContent += " " + g.leagueNote;
    }
    var stats = byId("game-results-stats");
    stats.textContent = "";
    var rows;
    if (hke && hke.resultRows) {
      rows = hke.resultRows(g);
    } else if (g.id === "fishing") {
      rows = [["Coins earned", fmtScore(g.fish.coinsEarned)], ["Fish caught", String(g.fish.catches)],
        ["New species", String(g.fish.newSpecies)], ["Accuracy", g.answered ? Math.round(100 * g.correct / g.answered) + "%" : "—"]];
    } else if (g.id === "tycoon") {
      rows = [["Session profit", fmtMoney(g.ty.sessionProfit)], ["Days run", String(g.ty.daysRun)],
        ["Orders shipped", String(g.ty.shipped)], ["Accuracy", g.answered ? Math.round(100 * g.correct / g.answered) + "%" : "—"]];
    } else {
      rows = [["Score", fmtScore(g.score)]];
      if (g.id === "boss") rows.push(["Bosses beaten", String(g.boss.defeated)]);
      else rows.push(["Correct answers", String(g.correct)]);
      rows.push(["Best streak", String(g.bestStreak)]);
      rows.push(["Accuracy", g.answered ? Math.round(100 * g.correct / g.answered) + "%" : "—"]);
    }
    rows.forEach(function (r) {
      var box = document.createElement("div");
      box.className = "stat-box";
      var label = document.createElement("span");
      label.className = "stat-label";
      label.textContent = r[0];
      var value = document.createElement("strong");
      value.textContent = r[1];
      box.appendChild(label);
      box.appendChild(value);
      stats.appendChild(box);
    });
    var board = byId("game-results-board");
    board.classList.toggle("hidden", !g.botsOn);
    if (g.botsOn) renderBoard(board, "Final standings");
    var catchList = byId("game-results-catch");
    catchList.classList.toggle("hidden", g.id !== "fishing" || !g.fish.catches);
    if (g.id === "fishing") {
      catchList.textContent = "Your catch: " + Object.keys(g.fish.log).map(function (n) { return n + " ×" + g.fish.log[n]; }).join(", ");
    }
    var list = byId("game-missed");
    forgetNearView(list);
    list.textContent = "";
    byId("game-missed-heading").textContent = g.missedOrder.length ? "Questions to review" : (g.answered ? "No misses. Nice work!" : "");
    g.missedOrder.forEach(function (q) {
      var pair = document.createElement("div");
      pair.className = "qa-pair";
      var qq = document.createElement("div");
      qq.className = "qa-q";
      qq.textContent = q.question;
      var a = document.createElement("div");
      a.className = "qa-a";
      if (q.hotspot) a.appendChild(hotspotAnswerView(q, true));
      else a.textContent = q.answer;
      if (q.image && !q.hotspot) qq.appendChild(questionImage(q, "qa-img", true));
      pair.appendChild(qq);
      pair.appendChild(a);
      list.appendChild(pair);
    });
    showScreen("game-results");
  }

