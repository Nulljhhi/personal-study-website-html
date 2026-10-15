  /* ------------------------------ Drawing ------------------------------ */

  function dvRenderArena() {
    var g = game, D = g.delve, run = D.run;
    var bio = DV_BIOMES[run.biome];
    var arena = byId("game-arena");
    arena.innerHTML = '<p class="arena-name" id="dv-name"></p><p class="arena-sub" id="dv-sub"></p><div id="dv-view" class="dv-view"></div>' +
      '<div class="dv-player"><div class="dv-hp-track"><div class="dv-hp" id="dv-hp"></div></div><span id="dv-hp-text"></span></div>' +
      '<div id="dv-relics" class="dv-relics"></div>';
    byId("dv-name").textContent = bio.name + " · floor " + dvDepth(run) + " of " + DV_FLOORS;
    byId("dv-sub").textContent = dvClass(run.cls).name + " · " + dvClass(run.cls).ability + ": " + dvClass(run.cls).abilityDesc;
    var view = byId("dv-view");
    view.style.background = bio.bg;
    view.style.color = bio.fg;
    if (D.mon && (D.phase === "fight" || D.won)) dvRenderFight();
    else if (D.phase === "map") dvRenderMap(view);
    else {
      var info = D.room ? DV_ROOM_INFO[D.room.type] : null;
      view.innerHTML = '<div class="dv-room-card"></div>';
      view.firstChild.textContent = info ? info.name : "";
      if (info) view.firstChild.style.borderColor = info.color;
    }
    dvRenderPlayer();
  }

  function dvRenderPlayer() {
    var D = dvGame();
    if (!D || !byId("dv-hp")) return;
    var run = D.run;
    byId("dv-hp").style.width = (100 * run.hp / run.maxHp) + "%";
    byId("dv-hp-text").textContent = "HP " + run.hp + " / " + run.maxHp + (D.poison ? " · poisoned (" + D.poison + ")" : "") + (D.guard ? " · guarding" : "");
    var box = byId("dv-relics");
    box.textContent = "";
    run.relics.forEach(function (id) {
      var r = dvRelic(id);
      var chip = document.createElement("span");
      chip.className = "dv-relic";
      chip.textContent = r.name;
      chip.title = r.desc;
      box.appendChild(chip);
    });
  }

  function dvRenderMap(view) {
    var run = dvGame().run;
    var rows = run.map.rows;
    var W = 100, H = 100;
    var pos = function (r, i) { var n = rows[r].length; return { x: n === 1 ? 50 : 12 + 76 * i / (n - 1), y: 90 - r * (80 / (rows.length - 1)) }; };
    var reach = dvReachable();
    var lines = [];
    rows.forEach(function (row, r) {
      row.forEach(function (node, i) {
        node.links.forEach(function (j) {
          if (!rows[r + 1]) return;
          var a = pos(r, i), b = pos(r + 1, j);
          var walked = r === run.row ? (i === run.col && false) : node.done && rows[r + 1][j].done;
          lines.push('<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" class="dv-link' + (walked ? " walked" : "") + '"/>');
        });
      });
    });
    view.innerHTML = '<div class="dv-map"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="dv-links">' + lines.join("") + '</svg></div>';
    var map = view.firstChild;
    rows.forEach(function (row, r) {
      row.forEach(function (node, i) {
        var p = pos(r, i), info = DV_ROOM_INFO[node.type];
        var b = document.createElement("button");
        b.type = "button";
        b.className = "dv-node" + (node.done ? " done" : "") + (r === run.row && i === run.col ? " here" : "");
        var canGo = r === run.row + 1 && reach.indexOf(i) !== -1;
        b.disabled = !canGo;
        if (canGo) b.classList.add("reach");
        b.style.left = p.x + "%";
        b.style.top = p.y + "%";
        b.style.setProperty("--room", info.color);
        b.textContent = info.name;
        b.title = info.name + (canGo ? " (click to enter)" : "");
        b.addEventListener("click", function () { b.blur(); dvEnterRoom(i); });
        map.appendChild(b);
      });
    });
    // Number the rooms you can enter, left to right, for the 1-9 keys.
    var lit = Array.prototype.slice.call(map.querySelectorAll(".dv-node.reach"));
    lit.sort(function (a, b) { return parseFloat(a.style.left) - parseFloat(b.style.left); });
    lit.forEach(function (b, n) { if (n < 9) { b.dataset.key = String(n + 1); b.setAttribute("aria-keyshortcuts", String(n + 1)); } });
  }

  function dvRenderFight(fx) {
    var D = dvGame();
    var view = byId("dv-view");
    if (!D || !view || !D.mon) { dvRenderPlayer(); return; }
    var m = D.mon;
    if (!view.querySelector(".dv-fight") || view.dataset.mon !== m.def.id + m.max) {
      view.dataset.mon = m.def.id + m.max;
      view.innerHTML = '<div class="dv-fight"><p class="dv-mon-name"></p><p class="dv-mon-ab"></p><div class="dv-pips"></div><div class="dv-figure"></div></div>';
      view.querySelector(".dv-mon-name").textContent = m.def.name + (m.def.rank !== "normal" ? " (" + m.def.rank + ")" : "");
      view.querySelector(".dv-mon-ab").textContent = m.def.ab.length ? m.def.ab.map(function (a) { return DV_ABILITIES[a].name + ": " + DV_ABILITIES[a].desc; }).join(" ") : "No special tricks.";
      view.querySelector(".dv-figure").innerHTML = bossSvg(m.def.kind, m.def.hue).replace('id="boss-figure"', 'id="dv-mon-figure"');
    }
    var pips = view.querySelector(".dv-pips");
    pips.textContent = "";
    // Shields sit on top of health. A bar stacks them over the health bar,
    // so health shows through only where the outer shield is worn away;
    // pips show the shield's blue pips until it's broken, then red health.
    var shields = (m.shields || []).filter(function (sh) { return sh.hp > 0; });
    if (m.max > 24) pips.appendChild(dvStackBar(m, shields));
    else if (shields.length) shields.forEach(function (sh, n) {
      for (var j = 0; j < (n ? sh.hp : sh.max); j++) pips.appendChild(dvPip("dv-pip shield" + (n ? " inner" : "") + (j < sh.hp ? "" : " gone")));
    });
    else for (var i = 0; i < m.max; i++) pips.appendChild(dvPip("dv-pip" + (i < m.hp ? "" : " gone")));
    if (m.shield) { var sh = document.createElement("span"); sh.className = "dv-shield"; sh.textContent = "Shield"; pips.appendChild(sh); }
    var fig = byId("dv-mon-figure");
    if (fig && fx) {
      fig.classList.remove("hit", "dead");
      void fig.getBoundingClientRect();
      if (fx === "hit") fig.classList.add("hit");
      if (fx === "dead") fig.classList.add("dead");
    }
    dvRenderPlayer();
  }

  function dvPip(cls) { var s = document.createElement("span"); s.className = cls; return s; }

  /* One bar: health at the bottom, shield layers over it (outer on top). */
  function dvStackBar(m, shields) {
    var wrap = document.createElement("div");
    wrap.className = "dv-bar stack";
    var layer = function (cls, v, max) {
      var f = document.createElement("div");
      f.className = "dv-bar-fill" + cls;
      f.style.width = (100 * Math.max(0, v) / max) + "%";
      wrap.appendChild(f);
    };
    layer("", m.hp, m.max);
    for (var i = shields.length - 1; i >= 0; i--) layer(" shield" + (i ? " inner" : ""), shields[i].hp, shields[i].max);
    var top = shields[0];
    var txt = document.createElement("span");
    txt.textContent = !top ? "HP " + m.hp + " / " + m.max :
      "Shield " + top.hp + " / " + top.max + (shields.length > 1 ? " (+" + (shields.length - 1) + ")" : "") +
      (top.hp < top.max && shields.length === 1 ? " · HP " + m.hp + " / " + m.max : "");
    wrap.appendChild(txt);
    return wrap;
  }

  /* --------------------------- Setup and camp --------------------------- */

  function dvFillSetup() {
    var p = state.gameData.delve;
    var cls = byId("delve-class");
    cls.textContent = "";
    DV_CLASSES.forEach(function (c) {
      var o = document.createElement("option");
      var open = isUnlocked("delve", c.key);
      o.value = c.id;
      o.textContent = c.name + " (" + c.hp + " HP, " + dvRelic(c.relic).name + ")" + (open ? "" : " · level " + unlockLevelOf("delve", c.key));
      o.disabled = !open;
      cls.appendChild(o);
    });
    cls.value = isUnlocked("delve", p.cls) ? p.cls : "scholar";
    var start = byId("delve-start");
    start.textContent = "";
    if (p.run) {
      var ro = document.createElement("option");
      ro.value = "resume";
      ro.textContent = "Continue your run: " + DV_BIOMES[p.run.biome].name + ", floor " + dvDepth(p.run) + " (" + dvClass(p.run.cls).name + ", " + p.run.hp + " HP)";
      start.appendChild(ro);
    }
    DV_BIOMES.forEach(function (b, i) {
      if (i > 0 && !p.shortcuts[i]) return;
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = i === 0 ? "New run from the Crypt" : "New run from the " + b.name + " (floor " + (i * 5 + 1) + ", shortcut)";
      start.appendChild(o);
    });
    start.value = p.run ? "resume" : "0";
    dvSyncSetup();
  }
  function dvSyncSetup() {
    var p = state.gameData.delve;
    var v = byId("delve-start").value;
    byId("delve-class-row").classList.toggle("hidden", v === "resume");
    var c = dvClass(byId("delve-class").value);
    byId("delve-info").textContent = v === "resume" ? "Pick up where you left off." :
      c.name + ": " + c.ability + " (Q) — " + c.abilityDesc + " Starting relic: " + dvRelic(c.relic).name + ", " + dvRelic(c.relic).desc +
      (p.run ? " Starting a new run abandons the one in progress." : "");
  }

  var campTab = "upgrades";
  function openCamp() {
    renderCamp();
    byId("camp-modal").classList.remove("hidden");
    byId("camp-close-btn").focus();
  }
  function closeCamp() { byId("camp-modal").classList.add("hidden"); dvFillSetup(); updateGameSetup(); }
  function renderCamp() {
    var p = state.gameData.delve;
    byId("camp-lanterns").textContent = fmtScore(p.lanterns) + " lanterns";
    document.querySelectorAll("#camp-tabs button").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === campTab); b.setAttribute("aria-selected", b.dataset.tab === campTab); });
    var list = byId("camp-list");
    list.textContent = "";
    var save = function () { persistCompleted(); renderCamp(); };
    if (campTab === "upgrades") {
      DV_CAMP.forEach(function (u) {
        var lv = p.camp[u.id], cost = u.cost[lv];
        list.appendChild(shopCard(u.name, u.desc, "Level " + lv + " / " + u.max, lv >= u.max ? "Maxed" : "Buy " + cost, lv < u.max && p.lanterns >= cost, function () {
          if (!purchaseAllowed() || p.camp[u.id] >= u.max || p.lanterns < cost) return;
          p.lanterns -= cost; p.camp[u.id]++; save();
        }));
      });
      for (var b = 1; b < DV_BIOMES.length; b++) (function (bi) {
        var reached = p.deepest >= bi * 5 + 1, owned = !!p.shortcuts[bi], cost = dvShortcutCost(bi);
        if (!reached && bi > 1 && !(p.deepest >= (bi - 1) * 5 + 1)) return; // only the next locked one shows
        list.appendChild(shopCard("Shortcut: " + DV_BIOMES[bi].name, "Start new runs on floor " + (bi * 5 + 1) + ", the " + DV_BIOMES[bi].name + ".", owned ? "Owned" : reached ? cost + " lanterns" : "Reach it first",
          owned ? "Owned" : !reached ? "Locked" : "Buy " + cost, !owned && reached && p.lanterns >= cost, function () {
            if (!purchaseAllowed() || p.shortcuts[bi] || p.lanterns < cost) return;
            p.lanterns -= cost; p.shortcuts[bi] = true; save();
          }, owned ? "equipped" : ""));
      })(b);
    } else if (campTab === "outfitter") {
      dvRenderOutfitter(list, p, save);
    } else if (campTab === "relics") {
      // Relic codex: every relic, and where relics come from now.
      var found = DV_RELICS.filter(function (r) { return p.codex.relics[r.id]; }).length;
      var head = document.createElement("p");
      head.className = "camp-codex-head";
      head.textContent = "Relics found: " + found + " / " + DV_RELICS.length + ". Relics come from chests and elites (always), and sometimes from ? rooms and shrines; shops sell them too. Buy one at the Outfitter to start your next run with it.";
      list.appendChild(head);
      DV_RELICS.forEach(function (r) {
        var seen = !!p.codex.relics[r.id];
        list.appendChild(shopCard(seen ? r.name : "???", seen ? r.desc : "Not found yet", seen ? "Found" : "Undiscovered", "—", false, function () {}, seen ? "equipped" : ""));
      });
    } else {
      var seenM = DV_MONSTERS.filter(function (m) { return p.codex.monsters[m.id]; }).length;
      var seenE = DV_EVENTS.filter(function (e) { return p.codex.events[e.id]; }).length;
      var head2 = document.createElement("p");
      head2.className = "camp-codex-head";
      head2.textContent = "Monsters " + seenM + "/" + DV_MONSTERS.length + " · Rooms " + seenE + "/" + DV_EVENTS.length + " · Deepest: floor " + p.deepest + " of " + DV_FLOORS;
      list.appendChild(head2);
      // Biomes you've reached, with their monsters.
      DV_BIOMES.forEach(function (bio, bi) {
        if (bi > 0 && p.deepest < bi * 5 + 1) return;
        var sec = document.createElement("p");
        sec.className = "camp-codex-head";
        sec.textContent = "Floors " + (bi * 5 + 1) + "-" + (bi * 5 + 5) + ": " + bio.name;
        list.appendChild(sec);
        DV_MONSTERS.filter(function (m) { return m.biome === bi; }).forEach(function (m) {
          var n = p.codex.monsters[m.id];
          var layers = DV_TIERS[bio.tier].shields[m.rank];
          list.appendChild(shopCard(n ? m.name : "???", n ? m.rank + (layers ? " · " + layers + (layers === 1 ? " shield layer" : " shield layers") : "") + " · " + (m.ab.length ? m.ab.map(function (a) { return DV_ABILITIES[a].name; }).join(", ") : "no tricks") : m.rank,
            n ? "Defeated " + n + "×" : "Not met yet", "—", false, function () {}, n ? "equipped" : ""));
        });
      });
      DV_EVENTS.forEach(function (e) {
        list.appendChild(shopCard(p.codex.events[e.id] ? e.name : "???", p.codex.events[e.id] ? e.text : "Not found yet", "Event room", "—", false, function () {}));
      });
    }
  }

  /* What's packed for the next run, for the setup screen. */
  function dvPackLine(p) {
    var bits = [];
    ["weapon", "armor", "trinket"].forEach(function (slot) {
      var it = p.gear[slot];
      if (it) bits.push(dvGearDef(it.id).name + " (" + it.runs + (it.runs === 1 ? " run" : " runs") + ")");
    });
    p.supplies.forEach(function (id) { bits.push(dvSupplyDef(id).name); });
    p.packRelics.forEach(function (id) { bits.push(dvRelic(id).name); });
    return bits.length ? "Packed for the next run: " + bits.join(", ") + "." : "Nothing packed. Visit the Outfitter in Camp to buy gear for your next runs.";
  }

  function dvRenderOutfitter(list, p, save) {
    var head = document.createElement("p");
    head.className = "camp-codex-head";
    head.textContent = dvPackLine(p) + " Gear lasts several runs (one per slot); supplies and relics are used up by the next run.";
    list.appendChild(head);
    var title = function (t) { var h = document.createElement("p"); h.className = "camp-codex-head"; h.textContent = t; list.appendChild(h); };
    title("Gear");
    DV_GEAR.forEach(function (it) {
      var locked = it.need && p.deepest < it.need;
      var cur = p.gear[it.slot];
      var mine = cur && cur.id === it.id;
      var label = locked ? "Reach floor " + it.need : mine ? "Restock " + it.price : "Buy " + it.price;
      var note = it.slot + " · lasts " + it.runs + " runs" + (mine ? " · " + cur.runs + " left" : cur ? " · replaces your " + dvGearDef(cur.id).name : "");
      list.appendChild(shopCard(it.name, it.desc, note, label, !locked && p.lanterns >= it.price && !(mine && cur.runs >= it.runs), function () {
        if (!purchaseAllowed() || locked || p.lanterns < it.price) return;
        p.lanterns -= it.price;
        p.gear[it.slot] = { id: it.id, runs: it.runs };
        notify(it.name + " packed for your next " + it.runs + " runs.");
        save();
      }, mine ? "equipped" : ""));
    });
    title("Supplies (next run only, up to " + DV_PACK_MAX.supplies + ")");
    DV_SUPPLIES.forEach(function (it) {
      var full = p.supplies.length >= DV_PACK_MAX.supplies;
      var count = p.supplies.filter(function (x) { return x === it.id; }).length;
      list.appendChild(shopCard(it.name, it.desc, count ? count + " packed" : "Next run", full ? "Pack full" : "Buy " + it.price, !full && p.lanterns >= it.price, function () {
        if (!purchaseAllowed() || p.supplies.length >= DV_PACK_MAX.supplies || p.lanterns < it.price) return;
        p.lanterns -= it.price; p.supplies.push(it.id); save();
      }, count ? "equipped" : ""));
    });
    title("Relics (next run only, up to " + DV_PACK_MAX.relics + ")");
    DV_RELICS.forEach(function (r) {
      var seen = !!p.codex.relics[r.id];
      var packed = p.packRelics.indexOf(r.id) !== -1;
      var full = p.packRelics.length >= DV_PACK_MAX.relics;
      var price = dvRelicPrice(r);
      if (!seen) return; // only relics you've found can be bought
      list.appendChild(shopCard(r.name, r.desc, packed ? "Packed" : price + " lanterns", packed ? "Packed" : full ? "Pack full" : "Buy " + price, !packed && !full && p.lanterns >= price, function () {
        if (!purchaseAllowed() || packed || p.packRelics.length >= DV_PACK_MAX.relics || p.lanterns < price) return;
        p.lanterns -= price; p.packRelics.push(r.id); save();
      }, packed ? "equipped" : ""));
    });
  }

  /* -------------------------------- Hooks -------------------------------- */

  GAME_HOOKS.delve = {
    wide: true,
    // Fights only. Elites, bosses and deeper floors bring harder ones.
    minigame: {
      level: function () {
        var D = game.delve;
        if (!D || D.phase !== "fight" || !D.mon) return 0;
        var run = D.run, rank = D.mon.def.rank;
        if (run.biome === 0 && run.floor < 2 && rank === "normal") return 0;
        return (rank === "boss" ? 3 : rank === "elite" ? 2 : 1) + Math.floor(dvTier(run.biome) * 1.5) + (run.biome % 5 >= 3 ? 1 : 0);
      },
      result: function (won) {
        var g = game, D = g.delve;
        if (won) { if (g.current) g.current.mgBonus = 1; return "+1 damage if this answer hits."; }
        var hit = Math.max(1, Math.ceil(D.mon.def.atk / 2));
        var alive = dvHurt(hit);
        floatText("-" + hit + " HP", "arena-penalty");
        renderGameHud();
        dvRenderFight("miss");
        if (!alive) {
          // Out of HP: nothing can be answered while the knockout plays out.
          g.locked = true;
          byId("game-choices").classList.add("locked");
          if (g.current && g.current.pad) g.current.pad.lock();
          gameAfter(750, function () { if (game.delve === D && !D.ended) dvDie(); });
        }
        return D.mon.def.name + " catches you for " + hit + ".";
      }
    },
    noBots: true,
    setupPanel: "game-delve-options",
    shopLabel: "Camp & codex",
    keys: " · Q class ability",
    openShop: function () { openCamp(); },
    setupOpened: function () { dvFillSetup(); },
    readSetup: function () { return { start: byId("delve-start").value, cls: byId("delve-class").value }; },
    setupLines: function (setup) {
      var p = state.gameData.delve;
      return [setup.clean ? "Clean run: no camp upgrades, outfitter gear or shortcuts, nothing saved." : fmtScore(p.lanterns) + " lanterns · deepest floor " + p.deepest + " of " + DV_FLOORS + " · " + p.wins + " full clears", dvPackLine(p)];
    },
    tileLines: function () {
      var p = state.gameData.delve;
      var lines = ["Deepest: floor " + p.deepest + " of " + DV_FLOORS + " · " + fmtScore(p.lanterns) + " lanterns"];
      if (p.run) lines.push("Run in progress: " + DV_BIOMES[p.run.biome].name + ", floor " + dvDepth(p.run));
      return lines;
    },
    begin: function (g, setup) {
      var p = g.profile = g.clean ? freshDelveProfile() : state.gameData.delve;
      var opt = setup.extra || {};
      var run;
      if (!g.clean && opt.start === "resume" && p.run) {
        run = p.run;
        run.floorFlags = run.floorFlags || {};
      } else {
        var cls = isUnlocked("delve", opt.cls) && DV_CLASSES.some(function (c) { return c.id === opt.cls; }) ? opt.cls : "scholar";
        var sb = Number(opt.start) || 0;
        if (g.clean || !p.shortcuts[sb]) sb = 0;
        if (!g.clean) p.cls = cls;
        run = dvNewRun(p, cls, sb, !g.clean);
        if (run.outfitNotes && run.outfitNotes.length) notify("Brought from camp: " + run.outfitNotes.join(", ") + ".");
      }
      g.delve = { run: run, phase: "map", room: null, mon: null };
      if (!g.clean) p.run = null; // dvSave() writes the live run
    },
    start: function () {
      var D = game.delve, run = D.run;
      var resumeRoom = run.inRoom && run.row >= 0 ? run.map.rows[run.row][run.col] : null;
      run.inRoom = false;
      if (run.row < 0 && run.floor === 0 && run.floorsCleared === 0) dvStartFloor();
      if (resumeRoom && !resumeRoom.done) { D.room = { type: resumeRoom.type }; dvSave(); dvRoom(resumeRoom.type); }
      else dvShowMap();
    },
    renderArena: function () { dvRenderArena(); },
    key: function (k, event) {
      if (event && event.target && event.target.tagName === "BUTTON" && k !== "q") return false;
      if (k === "q") { dvAbility(); return true; }
      return false;
    },
    hud: function (stats) {
      var run = game.delve.run;
      stats.appendChild(hudStat("HP", run.hp + " / " + run.maxHp));
      stats.appendChild(hudStat("Gold", String(run.gold)));
      stats.appendChild(hudStat("Floor", dvDepth(run) + " / " + DV_FLOORS));
      if (run.cls === "alchemist" || run.potions) stats.appendChild(hudStat("Potions", String(run.potions)));
    },
    levelStep: function () {
      var D = game.delve;
      if (D.forceHard || dvAb("riddler")) return 2;
      var b = D.run.biome;
      return b === 0 ? (D.run.floor < 3 ? 0 : 1) : b <= 2 ? 1 : 2; // hard wrong answers from the Sunken Library down
    },
    thinkAdjust: function () {
      var D = game.delve;
      var t = 500 * game.profile.camp.insight + (D.run.gearBonus ? D.run.gearBonus.think : 0);
      if (dvHas("hourglass")) t += 2000;
      if (dvHas("goldtooth")) t -= 1000;
      if (D.run.floorFlags.nook) t += 1000;
      if (dvAb("hasty") && !dvHas("anchor")) t -= 1500;
      if (dvAb("shade") && !dvHas("trueeye")) t += 1500;
      return t;
    },
    decorate: function (box, c) {
      var D = game.delve;
      if (!D || D.phase !== "fight" || dvHas("trueeye")) return;
      if (dvAb("mimic") && !c.tf && !c.hs) {
        var slots = ["a", "b", "c", "d"];
        var hide = slots[Math.floor(Math.random() * 4)];
        var b = box.querySelector('button.choice[data-slot="' + hide + '"]');
        if (b) { b.lastChild.textContent = "??? (the Mimic hides this answer)"; b.classList.add("mimicked"); }
      }
      if (dvAb("shade")) {
        box.classList.add("fogged");
        gameAfter(1500, function () { box.classList.remove("fogged"); }, true);
      }
    },
    correct: function (c, speed) { return dvCorrect(c, speed); },
    wrong: function (late) { return dvMiss(late); },
    afterFeedback: dvAfterFeedback,
    quit: function (g) {
      var D = g.delve;
      if (g.clean || !D || D.ended) return;
      if (D.run.hp <= 0) { g.profile.run = null; return; }
      if (!D.room) { dvSave(); return; }
      // Inside a room: keep the save from entering it (rewards aren't banked),
      // but HP lost and potions used in the room still count.
      if (g.profile.run) { g.profile.run.hp = Math.min(g.profile.run.hp, D.run.hp); g.profile.run.potions = Math.min(g.profile.run.potions, D.run.potions); }
    },
    quitHint: "Your run is saved. If you're in a room, you'll start that room again (with the HP you have now).",
    resultTitle: function (g) { var r = g.delve.reason; return r === "victory" ? ": the depths are conquered!" : r === "leave" ? ": back at camp" : ": you fell in the depths"; },
    resultRows: function (g) {
      var D = g.delve, run = D.run;
      return [["Deepest", "Floor " + dvDepth(run) + " (" + DV_BIOMES[run.biome].name + ")"], ["Monsters defeated", String(run.kills)],
        ["Relics", String(run.relics.length)], ["Gold found", String(run.goldEarned)],
        ["Lanterns", g.clean ? "— (clean run)" : "+" + D.lanterns + (D.reason === "death" ? " (60% after a fall)" : "")],
        ["Accuracy", g.answered ? Math.round(100 * g.correct / g.answered) + "%" : "—"]];
    }
  };

