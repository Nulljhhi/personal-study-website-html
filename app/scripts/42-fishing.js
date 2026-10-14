  /* ============================== Fishing ============================== */

  function rollRarity() {
    var bait = game.profile.stats.bait;
    var common = 70 - 4.5 * bait, rare = 25 + 3 * bait, legendary = 5 + 1.5 * bait;
    var w = game.fish && game.fish.weather, t = game.fish && fishTimeNow();
    [w, t].forEach(function (x) { if (x) { common += x.odds.common; rare += x.odds.rare; legendary += x.odds.legendary; } });
    var r = Math.random() * (common + rare + legendary);
    return r < common ? "common" : r < common + rare ? "rare" : "legendary";
  }

  function rarityLevel(rarity) { return rarity === "common" ? "easy" : rarity === "rare" ? "medium" : "hard"; }

  function renderFishingArena(caughtSpecies) {
    var g = game;
    var loc = locationById(g.profile.location);
    var arena = byId("game-arena");
    arena.innerHTML =
      '<p class="arena-name" id="arena-name"></p><p class="arena-sub" id="arena-sub"></p>' +
      '<div id="fish-scene"></div><p class="fish-status" id="fish-status"></p>';
    byId("arena-name").textContent = loc.name;
    renderFishSub();
    renderFishScene(caughtSpecies);
  }

  function renderFishSub() {
    var g = game, sub = byId("arena-sub");
    if (!sub) return;
    var t = fishTimeNow();
    sub.textContent = (g.fish.weather ? g.fish.weather.name + " · " : "") + (t ? t.name + " · " : "") + rodById(g.profile.rod).name + " · fish worth ×" + locationById(g.profile.location).mult;
  }

  function renderFishScene(caught) {
    var g = game;
    var loc = locationById(g.profile.location);
    var scene = byId("fish-scene");
    var status = byId("fish-status");
    if (!scene) return;
    if (caught) {
      scene.innerHTML = '<div class="fish-caught">' + fishSvg(caught.sp[3], caught.sp[2], 220) + '</div>';
      status.textContent = caught.sp[1] + " (" + caught.sp[2] + ")";
      status.className = "fish-status " + caught.sp[2];
      return;
    }
    scene.innerHTML = waterSvg(loc.water, g.fish.phase);
    var tnow = fishTimeNow();
    scene.className = (tnow ? "time-" + tnow.id : "") + (g.fish.weather ? " weather-" + g.fish.weather.id : "");
    renderFishSub();
    status.className = "fish-status";
    status.textContent = g.fish.phase === "idle" ? "Ready to cast" :
      g.fish.phase === "waiting" ? "Waiting for a bite…" :
      (g.profile.rod === "carbon" || g.profile.rod === "pro") ? "A " + g.fish.rarity + " fish is biting!" : "Something's biting!";
  }

  function enterFishingIdle() {
    var g = game;
    g.fish.phase = "idle";
    g.current = null;
    g.locked = false;
    showQuestionPane(false);
    byId("game-idle-title").textContent = "Cast your line";
    byId("game-idle-text").textContent = "Press Cast or the Space bar, then wait for a bite.";
    byId("game-cast-btn").textContent = "Cast";
    byId("game-cast-btn").classList.remove("hidden");
    byId("game-cast-btn").disabled = false;
    renderFishScene();
    renderGameHud();
    if (g.sessionLeft <= 0) endGame(false);
  }

  function castLine() {
    var g = game;
    if (!g || g.over || g.id !== "fishing" || g.fish.phase !== "idle" || g.paused) return;
    g.fish.phase = "waiting";
    var castLevel = g.profile.stats.cast;
    g.fish.biteIn = (1500 + Math.random() * 3500) * (1 - 0.1 * castLevel);
    byId("game-idle-title").textContent = "Waiting for a bite…";
    byId("game-idle-text").textContent = "Get ready. The question appears the moment a fish bites.";
    byId("game-cast-btn").classList.add("hidden");
    renderFishScene();
  }

  function fishTimeNow() {
    var g = game;
    if (!g || !g.fish || g.fish.timeStart === undefined) return null;
    var elapsed = g.setup.minutes * 60000 - g.sessionLeft;
    return FISH_TIMES[(g.fish.timeStart + Math.floor(Math.max(0, elapsed) / FISH_PHASE_MS)) % FISH_TIMES.length];
  }
  function fishCondMet(cond) {
    if (!cond) return true;
    var g = game, t = fishTimeNow();
    if (cond.time && (!t || cond.time.indexOf(t.id) === -1)) return false;
    if (cond.weather && (!g.fish.weather || cond.weather.indexOf(g.fish.weather.id) === -1)) return false;
    return true;
  }
  function fishRollWeather() {
    var total = FISH_WEATHER.reduce(function (a, w) { return a + w.w; }, 0), r = Math.random() * total;
    for (var i = 0; i < FISH_WEATHER.length; i++) { r -= FISH_WEATHER[i].w; if (r <= 0) return FISH_WEATHER[i]; }
    return FISH_WEATHER[0];
  }

  /* -------------------------- Bounty board --------------------------
     Three requested catches a day from places you've unlocked. */
  function fishBounties(p) {
    var today = gardenDay();
    if (p.bounty && p.bounty.day === today) return p.bounty.list;
    var pool = [];
    FISH_LOCATIONS.forEach(function (loc) {
      if (!p.locations[loc.id]) return;
      loc.species.forEach(function (sp) { if (sp[2] !== "legendary") pool.push({ loc: loc, sp: sp }); });
    });
    var picks = seededShuffle(pool, (today * 2654435761) >>> 0).slice(0, 3);
    p.bounty = { day: today, list: picks.map(function (x) {
      var n = x.sp[2] === "rare" ? 1 : 2 + (today + x.sp[3]) % 2;
      return { key: x.loc.id + ":" + x.sp[0], n: n, got: 0, reward: Math.round(speciesValue(x.loc, x.sp) * n * 3 + 50), done: false };
    }) };
    return p.bounty.list;
  }
  function fishSpeciesByKey(key) {
    var parts = key.split(":"), loc = locationById(parts[0]);
    return { loc: loc, sp: loc.species.filter(function (sp) { return sp[0] === parts[1]; })[0] };
  }
  /* A catch counts toward today's bounties; returns a note for the feedback. */
  function fishBountyCatch(p, key, count) {
    var note = "";
    fishBounties(p).forEach(function (b) {
      if (b.done || b.key !== key) return;
      b.got = Math.min(b.n, b.got + count);
      if (b.got >= b.n) {
        b.done = true;
        p.coins += b.reward;
        if (game && game.fish) game.fish.coinsEarned += b.reward;
        gameEvent("bounty");
        note = " Bounty complete: +" + fmtScore(b.reward) + " coins!";
      } else note = " Bounty " + b.got + "/" + b.n + ".";
    });
    return note;
  }

  function fishBite() {
    var g = game;
    var loc = locationById(g.profile.location);
    g.fish.rarity = rollRarity();
    g.fish.locId = loc.id;
    var options = loc.species.filter(function (sp) { return sp[2] === g.fish.rarity && fishCondMet(sp[4]); });
    g.fish.species = options[Math.floor(Math.random() * options.length)];
    g.fish.phase = "bite";
    var level = g.diffMode === "single" ? g.singleLevel : rarityLevel(g.fish.rarity);
    nextGameQuestion(level);
    renderFishScene();
  }

