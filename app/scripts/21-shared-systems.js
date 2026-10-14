  /* ======================== Shared game systems ========================
     Levels (1-30) with an unlock track, session challenges, achievements,
     run modifiers and per-game reset. Progress lives in
     state.gameData.progress[gameId] = { xp, stats, ach, challenges }.
     Clean runs never touch it. */

  var MAX_LEVEL = 30;
  /* About 100 XP for level 2, ~900 for level 5 and ~35,000 for level 30:
     a 15-minute session earns roughly 1,500-2,500 XP, so the track takes
     around 15-20 sessions. */
  function xpToReach(level) { return level <= 1 ? 0 : Math.round(40 * Math.pow(level - 1, 2) + 60 * (level - 1)); }
  function levelForXp(xp) {
    var lvl = 1;
    while (lvl < MAX_LEVEL && xp >= xpToReach(lvl + 1)) lvl++;
    return lvl;
  }

  var MODIFIERS = [
    { id: "marathon", name: "Marathon", desc: "+2 s thinking time, rewards ×0.75", lvl: 2, think: 2000, reward: 0.75 },
    { id: "golden", name: "Golden hour", desc: "Rewards ×2", lvl: 3, reward: 2 },
    { id: "fog", name: "Fog", desc: "−1.5 s thinking time, rewards ×1.5", lvl: 6, think: -1500, reward: 1.5 },
    { id: "lucky", name: "Lucky streak", desc: "A power-up every 4 in a row instead of 5", lvl: 8, games: ["boss", "survival"], powerupEvery: 4 },
    { id: "sharp", name: "Sharp eyes", desc: "Every question uses hard wrong answers, rewards ×1.4", lvl: 10, forceHard: true, reward: 1.4 },
    { id: "scholar", name: "Scholar", desc: "Double XP", lvl: 15, xp: 2 }
  ];

  /* Unlock tracks. Old games currently unlock modifiers; their bigger
     content arrives in a later batch. */
  function modifierUnlocks(id) {
    return MODIFIERS.filter(function (m) { return !m.games || m.games.indexOf(id) !== -1; })
      .map(function (m) { return { lvl: m.lvl, label: "Modifier: " + m.name }; });
  }
  var UNLOCKS = {
    boss: modifierUnlocks("boss"),
    survival: modifierUnlocks("survival"),
    blitz: [
      { lvl: 3, key: "sprint", label: "Variant: 30-second Sprint" },
      { lvl: 6, key: "marathon", label: "Variant: 120-second Marathon" },
      { lvl: 9, key: "sudden", label: "Variant: Sudden Death" },
      { lvl: 12, key: "tfonly", label: "Variant: True/False only" }
    ].concat(modifierUnlocks("blitz")),
    fishing: modifierUnlocks("fishing"),
    tycoon: [
      { lvl: 1, key: "overtime", label: "Overtime power-up" },
      { lvl: 2, key: "inspector", label: "Inspector power-up" },
      { lvl: 4, key: "electronics", label: "Product line: Electronics" },
      { lvl: 5, key: "contracts", label: "Contracts" },
      { lvl: 6, key: "guard", label: "Streak guard power-up" },
      { lvl: 8, key: "picker", label: "Staff: Picker" },
      { lvl: 10, key: "furniture", label: "Product line: Furniture" }, { lvl: 10, key: "express", label: "Express skip power-up" },
      { lvl: 12, key: "driver", label: "Staff: Driver" }, { lvl: 12, key: "wh2", label: "Second warehouse (Riverside)" },
      { lvl: 16, key: "manager", label: "Staff: Manager" },
      { lvl: 18, key: "hazmat", label: "Product line: Hazardous goods" },
      { lvl: 20, key: "insurance", label: "Insurance power-up" },
      { lvl: 22, key: "wh3", label: "Third warehouse (Summit Hub)" }
    ].concat(modifierUnlocks("tycoon")),
    td: [
      { lvl: 1, key: "arrow", label: "Arrow, Cannon and Frost towers" },
      { lvl: 4, key: "lightning", label: "Lightning tower" },
      { lvl: 6, key: "path4", label: "Upgrade paths to level 4" },
      { lvl: 8, key: "mortar", label: "Mortar tower" },
      { lvl: 10, key: "path5", label: "Upgrade paths to level 5" },
      { lvl: 12, key: "beacon", label: "Beacon tower" },
      { lvl: 16, key: "venom", label: "Venom tower" },
      { lvl: 20, key: "ballista", label: "Ballista tower" }
    ].concat(modifierUnlocks("td")),
    rally: [
      { lvl: 1, key: "hatch", label: "Hatchback and the Rookie Cup" },
      { lvl: 2, key: "trials", label: "Time trials" },
      { lvl: 3, key: "car2", label: "Car: Coupe" },
      { lvl: 6, key: "car3", label: "Car: Rally Wagon" },
      { lvl: 8, key: "tune4", label: "Tuning to level 4" },
      { lvl: 9, key: "car4", label: "Car: Roadster" },
      { lvl: 12, key: "car5", label: "Car: GT" },
      { lvl: 14, key: "tune5", label: "Tuning to level 5" },
      { lvl: 16, key: "car6", label: "Car: Rally Pro" },
      { lvl: 20, key: "car7", label: "Car: Hypercar" },
      { lvl: 25, key: "car8", label: "Car: Prototype" }
    ].concat(modifierUnlocks("rally")),
    delve: [
      { lvl: 1, key: "scholar", label: "Class: Scholar" },
      { lvl: 3, key: "rogue", label: "Class: Rogue" },
      { lvl: 7, key: "knight", label: "Class: Knight" },
      { lvl: 12, key: "alchemist", label: "Class: Alchemist" }
    ].concat(modifierUnlocks("delve"))
  };

  function progressFor(id) {
    var all = state.gameData.progress || (state.gameData.progress = {});
    if (!all[id]) all[id] = { xp: 0, stats: {}, ach: {}, challenges: null };
    return all[id];
  }
  function playerLevel(id) { return levelForXp(progressFor(id).xp); }
  function isUnlocked(id, key) {
    var list = UNLOCKS[id] || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return playerLevel(id) >= list[i].lvl;
    return true;
  }
  function unlockLevelOf(id, key) {
    var list = UNLOCKS[id] || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].lvl;
    return 1;
  }

  /* ----------------------------- Challenges ----------------------------- */

  
  var CHALLENGES = [
    { id: "streak", text: "Get a {n}-answer streak", event: "streak", mode: "max", params: [5, 10, 15] },
    { id: "correct", text: "Answer {n} questions correctly", event: "correct", mode: "count", params: [15, 30, 60] },
    { id: "fast", text: "Answer {n} correctly with more than half the timer left", event: "fast", mode: "count", params: [8, 15, 25], games: ["boss", "survival", "fishing", "tycoon", "td", "rally"] },
    { id: "acc", text: "Finish a run with at least {n}% accuracy (10+ answers)", event: "runacc", mode: "max", params: [80, 90, 100] },
    { id: "runs", text: "Finish {n} runs", event: "run", mode: "count", params: [2, 3, 5] },
    { id: "bosses", text: "Defeat {n} bosses", event: "boss", mode: "count", params: [2, 4, 8], games: ["boss"] },
    { id: "flawless", text: "Defeat a boss without losing a heart", event: "flawless", mode: "count", params: [1], games: ["boss"] },
    { id: "bossreach", text: "Reach boss {n} in one run", event: "bossreach", mode: "max", params: [3, 5, 7], games: ["boss"] },
    { id: "survive", text: "Reach {n} correct answers in one Survival run", event: "survivebest", mode: "max", params: [15, 30, 50], games: ["survival"] },
    { id: "heal", text: "Use {n} power-ups", event: "powerup", mode: "count", params: [2, 4], games: ["boss", "survival"] },
    { id: "blitzscore", text: "Score {n} points in one Blitz round", event: "blitzscore", mode: "max", params: [150, 250, 400], games: ["blitz"] },
    { id: "blitzclean", text: "Finish a Blitz round with no misses (8+ answers)", event: "blitzclean", mode: "count", params: [1], games: ["blitz"] },
    { id: "rare", text: "Catch {n} rare or legendary fish", event: "rarefish", mode: "count", params: [2, 4, 8], games: ["fishing"] },
    { id: "legend", text: "Catch a legendary fish", event: "legendfish", mode: "count", params: [1], games: ["fishing"] },
    { id: "coins", text: "Earn {n} coins in one session", event: "coins", mode: "max", params: [300, 800, 2000], games: ["fishing"] },
    { id: "bounty", text: "Complete {n} bounties", event: "bounty", mode: "count", params: [1, 2], games: ["fishing"] },
    { id: "ship", text: "Ship {n} orders", event: "ship", mode: "count", params: [10, 20, 40], games: ["tycoon"] },
    { id: "cleanday", text: "Finish a day with no returns or late orders", event: "cleanday", mode: "count", params: [1], games: ["tycoon"] },
    { id: "bigcrate", text: "Ship an order with a ×{n} or bigger multiplier", event: "crate", mode: "max", params: [2, 5, 10], games: ["tycoon"] },
    { id: "waves", text: "Clear {n} waves", event: "wave", mode: "count", params: [5, 10, 20], games: ["td"] },
    { id: "nolives", text: "Finish a map without losing a life", event: "perfectmap", mode: "count", params: [1], games: ["td"] },
    { id: "upgrade", text: "Upgrade a tower path to level {n}", event: "pathlevel", mode: "max", params: [2, 3, 4], games: ["td"] },
    { id: "towers", text: "Build {n} towers", event: "build", mode: "count", params: [4, 8], games: ["td"] },
    { id: "top2", text: "Finish a race in the top two", event: "top2", mode: "count", params: [1, 2], games: ["rally"] },
    { id: "win", text: "Win {n} races", event: "racewin", mode: "count", params: [1, 2, 3], games: ["rally"] },
    { id: "nitro", text: "Use nitro {n} times", event: "nitro", mode: "count", params: [3, 6, 10], games: ["rally"] },
    { id: "trial", text: "Earn a time-trial medal", event: "medal", mode: "count", params: [1], games: ["rally"] },
    { id: "dvkills", text: "Defeat {n} monsters", event: "delvekill", mode: "count", params: [5, 10, 20], games: ["delve"] },
    { id: "dvdepth", text: "Reach floor {n} in one run", event: "delvefloor", mode: "max", params: [3, 5, 8], games: ["delve"] },
    { id: "dvboss", text: "Defeat a biome boss", event: "delveboss", mode: "count", params: [1], games: ["delve"] }
  ];
  var APP_SESSION = String(Date.now());

  function challengeTemplate(id) { for (var i = 0; i < CHALLENGES.length; i++) if (CHALLENGES[i].id === id) return CHALLENGES[i]; return null; }
  function challengeText(ch) { var t = challengeTemplate(ch.t); return t ? t.text.replace("{n}", ch.n) : ""; }

  /* Three challenges per game per app session (kept until the app restarts
     or all three are done). */
  function currentChallenges(id) {
    var pr = progressFor(id);
    var set = pr.challenges;
    var allDone = set && set.list.every(function (c) { return c.done; });
    if (!set || set.session !== APP_SESSION || allDone) {
      var pool = CHALLENGES.filter(function (t) { return !t.games || t.games.indexOf(id) !== -1; });
      var picks = seededShuffle(pool, (Date.now() >>> 0)).slice(0, 3);
      set = pr.challenges = { session: APP_SESSION, list: picks.map(function (t) {
        var i = Math.floor(Math.random() * t.params.length);
        return { t: t.id, n: t.params[i], tier: i, p: 0, done: false };
      }) };
    }
    return set.list;
  }

  function challengeReward(id, ch) {
    var xp = 80 + 60 * ch.tier;
    var extra = "";
    if (id === "fishing") extra = (100 + 150 * ch.tier) + " coins";
    if (id === "tycoon") extra = "$" + (100 + 150 * ch.tier);
    if (id === "rally") extra = (150 + 200 * ch.tier) + " credits";
    if (id === "delve") extra = (15 + 15 * ch.tier) + " lanterns";
    return { xp: xp, extra: extra };
  }

  /* ----------------------------- Achievements ----------------------------- */

  function commonAchievements(id, name) {
    return [
      { id: id + "-first", name: "First run", desc: "Finish a " + name + " run", stat: "runs", target: 1 },
      { id: id + "-runs", name: "Regular", desc: "Finish 25 " + name + " runs", stat: "runs", target: 25 },
      { id: id + "-c100", name: "Hundred", desc: "Answer 100 questions correctly in " + name, stat: "correct", target: 100 },
      { id: id + "-c1000", name: "Thousand", desc: "Answer 1,000 questions correctly in " + name, stat: "correct", target: 1000 },
      { id: id + "-s15", name: "On fire", desc: "Reach a 15-answer streak", stat: "bestStreak", target: 15 },
      { id: id + "-s30", name: "Unstoppable", desc: "Reach a 30-answer streak", stat: "bestStreak", target: 30 },
      { id: id + "-l10", name: "Seasoned", desc: "Reach level 10", stat: "level", target: 10 },
      { id: id + "-l30", name: "Master", desc: "Reach level 30", stat: "level", target: 30 }
    ];
  }
  var ACHIEVEMENTS = {
    boss: commonAchievements("boss", "Boss Battle").concat([
      { id: "boss-b10", name: "Monster hunter", desc: "Defeat 10 bosses", stat: "bosses", target: 10 },
      { id: "boss-b100", name: "Legend slayer", desc: "Defeat 100 bosses", stat: "bosses", target: 100 },
      { id: "boss-deep", name: "Deep run", desc: "Reach boss 6 in one run", stat: "bossReach", target: 6 },
      { id: "boss-flaw", name: "Untouched", desc: "Defeat a boss without losing a heart", stat: "flawless", target: 1 },
      { id: "boss-world", name: "World tour", desc: "Beat every campaign boss", stat: "cbCleared", target: 25 },
      { id: "boss-stars", name: "Perfectionist", desc: "Earn all 75 campaign stars", stat: "cbStars", target: 75 },
      { id: "boss-gear", name: "Fully equipped", desc: "Find all 15 pieces of gear", stat: "cbGear", target: 15 },
      { id: "boss-gauntlet", name: "Gauntlet", desc: "Beat all 25 bosses in one Gauntlet", stat: "gauntlet", target: 25 }]),
    survival: commonAchievements("survival", "Survival").concat([
      { id: "surv-50", name: "Survivor", desc: "Reach 50 correct in one run", stat: "survivalBest", target: 50 },
      { id: "surv-100", name: "Iron will", desc: "Reach 100 correct in one run", stat: "survivalBest", target: 100 },
      { id: "surv-200", name: "Endurance", desc: "Reach 200 correct in one run (every perk unlocked)", stat: "survivalBest", target: 200 },
      { id: "surv-eclipse", name: "Through the eclipse", desc: "Reach the Eclipse biome (105 correct)", stat: "survivalBest", target: 105 }]),
    blitz: commonAchievements("blitz", "Blitz").concat([
      { id: "blitz-300", name: "Speed reader", desc: "Score 300 in one round", stat: "blitzBest", target: 300 },
      { id: "blitz-600", name: "Lightning", desc: "Score 600 in one round", stat: "blitzBest", target: 600 },
      { id: "blitz-clean", name: "Clean sweep", desc: "Finish a round with no misses (8+ answers)", stat: "blitzClean", target: 1 },
      { id: "blitz-gold", name: "Gold league", desc: "Reach the Gold league", stat: "bzTier", target: 2 },
      { id: "blitz-master", name: "Grandmaster", desc: "Reach the Master league", stat: "bzTier", target: 5 }]),
    fishing: commonAchievements("fishing", "Fishing").concat([
      { id: "fish-leg", name: "Legendary angler", desc: "Catch a legendary fish", stat: "legendFish", target: 1 },
      { id: "fish-all", name: "Complete collection", desc: "Catch all 35 species", stat: "species", target: 35 },
      { id: "fish-bounty", name: "Bounty hunter", desc: "Complete 10 bounties", stat: "bounties", target: 10 },
      { id: "fish-deep", name: "Deep Sea", desc: "Unlock the Deep Sea", stat: "locations", target: 5 }]),
    tycoon: commonAchievements("tycoon", "Warehouse Tycoon").concat([
      { id: "ty-10k", name: "First $10k", desc: "Have $10,000 in the bank", stat: "money", target: 10000 },
      { id: "ty-days", name: "Veteran", desc: "Run 30 days", stat: "days", target: 30 },
      { id: "ty-x10", name: "High roller", desc: "Ship an order at ×10 or more", stat: "bestCrate", target: 10 },
      { id: "ty-region", name: "Regional distributor", desc: "Own all three warehouses", stat: "warehouses", target: 3 },
      { id: "ty-contracts", name: "Reliable partner", desc: "Complete 5 contracts", stat: "contracts", target: 5 }]),
    td: commonAchievements("td", "Hold the Line").concat([
      { id: "td-w100", name: "Wall", desc: "Clear 100 waves", stat: "waves", target: 100 },
      { id: "td-stars", name: "Star general", desc: "Earn 36 stars (every map, 3 stars)", stat: "stars", target: 36 },
      { id: "td-night", name: "Nightmare", desc: "Clear a map on Nightmare", stat: "nightmares", target: 1 },
      { id: "td-p5", name: "Specialist", desc: "Upgrade a tower path to level 5", stat: "maxPath", target: 5 }]),
    delve: commonAchievements("delve", "Deep Delve").concat([
      { id: "dv-k100", name: "Monster slayer", desc: "Defeat 100 monsters", stat: "kills", target: 100 },
      { id: "dv-caves", name: "Into the caves", desc: "Reach the Fungal Caves", stat: "deepest", target: 6 },
      { id: "dv-core", name: "Heat of the Core", desc: "Reach The Core", stat: "deepest", target: 21 },
      { id: "dv-win", name: "Conqueror", desc: "Defeat the Heart of the Core", stat: "delveWins", target: 1 },
      { id: "dv-codex", name: "Bestiary", desc: "Defeat every kind of monster", stat: "codexMonsters", target: 30 }]),
    rally: commonAchievements("rally", "Quiz Rally").concat([
      { id: "rally-win", name: "Winner", desc: "Win a race", stat: "wins", target: 1 },
      { id: "rally-cups", name: "Champion", desc: "Win all 5 cups", stat: "cups", target: 5 },
      { id: "rally-gold", name: "Gold rush", desc: "Earn 20 gold time-trial medals", stat: "golds", target: 20 },
      { id: "rally-cars", name: "Collector", desc: "Own all 8 cars", stat: "cars", target: 8 }])
  };

  /* ----------------------------- Events ----------------------------- */

  /* Every game reports what happens through gameEvent(); this updates
     stats, challenges and achievements for normal (non-clean) runs. */
  function gameEvent(type, data) {
    var g = game;
    if (!g || g.clean || g.info.noProgress) return;
    data = data || {};
    var id = g.id;
    var pr = progressFor(id);
    var st = pr.stats;
    var n = typeof data.n === "number" ? data.n : 1;
    var value = typeof data.value === "number" ? data.value : n;
    var statMap = {
      correct: ["correct", "add"], run: ["runs", "add"], streak: ["bestStreak", "max"], boss: ["bosses", "add"],
      flawless: ["flawless", "add"], bossreach: ["bossReach", "max"], survivebest: ["survivalBest", "max"],
      blitzscore: ["blitzBest", "max"], blitzclean: ["blitzClean", "add"], legendfish: ["legendFish", "add"],
      ship: ["shipped", "add"], crate: ["bestCrate", "max"], wave: ["waves", "add"], pathlevel: ["maxPath", "max"],
      racewin: ["wins", "add"], bounty: ["bounties", "add"], delvekill: ["kills", "add"], delveboss: ["delveBosses", "add"], delvefloor: ["deepest", "max"], delvewin: ["delveWins", "add"]
    };
    if (statMap[type]) {
      var key = statMap[type][0];
      st[key] = statMap[type][1] === "add" ? (st[key] || 0) + n : Math.max(st[key] || 0, value);
    }
    // challenges
    (pr.challenges && pr.challenges.session === APP_SESSION ? pr.challenges.list : []).forEach(function (ch) {
      if (ch.done) return;
      var t = challengeTemplate(ch.t);
      if (!t || t.event !== type) return;
      ch.p = t.mode === "count" ? ch.p + n : Math.max(ch.p, value);
      if (ch.p >= ch.n) {
        ch.done = true;
        var rw = challengeReward(id, ch);
        grantChallengeReward(id, rw);
        notify("Challenge complete: " + challengeText(ch) + ". +" + rw.xp + " XP" + (rw.extra ? ", +" + rw.extra : "") + ".");
      }
    });
    checkAchievements(id);
  }

  function grantChallengeReward(id, rw) {
    var g = game;
    addXp(rw.xp, true);
    if (id === "fishing") g.profile.coins += parseInt(rw.extra, 10);
    if (id === "tycoon") g.profile.money += parseInt(rw.extra.replace("$", ""), 10);
    if (id === "rally" && g.profile) g.profile.credits += parseInt(rw.extra, 10);
    if (id === "delve" && g.profile) g.profile.lanterns += parseInt(rw.extra, 10);
  }

  /* Stats computed from saved profiles rather than counted. */
  function derivedStats(id) {
    var st = progressFor(id).stats;
    st.level = playerLevel(id);
    var gd = state.gameData;
    if (id === "fishing") {
      var fp = gd.fishing;
      st.species = Object.keys(fp.caught).length;
      st.locations = Object.keys(fp.locations).length;
    } else if (id === "tycoon") {
      var tp = gd.tycoon;
      st.money = Math.max(st.money || 0, tp.money);
      st.days = Math.max(0, tp.day - 1);
      st.warehouses = Object.keys(tp.warehouses || {}).length;
      st.contracts = tp.contractsDone || 0;
    } else if (id === "blitz" && gd.blitz) {
      st.bzTier = gd.blitz.bestTier;
    } else if (id === "survival" && gd.survival) {
      st.survivalBest = Math.max(st.survivalBest || 0, gd.survival.best);
    } else if (id === "delve" && gd.delve) {
      st.codexMonsters = Object.keys(gd.delve.codex.monsters).length;
      st.deepest = Math.max(st.deepest || 0, gd.delve.deepest);
    } else if (id === "boss" && gd.boss) {
      st.cbCleared = Object.keys(gd.boss.stars).length;
      st.cbStars = cbTotalStars(gd.boss);
      st.cbGear = Object.keys(gd.boss.gear).length;
      st.gauntlet = gd.boss.gauntletBest;
    } else if (id === "td" && gd.td) {
      st.stars = Object.keys(gd.td.stars || {}).reduce(function (s, k) { return s + (gd.td.stars[k] || 0); }, 0);
      st.nightmares = Object.keys(gd.td.cleared || {}).filter(function (k) { return /:nightmare$/.test(k); }).length;
    } else if (id === "rally" && gd.rally) {
      st.cups = Object.keys(gd.rally.cupsWon || {}).length;
      st.golds = Object.keys(gd.rally.medals || {}).filter(function (k) { return gd.rally.medals[k] === "gold"; }).length;
      st.cars = Object.keys(gd.rally.cars || {}).length;
    }
    return st;
  }

  function checkAchievements(id) {
    var pr = progressFor(id);
    var st = derivedStats(id);
    (ACHIEVEMENTS[id] || []).forEach(function (a) {
      if (!pr.ach[a.id] && (st[a.stat] || 0) >= a.target) {
        pr.ach[a.id] = new Date().toISOString().slice(0, 10);
        notify("Achievement unlocked: " + a.name + "!");
      }
    });
  }

  /* XP: 10 per correct answer, +2/+5/+10 at streaks of 3/5/10. */
  function addXp(amount, raw) {
    var g = game;
    if (!g || g.clean || g.info.noProgress) return;
    var mult = raw ? 1 : (g.modifier && g.modifier.xp) || 1;
    var pr = progressFor(g.id);
    var before = playerLevel(g.id);
    pr.xp += Math.round(amount * mult);
    g.xpEarned = (g.xpEarned || 0) + Math.round(amount * mult);
    var after = playerLevel(g.id);
    if (after > before) {
      var newly = (UNLOCKS[g.id] || []).filter(function (u) { return u.lvl > before && u.lvl <= after; }).map(function (u) { return u.label; });
      notify(GAMES[g.id].name + " level " + after + "!" + (newly.length ? " Unlocked: " + newly.join(", ") + "." : ""));
      checkAchievements(g.id);
      persistCompleted();
    }
  }

  function xpForCorrect(combo) { return 10 + (combo >= 10 ? 10 : combo >= 5 ? 5 : combo >= 3 ? 2 : 0); }

  /* ----------------------------- Modifiers ----------------------------- */

  var offeredModifier = {};
  /* One roll per game per app session, so reopening setup can't fish for a better one.
     A level-up reroll is allowed so newly unlocked modifiers can show up. */
  var modifierRolledAt = {};
  function rollModifier(id) {
    var lvl = playerLevel(id);
    if (id in offeredModifier && modifierRolledAt[id] === lvl) return offeredModifier[id];
    modifierRolledAt[id] = lvl;
    var pool = MODIFIERS.filter(function (m) { return m.lvl <= lvl && (!m.games || m.games.indexOf(id) !== -1); });
    offeredModifier[id] = pool.length && Math.random() < 0.6 ? pool[Math.floor(Math.random() * pool.length)] : null;
    return offeredModifier[id];
  }

  /* The offered modifier, only if it's still allowed for this game at its
     current level (a reset or level change can make an old offer stale). */
  function eligibleModifier(id) {
    var m = offeredModifier[id];
    if (!m || modifierRolledAt[id] !== playerLevel(id)) return null;
    if (m.lvl > playerLevel(id) || (m.games && m.games.indexOf(id) === -1)) return null;
    return m;
  }

  /* ----------------------------- Setup panel ----------------------------- */

  function renderProgressPanel(id) {
    var box = byId("game-progress-panel");
    if (!box) return;
    var pr = progressFor(id);
    var lvl = playerLevel(id);
    var cur = xpToReach(lvl), next = xpToReach(lvl + 1);
    box.textContent = "";
    var head = document.createElement("div");
    head.className = "gp-head";
    var title = document.createElement("strong");
    title.textContent = "Level " + lvl + (lvl >= MAX_LEVEL ? " (max)" : "");
    var xpTxt = document.createElement("span");
    xpTxt.className = "gp-xp";
    xpTxt.textContent = lvl >= MAX_LEVEL ? fmtScore(pr.xp) + " XP" : fmtScore(pr.xp - cur) + " / " + fmtScore(next - cur) + " XP";
    head.appendChild(title);
    head.appendChild(xpTxt);
    box.appendChild(head);
    var track = document.createElement("div");
    track.className = "stat-track";
    var bar = document.createElement("div");
    bar.className = "stat-bar";
    bar.style.width = lvl >= MAX_LEVEL ? "100%" : (100 * (pr.xp - cur) / (next - cur)) + "%";
    track.appendChild(bar);
    box.appendChild(track);

    var upcoming = (UNLOCKS[id] || []).filter(function (u) { return u.lvl > lvl; }).slice(0, 3);
    var ul = document.createElement("p");
    ul.className = "gp-next";
    ul.textContent = upcoming.length ? "Next: " + upcoming.map(function (u) { return "Lv " + u.lvl + " " + u.label; }).join(" · ") : "Everything on this track is unlocked.";
    box.appendChild(ul);

    // Level on the left, challenges on the right.
    var leftCol = document.createElement("div");
    while (box.firstChild) leftCol.appendChild(box.firstChild);
    box.appendChild(leftCol);
    var rightCol = document.createElement("div");
    box.appendChild(rightCol);
    var chTitle = document.createElement("p");
    chTitle.className = "gp-sub";
    chTitle.textContent = "Session challenges";
    rightCol.appendChild(chTitle);
    currentChallenges(id).forEach(function (ch) {
      var row = document.createElement("div");
      row.className = "gp-challenge" + (ch.done ? " done" : "");
      var txt = document.createElement("span");
      txt.textContent = (ch.done ? "✓ " : "") + challengeText(ch);
      var prog = document.createElement("span");
      prog.className = "gp-prog";
      var rw = challengeReward(id, ch);
      prog.textContent = (ch.done ? "Done" : Math.min(ch.p, ch.n) + " / " + ch.n) + " · " + rw.xp + " XP" + (rw.extra ? " + " + rw.extra : "");
      row.appendChild(txt);
      row.appendChild(prog);
      rightCol.appendChild(row);
    });

    var mod = offeredModifier[id];
    var modRow = byId("game-modifier-row");
    modRow.classList.toggle("hidden", !mod);
    if (mod) {
      byId("game-modifier-text").textContent = mod.name + ": " + mod.desc;
      byId("game-modifier").checked = true;
    }
  }

  /* ----------------------------- Achievements page ----------------------------- */

  function renderAchievementsPage() {
    var wrap = byId("achievements-list");
    wrap.textContent = "";
    var got = 0, total = 0;
    GAME_ORDER.forEach(function (id) {
      var pr = progressFor(id);
      var st = derivedStats(id);
      var section = document.createElement("div");
      section.className = "ach-section";
      var h = document.createElement("h2");
      h.className = "qa-heading";
      var list = ACHIEVEMENTS[id] || [];
      var have = list.filter(function (a) { return pr.ach[a.id]; }).length;
      got += have; total += list.length;
      h.textContent = GAMES[id].name + " · " + have + " / " + list.length + " · Level " + playerLevel(id);
      section.appendChild(h);
      var grid = document.createElement("div");
      grid.className = "ach-grid";
      list.forEach(function (a) {
        var card = document.createElement("div");
        card.className = "ach-card" + (pr.ach[a.id] ? " got" : "");
        var t = document.createElement("strong");
        t.textContent = (pr.ach[a.id] ? "★ " : "") + a.name;
        var d = document.createElement("span");
        d.textContent = a.desc;
        var track = document.createElement("div");
        track.className = "stat-track";
        var bar = document.createElement("div");
        bar.className = "stat-bar";
        var v = Math.min(st[a.stat] || 0, a.target);
        bar.style.width = (100 * v / a.target) + "%";
        track.appendChild(bar);
        var p = document.createElement("span");
        p.className = "ach-prog";
        p.textContent = pr.ach[a.id] ? "Earned " + pr.ach[a.id] : fmtScore(v) + " / " + fmtScore(a.target);
        card.appendChild(t);
        card.appendChild(d);
        card.appendChild(track);
        card.appendChild(p);
        grid.appendChild(card);
      });
      section.appendChild(grid);
      wrap.appendChild(section);
    });
    byId("achievements-summary").textContent = got + " of " + total + " achievements earned for this bank.";
  }

  /* ----------------------------- Reset progress ----------------------------- */

  /* What a reset clears inside each game's own save, besides the shared
     level, unlocks, challenges, achievements, best scores and rating.
     Keep this in step with resetGameProgress below. */
  var RESET_SCOPE = {
    fishing: "your coins, rods, stat upgrades, locations, catch collection and bounty",
    tycoon: "your money, day, warehouses, upgrades, staff, contracts and milestones",
    td: "your map stars, cleared maps, endless best and any map saved mid-run",
    rally: "your credits, cars and tuning, cup results, medals, time-trial bests and any cup in progress",
    boss: "your campaign stars, gear and Gauntlet best",
    delve: "your lanterns, camp upgrades, shortcuts, gear, supplies, packed relics, relic codex, bestiary and any saved run",
    survival: "your best run and unlocked perks",
    blitz: "your league tier, wins and unlocked themes"
  };

  function resetGameProgress(id) {
    var gd = state.gameData;
    if (gd.progress) delete gd.progress[id];
    delete gd.ratings[id];
    if (gd.skill) delete gd.skill[id]; // the bots match a fresh rating too
    // Fields kept from a newer version go with the reset too.
    dropGameExtras(id);
    Object.keys(state.highScores).forEach(function (k) { if (k.indexOf(id + ":") === 0 || k.indexOf(id + "-") === 0) delete state.highScores[k]; });
    if (id === "fishing") gd.fishing = freshFishingProfile();
    if (id === "tycoon") gd.tycoon = freshTycoonProfile();
    if (id === "td") gd.td = freshTdProfile();
    if (id === "rally") gd.rally = freshRallyProfile();
    if (id === "boss") gd.boss = freshBossProfile();
    if (id === "delve") gd.delve = freshDelveProfile();
    if (id === "survival") gd.survival = freshSurvivalProfile();
    if (id === "blitz") gd.blitz = freshBlitzProfile();
    if (gd.rivals) delete gd.rivals[id]; // the rivals start over with you
    // F21: the offered modifier belongs to the old progress too.
    delete offeredModifier[id];
    delete modifierRolledAt[id];
    persistCompleted().then(function (ok) {
      if (ok) notify(GAMES[id].name + " progress reset.");
      else notifyError(GAMES[id].name + " progress was reset for now, but it couldn't be saved.");
    });
  }

