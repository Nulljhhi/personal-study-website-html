  /* ========================= Boss Battle campaign =========================
     Five worlds of five bosses, beside the endless mode. Each boss has
     mechanics that change the fight, drops gear on its first defeat, and
     awards 1-3 stars for hearts kept. Clearing all 25 opens the Gauntlet. */

  var CB_WORLDS = [
    { name: "Verdant Woods", hue: 110 }, { name: "Sunscorch Desert", hue: 38 }, { name: "Frostpeak", hue: 200 },
    { name: "Sunken Ruins", hue: 170 }, { name: "Obsidian Keep", hue: 280 }
  ];
  var CB_BOSSES = [
    ["Moss Slime", "slime", []], ["Bramble Beetle", "beetle", ["armor"]], ["Thornback Golem", "golem", ["shield"]],
    ["Willow Wisp", "wisp", ["fog"]], ["Elder Treant", "golem", ["heal", "shield"]],
    ["Sand Slime", "slime", ["haste"]], ["Scarab King", "beetle", ["armor", "regen"]], ["Dune Golem", "golem", ["shield", "rage"]],
    ["Mirage Wisp", "wisp", ["fog", "heal"]], ["Sun Dragon", "dragon", ["rage", "glass"]],
    ["Frost Slime", "slime", ["regen"]], ["Ice Beetle", "beetle", ["armor", "haste"]], ["Glacier Golem", "golem", ["shield", "regen"]],
    ["Blizzard Wisp", "wisp", ["fog", "haste"]], ["Frost Wyrm", "dragon", ["rage", "shield", "heal"]],
    ["Tide Slime", "slime", ["heal", "regen"]], ["Coral Beetle", "beetle", ["armor", "glass"]], ["Drowned Golem", "golem", ["shield", "heal"]],
    ["Siren Wisp", "wisp", ["fog", "rage"]], ["Leviathan", "dragon", ["shield", "regen", "haste"]],
    ["Shadow Slime", "slime", ["glass", "regen"]], ["Obsidian Beetle", "beetle", ["armor", "shield"]], ["Iron Golem", "golem", ["shield", "rage", "regen"]],
    ["Lich Wisp", "wisp", ["fog", "heal", "haste"]], ["Void Dragon", "dragon", ["shield", "rage", "heal", "glass"]]
  ].map(function (b, i) {
    var w = Math.floor(i / 5);
    return { index: i, world: w, slot: i % 5, name: b[0], kind: b[1], mech: b[2], hue: (CB_WORLDS[w].hue + (i % 5) * 18) % 360 };
  });
  var CB_MECHANICS = {
    shield: { name: "Ward", desc: "At half health it raises a ward that only a 3-answer streak breaks." },
    heal: { name: "Leech", desc: "Every miss heals it 12%." },
    rage: { name: "Rage", desc: "Below a third of its health you get 1.5 s less thinking time." },
    regen: { name: "Regenerate", desc: "Heals 3% after every question." },
    haste: { name: "Haste", desc: "1 s less thinking time all fight." },
    fog: { name: "Fog", desc: "The answers stay hidden for the first second (you get that second back)." },
    armor: { name: "Armor", desc: "Slow answers (under half the timer left) deal 30% less damage." },
    glass: { name: "Crushing", desc: "30% less health, but every miss costs 2 hearts." }
  };
  var CB_GEAR = [
    { id: "w1", slot: "weapon", name: "Wooden Sword", boss: 1, dmg: 0.1 }, { id: "a1", slot: "armor", name: "Leaf Mail", boss: 3, hearts: 1 },
    { id: "c1", slot: "charm", name: "Acorn Charm", boss: 4, think: 500 },
    { id: "w2", slot: "weapon", name: "Desert Scimitar", boss: 6, dmg: 0.2 }, { id: "a2", slot: "armor", name: "Sand Plate", boss: 8, hearts: 1, forgive: true },
    { id: "c2", slot: "charm", name: "Sun Charm", boss: 9, think: 1000 },
    { id: "w3", slot: "weapon", name: "Frost Blade", boss: 11, dmg: 0.3 }, { id: "a3", slot: "armor", name: "Frost Plate", boss: 13, hearts: 2 },
    { id: "c3", slot: "charm", name: "Snowflake Charm", boss: 14, think: 1000, start: ["freeze"] },
    { id: "w4", slot: "weapon", name: "Trident", boss: 16, dmg: 0.45 }, { id: "a4", slot: "armor", name: "Coral Guard", boss: 18, hearts: 2, forgive: true },
    { id: "c4", slot: "charm", name: "Pearl Charm", boss: 19, think: 1500, start: ["fifty"] },
    { id: "w5", slot: "weapon", name: "Void Edge", boss: 21, dmg: 0.6 }, { id: "a5", slot: "armor", name: "Obsidian Plate", boss: 23, hearts: 3 },
    { id: "c5", slot: "charm", name: "Void Charm", boss: 24, think: 2000, start: ["fifty", "freeze", "heal"] }
  ];
  function cbGear(id) { for (var i = 0; i < CB_GEAR.length; i++) if (CB_GEAR[i].id === id) return CB_GEAR[i]; return null; }
  function cbGearText(gear) {
    var bits = [];
    if (gear.dmg) bits.push("+" + Math.round(gear.dmg * 100) + "% damage");
    if (gear.hearts) bits.push("+" + gear.hearts + (gear.hearts === 1 ? " heart" : " hearts"));
    if (gear.forgive) bits.push("your first miss each fight is free");
    if (gear.think) bits.push("+" + (gear.think / 1000) + " s thinking time");
    if (gear.start) bits.push("start with " + gear.start.map(function (k) { return POWERUP_INFO[k].label; }).join(", "));
    return bits.join(", ");
  }

  function freshBossProfile() { return { stars: {}, gear: {}, equip: { weapon: null, armor: null, charm: null }, gauntletBest: 0, last: "" }; }
  function parseBossProfile(src) {
    var p = freshBossProfile();
    if (!src || typeof src !== "object") return p;
    var num = function (v, d) { return typeof v === "number" && isFinite(v) ? v : d; };
    for (var i = 0; i < 25; i++) { var s = Math.floor(num(src.stars && src.stars[i], 0)); if (s > 0) p.stars[i] = clamp(s, 1, 3); }
    CB_GEAR.forEach(function (g) { if (src.gear && src.gear[g.id] === true) p.gear[g.id] = true; });
    ["weapon", "armor", "charm"].forEach(function (slot) {
      var id = src.equip && src.equip[slot];
      var g = cbGear(id);
      if (g && g.slot === slot && p.gear[id]) p.equip[slot] = id;
    });
    p.gauntletBest = Math.max(0, Math.floor(num(src.gauntletBest, 0)));
    if (typeof src.last === "string") p.last = src.last.slice(0, 20);
    return p;
  }

  function cbUnlocked(p, i) { return i === 0 || !!p.stars[i - 1]; }
  function cbAllCleared(p) { return CB_BOSSES.every(function (b) { return p.stars[b.index]; }); }
  function cbTotalStars(p) { return Object.keys(p.stars).reduce(function (s, k) { return s + p.stars[k]; }, 0); }
  function cbHp(i) { var b = CB_BOSSES[i]; return Math.round((180 + 24 * i) * (b.mech.indexOf("glass") !== -1 ? 0.7 : 1)); }
  function cbEquipped(p, key) {
    var total = 0, flags = {};
    ["weapon", "armor", "charm"].forEach(function (slot) {
      var g = cbGear(p.equip[slot]);
      if (!g) return;
      if (typeof g[key] === "number") total += g[key];
      if (g[key] === true) flags[key] = true;
      if (key === "start" && g.start) g.start.forEach(function (k) { flags[k] = (flags[k] || 0) + 1; });
    });
    return key === "start" ? flags : key === "forgive" ? !!flags.forgive : total;
  }

  /* ------------------------------- Setup ------------------------------- */

  function cbFillSetup() {
    var p = state.gameData.boss;
    var sel = byId("boss-mode");
    sel.textContent = "";
    var add = function (parent, v, label, disabled) {
      var o = document.createElement("option");
      o.value = v; o.textContent = label; o.disabled = !!disabled;
      parent.appendChild(o);
    };
    add(sel, "endless", "Endless (the classic mode)");
    CB_WORLDS.forEach(function (w, wi) {
      var grp = document.createElement("optgroup");
      grp.label = "World " + (wi + 1) + ": " + w.name;
      CB_BOSSES.filter(function (b) { return b.world === wi; }).forEach(function (b) {
        var open = cbUnlocked(p, b.index);
        add(grp, "c" + b.index, (wi + 1) + "-" + (b.slot + 1) + " " + b.name + (p.stars[b.index] ? "  " + tdStarText(p.stars[b.index]) : "") + (open ? "" : " (locked)"), !open);
      });
      sel.appendChild(grp);
    });
    var all = cbAllCleared(p);
    add(sel, "gauntlet", "Gauntlet: all 25 bosses in a row" + (p.gauntletBest ? " (best: " + p.gauntletBest + ")" : "") + (all ? "" : " (locked)"), !all);
    var want = p.last || (Object.keys(state.highScores).some(function (k) { return k.indexOf("boss:") === 0; }) ? "endless" : "");
    if (!sel.querySelector('option[value="' + want + '"]:not([disabled])')) {
      // Default to the first boss without stars.
      var next = CB_BOSSES.filter(function (b) { return !p.stars[b.index]; })[0];
      want = next && cbUnlocked(p, next.index) ? "c" + next.index : "endless";
    }
    sel.value = want;
    cbSyncSetup();
  }

  function cbSyncSetup() {
    var p = state.gameData.boss;
    var v = byId("boss-mode").value;
    var info = [];
    if (v === "endless") info.push("Bosses keep coming and get tougher. Gear isn't used here, so scores stay comparable.");
    else if (v === "gauntlet") info.push("Every campaign boss in a row with one set of hearts. You heal a heart after each world. Gear applies.");
    else {
      var b = CB_BOSSES[Number(v.slice(1))];
      info.push(b.name + " · " + cbHp(b.index) + " HP.");
      info.push(b.mech.length ? b.mech.map(function (m) { return CB_MECHANICS[m].name + ": " + CB_MECHANICS[m].desc; }).join(" ") : "No tricks: a good first fight.");
      var drop = CB_GEAR.filter(function (g) { return g.boss === b.index; })[0];
      if (drop) info.push(p.gear[drop.id] ? "Already dropped its " + drop.name + "." : "Drops gear the first time you beat it.");
    }
    if (v !== "endless") {
      var eq = ["weapon", "armor", "charm"].map(function (s) { var g = cbGear(p.equip[s]); return g ? g.name : null; }).filter(Boolean);
      info.push("Gear: " + (eq.length ? eq.join(", ") : "none equipped") + ".");
    }
    byId("boss-info").textContent = info.join(" ");
  }

  function openArmory() {
    renderArmory();
    byId("armory-modal").classList.remove("hidden");
    byId("armory-close-btn").focus();
  }
  function closeArmory() {
    byId("armory-modal").classList.add("hidden");
    cbSyncSetup();
  }
  function renderArmory() {
    var p = state.gameData.boss;
    byId("armory-stars").textContent = cbTotalStars(p) + " of 75 stars";
    var list = byId("armory-list");
    list.textContent = "";
    CB_GEAR.forEach(function (g) {
      var owned = !!p.gear[g.id];
      var worn = p.equip[g.slot] === g.id;
      var from = CB_BOSSES[g.boss];
      list.appendChild(shopCard(g.name + " (" + g.slot + ")", owned ? cbGearText(g) : "Dropped by " + from.name + " (" + (from.world + 1) + "-" + (from.slot + 1) + ")",
        owned ? (worn ? "Equipped" : "In your bag") : "Not found yet", worn ? "Unequip" : owned ? "Equip" : "Locked", owned, function () {
          if (!purchaseAllowed()) return;
          p.equip[g.slot] = worn ? null : g.id;
          persistCompleted();
          renderArmory();
        }, worn ? "equipped" : ""));
    });
  }

  /* -------------------------------- Fight -------------------------------- */

  function cbActive() { return game && game.id === "boss" && game.campaign ? game.campaign : null; }
  function cbCurrent() { var cp = cbActive(); return cp ? CB_BOSSES[game.boss.index] : null; }
  function cbHas(m) { var b = cbCurrent(); return !!(b && b.mech.indexOf(m) !== -1); }

  function cbStartBoss(i) {
    var g = game, cp = g.campaign;
    g.boss.index = i;
    g.boss.max = cbHp(i);
    g.boss.hp = g.boss.max;
    g.boss.shields = bossShieldPlan(i, true);
    cp.shield = null;
    cp.shieldUsed = false;
    cp.forgiven = false;
    cp.heartsAtStart = g.hearts;
    g.bossLost = 0;
  }

  /* Damage from a correct answer, after armor and shields. Returns
     { dmg, note }. */
  function cbDamage(raw, speed) {
    var g = game, cp = g.campaign;
    var note = "";
    var dmg = raw * (1 + cbEquipped(g.profile, "dmg"));
    if (cp.shield) {
      cp.shield.streak++;
      if (cp.shield.streak >= 3) { cp.shield = null; note = " The ward shatters!"; }
      else note = " The ward holds (" + cp.shield.streak + "/3).";
      return { dmg: 0, note: note };
    }
    if (cbHas("armor") && speed < 0.5) { dmg *= 0.7; note = " Armor softens the slow hit."; }
    dmg = Math.round(dmg);
    // (The ward only goes up from a hit that reaches its health, not a shield layer.)
    if (cbHas("shield") && !cp.shieldUsed && !(g.boss.shields && g.boss.shields.length) && g.boss.hp - dmg <= g.boss.max / 2 && g.boss.hp - dmg > 0) {
      cp.shieldUsed = true;
      cp.shield = { streak: 0 };
      note += " It raises a ward! Get 3 in a row to break it.";
    }
    return { dmg: dmg, note: note };
  }

  /* A miss. Returns the extra feedback text; adjusts hearts. */
  function cbMiss() {
    var g = game, cp = g.campaign;
    var notes = [];
    if (cp.shield) cp.shield.streak = 0;
    if (cbEquipped(g.profile, "forgive") && !cp.forgiven) {
      cp.forgiven = true;
      g.hearts = Math.min(maxHearts(), g.hearts + 1); // the generic miss took one
      g.bossLost = Math.max(0, (g.bossLost || 0) - 1);
      notes.push("Your armor absorbs the first miss.");
    } else if (cbHas("glass")) {
      if (g.hearts > 0) g.bossLost = (g.bossLost || 0) + 1;
      g.hearts = Math.max(0, g.hearts - 1);
      notes.push("A crushing blow: 2 hearts lost.");
    }
    if (cbHas("heal")) {
      g.boss.hp = Math.min(g.boss.max, g.boss.hp + Math.round(g.boss.max * 0.12));
      notes.push("It leeches 12% health.");
    }
    return notes.join(" ");
  }

  function cbAfterQuestion() {
    var g = game;
    if (cbHas("regen") && g.boss.hp > 0) g.boss.hp = Math.min(g.boss.max, g.boss.hp + Math.round(g.boss.max * 0.03));
  }

  function cbStatusText() {
    var g = game, cp = g.campaign, b = cbCurrent();
    var bits = ["World " + (b.world + 1) + "-" + (b.slot + 1)];
    if (cp.mode === "gauntlet") bits.push("Gauntlet " + (cp.beaten + 1) + " of 25");
    if (b.mech.length) bits.push(b.mech.map(function (m) { return CB_MECHANICS[m].name; }).join(", "));
    if (cp.shield) bits.push("Ward up: " + cp.shield.streak + "/3");
    return bits.join(" · ");
  }

  /* After the boss falls. Returns true when the run ends. */
  function cbBossDefeated() {
    var g = game, cp = g.campaign, p = g.profile, b = cbCurrent();
    var lost = g.bossLost || 0; // hearts lost in this fight, healing aside
    var stars = lost <= 0 ? 3 : lost === 1 ? 2 : 1;
    var firstWin = !p.stars[b.index];
    p.stars[b.index] = Math.max(p.stars[b.index] || 0, stars);
    cp.lastStars = stars;
    var drop = CB_GEAR.filter(function (x) { return x.boss === b.index; })[0];
    if (drop && !p.gear[drop.id]) {
      p.gear[drop.id] = true;
      if (!p.equip[drop.slot] || (cbGear(p.equip[drop.slot]) && CB_GEAR.indexOf(cbGear(p.equip[drop.slot])) < CB_GEAR.indexOf(drop))) p.equip[drop.slot] = drop.id;
      cp.drop = drop;
      notify("Gear found: " + drop.name + " (" + cbGearText(drop) + "). It's equipped.");
    }
    if (firstWin && b.index < 24) notify("Unlocked: " + CB_BOSSES[b.index + 1].name + " (" + (CB_BOSSES[b.index + 1].world + 1) + "-" + (CB_BOSSES[b.index + 1].slot + 1) + ").");
    if (firstWin && b.index === 24) notify("Campaign cleared! The Gauntlet is open.");
    if (firstWin && b.slot === 4) addXp(150, true);
    cp.beaten++;
    if (cp.mode === "gauntlet") {
      p.gauntletBest = Math.max(p.gauntletBest, cp.beaten);
      g.score = cp.beaten;
      if (b.index < 24) {
        if (b.slot === 4) g.hearts = Math.min(maxHearts(), g.hearts + 1);
        return false;
      }
    }
    cp.won = true;
    if (cp.mode === "single" && firstWin && b.index < 24) p.last = "c" + (b.index + 1); // setup offers the next boss
    return true;
  }

  GAME_HOOKS.boss = {
    keepBest: true,
    // Minigames start from the second boss and grow with each world (campaign) or every 4 bosses (endless).
    minigame: {
      level: function () {
        var g = game;
        if (g.campaign) { var b = CB_BOSSES[g.boss.index]; return g.boss.index === 0 ? 0 : 1 + b.world + (b.slot === 4 ? 1 : 0); }
        return g.boss.index === 0 ? 0 : 1 + Math.floor(g.boss.index / 4);
      },
      result: function (won) {
        var g = game;
        if (won) { if (g.current) g.current.mgBonus = 1.25; return "Your answer will hit 25% harder."; }
        g.combo = 0;
        g.boss.hp = Math.min(g.boss.max, g.boss.hp + Math.round(g.boss.max * 0.05));
        renderBossHp();
        return "Combo broken, and the boss heals 5%.";
      }
    },
    setupPanel: "game-boss-options",
    shopLabel: "Armory",
    openShop: function () { openArmory(); },
    setupOpened: function () { cbFillSetup(); },
    readSetup: function () { return { mode: byId("boss-mode").value }; },
    tileLines: function () {
      var p = state.gameData.boss;
      var lines = ["Campaign: " + cbTotalStars(p) + " of 75 stars"];
      if (p.gauntletBest) lines.push("Gauntlet best: " + p.gauntletBest + " bosses");
      return lines;
    },
    begin: function (g, setup) {
      var p = g.profile = state.gameData.boss;
      var mode = setup.extra && setup.extra.mode || "endless";
      p.last = mode;
      if (mode === "endless") return;
      var idx = mode === "gauntlet" ? 0 : Number(mode.slice(1));
      if (mode === "gauntlet" ? !cbAllCleared(p) : !(idx >= 0 && idx < 25 && cbUnlocked(p, idx))) { p.last = "endless"; return; }
      g.campaign = { mode: mode === "gauntlet" ? "gauntlet" : "single", beaten: 0 };
      g.maxHearts = MAX_HEARTS + cbEquipped(p, "hearts");
      g.hearts = g.maxHearts;
      var start = cbEquipped(p, "start");
      Object.keys(start).forEach(function (k) { if (g.powerups[k] !== undefined) g.powerups[k] += start[k]; });
      cbStartBoss(idx);
    },
    thinkAdjust: function () {
      var cp = cbActive();
      if (!cp) return 0;
      var t = cbEquipped(game.profile, "think");
      if (cbHas("haste")) t -= 1000;
      if (cbHas("rage") && game.boss.hp < game.boss.max / 3) t -= 1500;
      if (cbHas("fog")) t += 1000;
      return t;
    },
    resultTitle: function (g) {
      var cp = g.campaign;
      if (!cp) return ": game over";
      if (cp.mode === "gauntlet") return cp.won ? ": Gauntlet conquered!" : ": Gauntlet over";
      return cp.won ? ": " + CB_BOSSES[g.boss.index].name + " defeated!" : ": defeated by " + CB_BOSSES[g.boss.index].name;
    },
    resultRows: function (g) {
      var cp = g.campaign;
      var acc = ["Accuracy", g.answered ? Math.round(100 * g.correct / g.answered) + "%" : "—"];
      if (!cp) return [["Score", fmtScore(g.score)], ["Bosses beaten", String(g.boss.defeated)], ["Best streak", String(g.bestStreak)], acc];
      if (cp.mode === "gauntlet") return [["Bosses beaten", cp.beaten + " of 25"], ["Best", String(g.profile.gauntletBest)], ["Best streak", String(g.bestStreak)], acc];
      return [["Boss", CB_BOSSES[g.boss.index].name], ["Stars", cp.won ? tdStarText(cp.lastStars) : "—"],
        ["Gear found", cp.drop ? cp.drop.name : "—"], ["Best streak", String(g.bestStreak)], acc];
    }
  };

