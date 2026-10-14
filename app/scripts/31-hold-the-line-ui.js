  /* ------------------------- Hold the Line: profile ------------------------- */

  function freshTdProfile() {
    return { stars: {}, cleared: {}, seen: {}, endlessBest: 0, run: null, lastMap: "m1", lastTier: "normal" };
  }
  function tdSnapshot(run) {
    return { mapId: run.mapId, tier: run.tier, layout: run.layout, wave: run.wave, lives: run.lives, maxLives: run.maxLives,
      gold: run.gold, kills: run.kills, leaked: run.leaked,
      towers: run.towers.map(function (t) { return { slot: t.slot, type: t.type, a: t.a, b: t.b, spent: t.spent }; }) };
  }
  function parseTdProfile(src) {
    var p = freshTdProfile();
    if (!src || typeof src !== "object") return p;
    var num = function (v, d) { return typeof v === "number" && isFinite(v) ? v : d; };
    var ids = TD_MAPS.map(function (m) { return m.id; });
    if (src.stars && typeof src.stars === "object") ids.forEach(function (id) { var s = Math.floor(num(src.stars[id], 0)); if (s > 0) p.stars[id] = clamp(s, 1, 3); });
    if (src.cleared && typeof src.cleared === "object") Object.keys(src.cleared).forEach(function (k) {
      if (src.cleared[k] !== true) return;
      var parts = k.split(":");
      if ((ids.indexOf(parts[0]) !== -1 && hasOwn(TD_TIERS, parts[1])) || TD_CHALLENGES.some(function (c) { return c.id === k; })) p.cleared[k] = true;
    });
    if (src.seen && typeof src.seen === "object") Object.keys(TD_ENEMIES).forEach(function (k) { if (src.seen[k] === true) p.seen[k] = true; });
    p.endlessBest = Math.max(0, Math.floor(num(src.endlessBest, 0)));
    if (tdMapDef(src.lastMap)) p.lastMap = src.lastMap;
    if (hasOwn(TD_TIERS, src.lastTier)) p.lastTier = src.lastTier;
    var r = src.run;
    if (r && typeof r === "object" && tdMapDef(r.mapId) && hasOwn(TD_TIERS, r.tier) && TD_MAPS.some(function (m) { return m.id === r.layout; })) {
      var slots = tdLayout(r.layout).slots.length;
      var seenSlot = {};
      var towers = Array.isArray(r.towers) ? r.towers.filter(function (t) {
        if (!t || !Object.prototype.hasOwnProperty.call(TD_TOWERS, t.type) || !Number.isInteger(t.slot) || t.slot < 0 || t.slot >= slots || seenSlot[t.slot]) return false;
        seenSlot[t.slot] = true;
        return true;
      }).map(function (t) {
        var a = clamp(Math.floor(num(t.a, 0)), 0, 5), b = clamp(Math.floor(num(t.b, 0)), 0, 5);
        if (a > 2 && b > 2) b = 2;
        return { slot: t.slot, type: t.type, a: a, b: b, spent: Math.max(0, Math.round(num(t.spent, TD_TOWERS[t.type].cost))) };
      }) : [];
      var lives = Math.floor(num(r.lives, 0)), maxLives = Math.floor(num(r.maxLives, 20));
      if (lives > 0 && maxLives >= lives) {
        p.run = { mapId: r.mapId, tier: r.tier, layout: r.layout, wave: Math.max(0, Math.floor(num(r.wave, 0))), lives: lives, maxLives: maxLives,
          gold: Math.max(0, Math.round(num(r.gold, 0))), kills: Math.max(0, Math.floor(num(r.kills, 0))), leaked: Math.max(0, Math.floor(num(r.leaked, 0))), towers: towers };
      }
    }
    return p;
  }

  /* ------------------------- Hold the Line: unlocks ------------------------- */

  function tdTotalStars(p) { return Object.keys(p.stars).reduce(function (s, k) { return s + p.stars[k]; }, 0); }
  function tdRegionMaps(r) { return TD_MAPS.filter(function (m) { return m.region === r; }); }
  function tdRegionUnlocked(p, r) {
    if (r === 0) return true;
    var prev = tdRegionMaps(r - 1);
    return !!p.cleared[prev[prev.length - 1].id + ":normal"] && tdTotalStars(p) >= TD_REGIONS[r].stars;
  }
  /* Returns "" when playable, otherwise why not. */
  function tdLockReason(p, mapId, tier) {
    var def = tdMapDef(mapId);
    if (!def) return "Unknown map";
    if (def.kind === "endless") return TD_MAPS.slice(0, 3).every(function (m) { return p.cleared[m.id + ":normal"]; }) ? "" : "Clear every Meadow map to unlock Endless";
    if (!tdRegionUnlocked(p, def.region)) {
      return def.region > 0 && tdTotalStars(p) < TD_REGIONS[def.region].stars
        ? "Needs " + TD_REGIONS[def.region].stars + " stars and the last " + TD_REGIONS[def.region - 1].name + " map"
        : "Clear the last " + TD_REGIONS[def.region - 1].name + " map first";
    }
    var maps = tdRegionMaps(def.region);
    if (def.kind === "challenge") return maps.every(function (m) { return p.cleared[m.id + ":normal"]; }) ? "" : "Clear every " + TD_REGIONS[def.region].name + " map to unlock";
    var idx = maps.map(function (m) { return m.id; }).indexOf(mapId);
    if (idx > 0 && !p.cleared[maps[idx - 1].id + ":normal"]) return "Clear " + maps[idx - 1].name + " first";
    if (tier === "hard" && p.stars[mapId] !== 3) return "Earn 3 stars on Normal";
    if (tier === "nightmare" && !maps.every(function (m) { return p.cleared[m.id + ":hard"]; })) return "Clear every " + TD_REGIONS[def.region].name + " map on Hard";
    return "";
  }
  function tdUnlockedList(p) {
    var out = [];
    TD_MAPS.forEach(function (m) { ["normal", "hard", "nightmare"].forEach(function (t) { if (!tdLockReason(p, m.id, t)) out.push(m.name + (t === "normal" ? "" : " (" + TD_TIERS[t].name + ")")); }); });
    TD_CHALLENGES.forEach(function (c) { if (!tdLockReason(p, c.id)) out.push("Challenge: " + c.name); });
    if (!tdLockReason(p, "endless")) out.push("Endless mode");
    return out;
  }
  function tdStarText(n) { return "★★★".slice(0, n) + "☆☆☆".slice(0, 3 - n); }

  /* ------------------------- Hold the Line: setup ------------------------- */

  function tdFillSetup() {
    var p = state.gameData.td;
    var sel = byId("td-map");
    sel.textContent = "";
    var add = function (parent, value, label, disabled) {
      var o = document.createElement("option");
      o.value = value; o.textContent = label; o.disabled = !!disabled;
      parent.appendChild(o);
      return o;
    };
    if (p.run) {
      var rd = tdMapDef(p.run.mapId);
      add(sel, "resume", "Continue: " + rd.name + (rd.kind === "map" ? " (" + TD_TIERS[p.run.tier].name + ")" : "") + ", wave " + (p.run.wave + 1));
    }
    TD_REGIONS.forEach(function (reg, r) {
      var group = document.createElement("optgroup");
      group.label = reg.name + (tdRegionUnlocked(p, r) ? "" : " (locked)");
      tdRegionMaps(r).forEach(function (m) {
        var why = tdLockReason(p, m.id, "normal");
        add(group, m.id, m.name + (p.stars[m.id] ? "  " + tdStarText(p.stars[m.id]) : "") + (why ? " (locked)" : ""), !!why);
      });
      var ch = TD_CHALLENGES[r];
      var cw = tdLockReason(p, ch.id);
      add(group, ch.id, "Challenge: " + ch.name + (p.cleared[ch.id] ? " ✓" : "") + (cw ? " (locked)" : ""), !!cw);
      sel.appendChild(group);
    });
    var ew = tdLockReason(p, "endless");
    add(sel, "endless", "Endless" + (p.endlessBest ? " (best: " + p.endlessBest + " waves)" : "") + (ew ? " (locked)" : ""), !!ew);
    var want = p.run ? "resume" : p.lastMap;
    if (!sel.querySelector('option[value="' + want + '"]:not([disabled])')) want = "m1";
    sel.value = want;
    tdSyncTier();
  }

  function tdSyncTier() {
    var p = state.gameData.td;
    var mapId = byId("td-map").value;
    var tierSel = byId("td-tier");
    var def = tdMapDef(mapId);
    var isMap = def && def.kind === "map";
    byId("td-tier-row").classList.toggle("hidden", !isMap);
    if (isMap) {
      Array.prototype.forEach.call(tierSel.options, function (o) {
        var why = tdLockReason(p, mapId, o.value);
        o.disabled = !!why;
        o.textContent = TD_TIERS[o.value].name + " (" + TD_TIERS[o.value].waves + " waves)" + (p.cleared[mapId + ":" + o.value] ? " ✓" : "") + (why ? " — " + why : "");
      });
      if (tierSel.selectedOptions[0] && tierSel.selectedOptions[0].disabled) tierSel.value = "normal";
    }
    var info = [];
    if (mapId === "resume" && p.run) {
      info.push("Picks up at the start of wave " + (p.run.wave + 1) + " with " + p.run.lives + " lives, " + p.run.gold + " gold and " + p.run.towers.length + " towers.");
    } else if (def && def.kind === "map") {
      info.push(TD_REGIONS[def.region].name + " · " + (p.stars[mapId] ? tdStarText(p.stars[mapId]) + " on Normal" : "not cleared yet"));
      info.push("Stars: 3 for keeping 85% of your lives, 2 for half.");
    } else if (def && def.kind === "challenge") {
      info.push(def.rules.desc);
    } else if (def) {
      info.push("Waves keep coming and get tougher, with a boss every 10. Your score is waves survived.");
    }
    byId("td-map-info").textContent = info.join(" ");
  }

  /* --------------------------- Hold the Line: run --------------------------- */

  function tdRestoreRun(snap, level) {
    var run = tdNewRun({ mapId: snap.mapId, tier: snap.tier, layout: snap.layout, level: level });
    run.wave = snap.wave; run.lives = snap.lives; run.maxLives = snap.maxLives; run.gold = snap.gold;
    run.kills = snap.kills; run.leaked = snap.leaked;
    run.towers = snap.towers.map(function (t) { return { slot: t.slot, type: t.type, a: t.a, b: t.b, spent: t.spent, charge: false }; });
    return run;
  }

  function tdGame() { return game && game.id === "td" ? game.td : null; }

  function tdSaveRun() {
    var g = game;
    g.profile.run = tdSnapshot(g.td.run);
    persistCompleted();
  }

  function tdEnterBuild() {
    var g = game, td = g.td, run = td.run;
    td.phase = "build";
    g.current = null;
    g.locked = true;
    showQuestionPane(false);
    var total = tdWaveCount(run);
    var next = run.wave + 1;
    byId("game-idle-title").textContent = run.wave === 0 ? "Build your defense" : "Wave " + run.wave + " cleared!";
    var plan = tdWavePlan(run, next);
    var counts = {};
    plan.forEach(function (k) { counts[k] = (counts[k] || 0) + 1; });
    var parts = Object.keys(counts).map(function (k) {
      var e = TD_ENEMIES[k];
      return counts[k] + " × " + e.name + (g.profile.seen[k] ? "" : " (new!)");
    });
    byId("game-idle-text").textContent = "Next: wave " + next + (total === Infinity ? "" : " of " + total) +
      (tdIsBossWave(run, next) ? " (boss wave)" : "") + " · " + parts.join(", ") +
      ". Click a slot on the map to build or upgrade, then start the wave.";
    var btn = byId("game-cast-btn");
    btn.textContent = "Start wave " + next;
    btn.classList.remove("hidden");
    btn.disabled = false;
    tdRender();
    renderGameHud();
    renderGameTimer();
  }

  function tdStartNextWave() {
    var g = game, td = g.td;
    if (!td || td.phase !== "build" || g.paused || g.over) return;
    g.profile.run = tdSnapshot(td.run); // towers built this phase are part of the save
    persistCompleted();
    var plan = tdStartWave(td.run);
    var fresh = [];
    plan.forEach(function (k) { if (!g.profile.seen[k] && fresh.indexOf(k) === -1) fresh.push(k); });
    fresh.forEach(function (k) {
      g.profile.seen[k] = true;
      notify("New enemy: " + TD_ENEMIES[k].name + ". " + TD_ENEMIES[k].desc);
    });
    if (td.run.tier === "nightmare") TD_NIGHTMARE_MODS.forEach(function (m) {
      if (m.from === td.run.wave) notify("Nightmare: " + m.name + ". " + m.desc);
    });
    td.phase = "wave";
    byId("game-cast-btn").classList.add("hidden");
    g.locked = false;
    tdRender();
    nextGameQuestion();
    g.lastFrame = performance.now();
  }

  function tdPositions(run) {
    var out = {};
    run.enemies.forEach(function (e) { if (e.alive && e.d >= 0) out[e.id] = tdPos(run, e); });
    return out;
  }

  /* Lives lost count straight away in the save, so closing the app can't undo them. */
  function tdSaveLives() {
    var g = game, run = g.td.run, p = g.profile;
    if (!p.run) return;
    if (run.lives <= 0) p.run = null;
    else if (run.lives < p.run.lives) { p.run.lives = run.lives; p.run.leaked = Math.max(p.run.leaked || 0, run.leaked); }
    else return;
    persistCompleted();
  }

  function tdCorrect(c, speed, mult) {
    var g = game, run = g.td.run;
    var goldBefore = run.gold, killsBefore = run.kills, livesBefore = run.lives;
    var before = tdPositions(run);
    var fx = tdVolley(run, (1 + 0.5 * speed) * mult);
    fx = fx.concat(tdMove(run, 1));
    tdRender(fx, before);
    var kills = run.kills - killsBefore, gold = run.gold - goldBefore, lost = livesBefore - run.lives;
    if (lost) tdSaveLives();
    var hits = fx.filter(function (f) { return f.kind === "shot" || f.kind === "blast" || f.kind === "zap" || f.kind === "aura"; }).length;
    if (gold > 0) floatText("+" + gold + " gold", "dmg-float money");
    var msg = hits ? "Fire!" : "Correct, but nothing was in range.";
    if (kills) msg += " " + kills + (kills === 1 ? " enemy" : " enemies") + " down, +" + gold + " gold.";
    if (lost) msg += " " + lost + (lost === 1 ? " life" : " lives") + " lost.";
    return { points: 0, message: msg };
  }

  function tdWrong(late) {
    var g = game, run = g.td.run;
    var livesBefore = run.lives;
    var fx = tdMove(run, 2);
    tdRender(fx);
    var lost = livesBefore - run.lives;
    if (lost) tdSaveLives();
    return (late ? "Too slow! " : "Missed! ") + "The enemies surge forward" + (lost ? " and " + lost + (lost === 1 ? " life is" : " lives are") + " lost" : "") + ". ";
  }

  /* After the feedback pause. Returns true when it took over the flow. */
  function tdAfterFeedback() {
    var g = game, td = g.td, run = td.run;
    if (run.lives <= 0) { tdFinish(false); return true; }
    if (tdWaveOver(run)) {
      var bonus = tdWaveBonus(run);
      run.gold += bonus;
      gameEvent("wave");
      notify("Wave " + run.wave + " cleared! +" + bonus + " gold.");
      if (run.wave >= tdWaveCount(run)) { tdFinish(true); return true; }
      tdSaveRun();
      tdEnterBuild();
      return true;
    }
    return false;
  }

  function tdFinish(won) {
    var g = game, run = g.td.run, p = g.profile;
    var beforeUnlocks = tdUnlockedList(p);
    var cleared = won ? run.wave : run.wave - 1;
    var stars = won ? tdStars(run) : 0;
    g.td.result = { won: won, stars: stars, cleared: Math.max(0, cleared) };
    if (run.kind === "endless") {
      p.endlessBest = Math.max(p.endlessBest, Math.max(0, cleared));
      g.score = Math.max(0, cleared);
    } else if (won) {
      if (run.kind === "map") {
        p.cleared[run.mapId + ":" + run.tier] = true;
        if (run.tier === "normal") p.stars[run.mapId] = Math.max(p.stars[run.mapId] || 0, stars);
      } else {
        if (!p.cleared[run.mapId]) addXp(300, true);
        p.cleared[run.mapId] = true;
      }
      if (run.leaked === 0) gameEvent("perfectmap");
    }
    p.run = null;
    var gained = tdUnlockedList(p).filter(function (x) { return beforeUnlocks.indexOf(x) === -1; });
    gained.forEach(function (x) { notify("Unlocked: " + x + "!"); });
    checkAchievements("td");
    endGame(false);
  }

  /* ------------------------- Hold the Line: drawing ------------------------- */

  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function tdRenderArena() {
    var g = game, run = g.td.run;
    var lay = tdLayout(run.layout);
    var reg = TD_REGIONS[lay.map.region];
    var def = tdMapDef(run.mapId);
    var arena = byId("game-arena");
    arena.innerHTML = '<p class="arena-name" id="td-name"></p><p class="arena-sub" id="td-sub"></p>' +
      '<div class="td-map-wrap"></div><div id="td-panel" class="td-panel"></div>';
    byId("td-name").textContent = def.kind === "endless" ? "Endless · " + lay.map.name : def.name;
    byId("td-sub").textContent = def.kind === "map" ? reg.name + " · " + TD_TIERS[run.tier].name : def.kind === "challenge" ? "Challenge · " + def.rules.desc : "Waves survived counts";
    var svg = svgEl("svg", { viewBox: "0 0 " + TD_W + " " + TD_H, class: "td-map", role: "img", "aria-label": "Map" });
    svg.appendChild(svgEl("rect", { width: TD_W, height: TD_H, fill: reg.ground, rx: 2 }));
    var pts = lay.route.pts.map(function (p) { return p[0] + "," + p[1]; }).join(" ");
    svg.appendChild(svgEl("polyline", { points: pts, fill: "none", stroke: reg.accent, "stroke-width": 7.4, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: 0.5 }));
    svg.appendChild(svgEl("polyline", { points: pts, fill: "none", stroke: reg.road, "stroke-width": 6, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    var end = lay.route.pts[lay.route.pts.length - 1];
    var base = svgEl("g", { transform: "translate(" + clamp(end[0], 4, 96) + " " + clamp(end[1], 4, 56) + ")" });
    base.appendChild(svgEl("rect", { x: -3.5, y: -3.5, width: 7, height: 7, rx: 1, fill: "#2f3e46", stroke: "#fff", "stroke-width": 0.6 }));
    base.appendChild(svgEl("path", { d: "M-3.5 -3.5 v-1.5 h1.5 v1 h1.25 v-1 h1.5 v1 h1.25 v-1 h1.5 v1.5 z", fill: "#2f3e46" }));
    svg.appendChild(base);
    var slots = svgEl("g", { id: "td-slots" });
    lay.slots.forEach(function (s, i) {
      var gEl = svgEl("g", { class: "td-slot", "data-slot": i, transform: "translate(" + s.x + " " + s.y + ")", tabindex: "-1" });
      gEl.addEventListener("click", function () { tdSelect(i); });
      slots.appendChild(gEl);
    });
    svg.appendChild(slots);
    svg.appendChild(svgEl("g", { id: "td-range" }));
    svg.appendChild(svgEl("g", { id: "td-enemies" }));
    svg.appendChild(svgEl("g", { id: "td-fx" }));
    arena.querySelector(".td-map-wrap").appendChild(svg);
    g.td.enemyEls = {};
    tdRender();
  }

  function tdRenderSlots() {
    var g = game, run = g.td.run;
    var box = byId("td-slots");
    if (!box) return;
    Array.prototype.forEach.call(box.children, function (gEl) {
      var i = Number(gEl.getAttribute("data-slot"));
      var t = run.towers.filter(function (x) { return x.slot === i; })[0];
      gEl.textContent = "";
      gEl.classList.toggle("selected", g.td.selected === i);
      if (!t) {
        gEl.appendChild(svgEl("circle", { r: 3, class: "td-slot-empty" }));
        gEl.appendChild(svgEl("path", { d: "M-1.2 0 h2.4 M0 -1.2 v2.4", class: "td-slot-plus" }));
        return;
      }
      var def = TD_TOWERS[t.type];
      gEl.appendChild(svgEl("circle", { r: 3.4, fill: def.color, class: "td-tower" }));
      var label = svgEl("text", { y: 1.2, "text-anchor": "middle", class: "td-tower-label" });
      label.textContent = ({ beacon: "✦", ballista: "B" })[t.type] || def.name[0];
      gEl.appendChild(label);
      var pips = t.a + t.b;
      for (var k = 0; k < pips; k++) {
        gEl.appendChild(svgEl("circle", { r: 0.45, cx: -3 + k * 0.85 + (k >= t.a ? 0.5 : 0), cy: 4.4, fill: k < t.a ? "#ffd166" : "#90e0ef" }));
      }
    });
    var rg = byId("td-range");
    rg.textContent = "";
    var sel = run.towers.filter(function (x) { return x.slot === g.td.selected; })[0];
    if (sel) {
      var pos = tdSlotPos(run, sel.slot);
      rg.appendChild(svgEl("circle", { cx: pos.x, cy: pos.y, r: tdStats(sel).range, class: "td-range-ring" }));
    }
  }

  function tdRender(fx, before) {
    var g = game, td = g.td;
    if (!td || !byId("td-enemies")) return;
    var run = td.run;
    tdRenderSlots();
    var layer = byId("td-enemies");
    var seen = {};
    run.enemies.forEach(function (e) {
      if (!e.alive || e.d < 0) return;
      seen[e.id] = true;
      var el = td.enemyEls[e.id];
      var def = TD_ENEMIES[e.type];
      var p = tdPos(run, e);
      if (!el) {
        el = svgEl("g", { class: "td-enemy" + (e.boss ? " boss" : "") + (e.fly ? " fly" : "") });
        if (e.fly) el.appendChild(svgEl("ellipse", { cx: 0.6, cy: def.r + 0.8, rx: def.r * 0.8, ry: def.r * 0.3, fill: "rgba(0,0,0,.25)" }));
        el.appendChild(svgEl("circle", { r: def.r, fill: def.color, class: "td-body" }));
        el.appendChild(svgEl("rect", { x: -def.r, y: -def.r - 1.6, width: def.r * 2, height: 0.7, class: "td-hp-back" }));
        el.appendChild(svgEl("rect", { x: -def.r, y: -def.r - 1.6, width: def.r * 2, height: 0.7, class: "td-hp" }));
        var start = before && before[e.id] ? before[e.id] : tdPointAt(tdRouteFor(run, e), Math.max(0, e.d - 6));
        el.style.transform = "translate(" + start.x + "px," + start.y + "px)";
        layer.appendChild(el);
        td.enemyEls[e.id] = el;
        void el.getBoundingClientRect();
      }
      el.style.transform = "translate(" + p.x + "px," + p.y + "px)";
      el.classList.toggle("burrowed", tdBurrowed(run, e));
      el.classList.toggle("slowed", e.slowSteps > 0 || e.frozen > 0);
      el.classList.toggle("poisoned", e.poison.length > 0);
      el.lastChild.setAttribute("width", Math.max(0, def.r * 2 * e.hp / e.max));
    });
    Object.keys(td.enemyEls).forEach(function (id) {
      if (seen[id]) return;
      var el = td.enemyEls[id];
      delete td.enemyEls[id];
      el.classList.add("gone");
      setTimeout(function () { el.remove(); }, 450);
    });
    if (fx && before) tdDrawFx(fx, before);
    tdRenderPanel();
  }

  function tdDrawFx(fx, before) {
    var g = game, run = g.td.run;
    var layer = byId("td-fx");
    if (!layer) return;
    var add = function (el) { layer.appendChild(el); setTimeout(function () { el.remove(); }, 420); };
    fx.forEach(function (f) {
      var at = before[f.id];
      if (f.kind === "shot" && at) {
        var s = tdSlotPos(run, f.slot);
        add(svgEl("line", { x1: s.x, y1: s.y, x2: at.x, y2: at.y, class: "td-shot td-shot-" + f.type }));
      } else if (f.kind === "zap" && at) {
        var from = f.slot !== null ? tdSlotPos(run, f.slot) : before[f.from];
        if (from) add(svgEl("line", { x1: from.x, y1: from.y, x2: at.x, y2: at.y, class: "td-shot td-shot-lightning" }));
      } else if (f.kind === "blast" && at) {
        if (f.slot !== undefined) { var s2 = tdSlotPos(run, f.slot); add(svgEl("line", { x1: s2.x, y1: s2.y, x2: at.x, y2: at.y, class: "td-shot td-shot-" + f.type })); }
        add(svgEl("circle", { cx: at.x, cy: at.y, r: f.r, class: "td-blast" }));
      } else if (f.kind === "aura") {
        var s3 = tdSlotPos(run, f.slot);
        add(svgEl("circle", { cx: s3.x, cy: s3.y, r: f.r, class: "td-aura" }));
      } else if ((f.kind === "crit" || f.kind === "stun") && at) {
        add(svgEl("circle", { cx: at.x, cy: at.y, r: 3.2, class: "td-" + f.kind }));
      }
    });
  }

  function tdSelect(slot) {
    var td = tdGame();
    if (!td || game.over || game.paused) return;
    td.selected = td.selected === slot ? null : slot;
    tdRenderSlots();
    tdRenderPanel();
  }

  function tdPathPips(level, max) {
    var s = "";
    for (var i = 0; i < 5; i++) s += i < level ? "●" : i < max ? "○" : "·";
    return s;
  }

  function tdRenderPanel() {
    var g = game, td = g.td, run = td.run;
    var panel = byId("td-panel");
    if (!panel) return;
    panel.textContent = "";
    var title = document.createElement("p");
    title.className = "td-panel-title";
    panel.appendChild(title);
    var mkBtn = function (label, enabled, onClick, cls) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.disabled = !enabled;
      if (cls) b.className = cls;
      b.addEventListener("click", function () { b.blur(); onClick(); });
      return b;
    };
    var after = function (err, ok) {
      if (err) { notifyError(err); return; }
      if (ok) ok();
      // Between waves the map is saved as you change it, so closing the
      // window keeps it; during a wave the save stays at the wave's start.
      if (td.phase === "build") tdSaveRun();
      tdRender();
      renderGameHud();
    };
    if (td.selected === null || td.selected === undefined) {
      title.textContent = "Click a slot on the map to build or upgrade a tower.";
      return;
    }
    var tower = run.towers.filter(function (x) { return x.slot === td.selected; })[0];
    if (!tower) {
      title.textContent = "Build a tower (you have " + run.gold + " gold)";
      var grid = document.createElement("div");
      grid.className = "td-build-grid";
      TD_TOWER_ORDER.forEach(function (type) {
        var def = TD_TOWERS[type];
        var unlocked = isUnlocked("td", def.key);
        var allowed = !(run.rules && run.rules.only && run.rules.only.indexOf(type) === -1);
        var b = mkBtn(def.name + " · " + def.cost, unlocked && allowed && run.gold >= def.cost, function () {
          after(tdBuild(run, td.selected, type), function () { gameEvent("build"); });
        }, "td-build-btn");
        b.title = !unlocked ? "Unlocks at level " + unlockLevelOf("td", def.key) : !allowed ? "Not allowed in this challenge" : def.role;
        if (!unlocked) b.textContent = def.name + " · lvl " + unlockLevelOf("td", def.key);
        b.style.setProperty("--tower", def.color);
        grid.appendChild(b);
      });
      panel.appendChild(grid);
      return;
    }
    var def = TD_TOWERS[tower.type];
    title.textContent = def.name + " · " + def.role;
    var maxLv = tdMaxPathLevel(run.level);
    ["a", "b"].forEach(function (path) {
      var row = document.createElement("div");
      row.className = "td-path";
      var info = document.createElement("span");
      var lv = tower[path];
      var nextText = lv >= 5 ? "Fully upgraded" : def[path].lv[lv];
      info.textContent = def[path].name + " " + tdPathPips(lv, maxLv) + (lv >= 3 ? " · ★ " + def[path].ability : "") + " · " + (lv >= 5 ? nextText : "Next: " + nextText);
      if (lv < 3) info.title = "Level 3 unlocks " + def[path].ability + ".";
      row.appendChild(info);
      var can = tdCanUpgrade(run, tower, path);
      var reason = lv >= 5 ? "Max" : lv >= maxLv ? "Level " + (lv === 3 ? unlockLevelOf("td", "path4") : unlockLevelOf("td", "path5")) : !can ? "Other path is past 2" : "";
      var cost = lv < 5 ? tdUpgradeCost(tower, path) : 0;
      row.appendChild(mkBtn(reason || "Upgrade · " + cost, !reason && run.gold >= cost, function () {
        after(tdUpgrade(run, tower, path), function () { gameEvent("pathlevel", { value: tower[path] }); });
      }));
      panel.appendChild(row);
    });
    var sell = mkBtn("Sell for " + tdSellValue(tower), !(run.rules && run.rules.noSell), function () {
      after(tdSell(run, tower), function () { td.selected = null; });
    }, "td-sell");
    panel.appendChild(sell);
  }

  /* ------------------------- Hold the Line: hooks ------------------------- */

  GAME_HOOKS.td = {
    wide: true,
    noBots: true,
    setupPanel: "game-td-options",
    keys: " · Space to start a wave",
    setupOpened: function () { tdFillSetup(); },
    readSetup: function () {
      return { mapId: byId("td-map").value, tier: byId("td-tier").value };
    },
    setupLines: function () {
      var p = state.gameData.td;
      return [tdTotalStars(p) + " of 36 stars · " + Object.keys(p.cleared).length + " clears" + (p.endlessBest ? " · Endless best: " + p.endlessBest + " waves" : "")];
    },
    tileLines: function () {
      var p = state.gameData.td;
      var lines = [tdTotalStars(p) + " of 36 stars"];
      if (p.run) lines.push("Saved: " + tdMapDef(p.run.mapId).name + ", wave " + (p.run.wave + 1));
      if (p.endlessBest) lines.push("Endless best: " + p.endlessBest + " waves");
      return lines;
    },
    begin: function (g, setup) {
      var p = g.profile = state.gameData.td;
      var level = playerLevel("td");
      var opt = setup.extra || {};
      var run;
      if (opt.mapId === "resume" && p.run) run = tdRestoreRun(p.run, level);
      else {
        var mapId = tdMapDef(opt.mapId) ? opt.mapId : "m1";
        var tier = hasOwn(TD_TIERS, opt.tier) ? opt.tier : "normal";
        if (tdLockReason(p, mapId, tier)) { mapId = "m1"; tier = "normal"; }
        var layout = null;
        if (mapId === "endless") {
          var open = TD_MAPS.filter(function (m) { return p.cleared[m.id + ":normal"]; });
          layout = (open.length ? open : TD_MAPS.slice(0, 1))[Math.floor(Math.random() * Math.max(1, open.length))].id;
        }
        run = tdNewRun({ mapId: mapId, tier: tier, layout: layout, level: level });
        p.lastMap = mapId; p.lastTier = tier;
        p.run = tdSnapshot(run);
      }
      run.goldMult = g.rewardMult;
      g.td = { run: run, phase: "build", selected: null, enemyEls: {} };
    },
    start: function () { tdEnterBuild(); },
    renderArena: function () { tdRenderArena(); },
    idleAction: function () { tdStartNextWave(); },
    key: function (k, event) {
      var td = tdGame();
      if (event && event.target && event.target.tagName === "BUTTON" && event.target.id !== "game-cast-btn") return false;
      if (td && td.phase === "build" && (k === " " || k === "enter")) { tdStartNextWave(); return true; }
      return false;
    },
    tick: function () {
      if (game.td.phase !== "wave") return true; // building: no clock
      return false;
    },
    hud: function (stats) {
      var run = game.td.run, total = tdWaveCount(run);
      stats.appendChild(hudStat("Wave", run.wave + (total === Infinity ? "" : " / " + total)));
      stats.appendChild(hudStat("Lives", run.lives + " / " + run.maxLives));
      stats.appendChild(hudStat("Gold", String(run.gold)));
    },
    levelStep: function () {
      var run = game.td.run, total = tdWaveCount(run);
      if (total === Infinity) return run.wave <= 10 ? 0 : run.wave <= 20 ? 1 : 2;
      var f = run.wave / total;
      return f <= 0.34 ? 0 : f <= 0.67 ? 1 : 2;
    },
    thinkAdjust: function () { var run = game.td.run; return run.kind === "map" ? TD_TIERS[run.tier].think : 0; },
    correct: tdCorrect,
    wrong: tdWrong,
    afterFeedback: tdAfterFeedback,
    quit: function (g) {
      // Quitting keeps the save from the start of this wave, minus any lives
      // already lost, so quitting can't undo a defeat.
      var run = g.td.run, p = g.profile;
      if (!p.run || run.kind === "endless" && run.lives <= 0) { p.run = null; return; }
      if (run.lives <= 0) { p.run = null; return; }
      if (g.td.phase === "wave") {
        p.run.lives = Math.min(p.run.lives, run.lives);
        // Leaks stay on record, so a quit can't restore a perfect map.
        p.run.leaked = Math.max(p.run.leaked || 0, run.leaked);
      }
      else p.run = tdSnapshot(run);
    },
    quitHint: "Your map is saved at the start of this wave (with any lives you've lost), so you can pick it up later.",
    resultTitle: function (g) { return g.td.result ? (g.td.result.won ? ": map cleared!" : g.td.run.kind === "endless" ? ": the line broke" : ": the line broke") : ": game over"; },
    resultRows: function (g) {
      var run = g.td.run, r = g.td.result || { won: false, stars: 0, cleared: Math.max(0, run.wave - 1) };
      var def = tdMapDef(run.mapId);
      return [
        ["Map", def.kind === "endless" ? "Endless" : def.name + (def.kind === "map" ? " (" + TD_TIERS[run.tier].name + ")" : "")],
        ["Result", r.won ? (def.kind === "map" && run.tier === "normal" ? tdStarText(r.stars) : "Cleared") : "Wave " + run.wave],
        ["Waves cleared", String(r.cleared)],
        ["Lives left", run.lives + " / " + run.maxLives],
        ["Enemies defeated", String(run.kills)],
        ["Accuracy", g.answered ? Math.round(100 * g.correct / g.answered) + "%" : "—"]
      ];
    }
  };

