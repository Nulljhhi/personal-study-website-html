  /* ===================================================================
     GAMES
     Five games share one engine built on the quiz's choice builders and
     instant feedback: a question, a timer, a combo multiplier, missed
     questions coming back sooner, optional adaptive bots, and a results
     screen. Correct answers mark questions completed (same as Quiz).
     Saved per bank, in the same progress file as completed questions:
       highScores  best score per game + difficulty setting
       games       { ratings, fishing profile, tycoon profile }
     A "clean run" of Fishing or Tycoon uses a fresh profile and saves
     nothing (no profile, high score or rating changes).
     =================================================================== */

  var GAMES = {
    boss: {
      name: "Boss Battle",
      desc: "Defeat a series of bosses. Correct answers deal damage, faster answers hit harder, and misses cost a heart.",
      rules: "3 hearts. Each question has a timer that gets shorter with every boss. Streaks multiply your damage, and every 5 in a row earns a power-up.",
      hearts: true, powerups: true, perQuestionTimer: true
    },
    survival: {
      name: "Survival",
      desc: "One endless run. The timer shrinks with every correct answer. How long can you last?",
      rules: "3 hearts. The timer is your reading time plus a few seconds to think, and the thinking part gets shorter after every correct answer. Streaks multiply your points, and every 5 in a row earns a power-up.",
      hearts: true, powerups: true, perQuestionTimer: true
    },
    blitz: {
      name: "Blitz",
      desc: "Answer as many as you can in 60 seconds. A wrong answer costs 3 seconds.",
      rules: "60 seconds on the clock, no hearts. Faster answers and streaks score more. Each miss takes 3 seconds off the clock.",
      hearts: false, powerups: false, perQuestionTimer: false
    },
    fishing: {
      name: "Fishing",
      desc: "Cast, wait for a bite, and answer before the fish gets away. Sell your catch for coins to buy rods, upgrades and new spots.",
      rules: "A timed session. Press Cast (or Space), wait for a bite, then answer before the fish escapes. Harder questions hook rarer fish. Coins buy rods, stat upgrades and new locations with more valuable fish.",
      hearts: false, powerups: false, perQuestionTimer: true, progression: true
    },
    tycoon: {
      name: "Warehouse Tycoon",
      desc: "Run a warehouse: every order is a question. Ship orders for profit and spend it on upgrades between days.",
      rules: "Each day brings a batch of orders, each with a timer. A correct answer ships the order; a wrong one means a return and a penalty. After each day you pay overhead and can buy upgrades.",
      hearts: false, powerups: false, perQuestionTimer: true, progression: true
    },
    td: {
      name: "Hold the Line",
      desc: "Tower defense: every correct answer fires your towers. Build, upgrade and hold 12 maps across 4 regions.",
      rules: "Each question is one step. A correct answer fires every tower (faster answers and streaks hit harder), then the enemies move. A miss fires nothing and the enemies surge. Gold from kills and waves buys and upgrades towers between and during waves.",
      hearts: false, powerups: false, perQuestionTimer: true
    },
    delve: {
      name: "Deep Delve",
      desc: "Crawl through 100 floors in 20 biomes of monsters, traps and treasure. Correct answers strike; misses let monsters hit back.",
      rules: "Pick rooms on each floor's map. In a fight, a correct answer hits the monster (fast answers hit harder) and a miss lets it hit you. Many monsters change how questions work. Relics bend the rules. When the run ends, some of your gold comes home as lanterns for permanent upgrades at camp.",
      hearts: false, powerups: false, perQuestionTimer: true, progression: true
    },
    garden: {
      name: "Study Garden",
      desc: "Spaced review as a garden.",
      rules: "",
      hearts: false, powerups: false, perQuestionTimer: true, noProgress: true
    },
    rally: {
      name: "Quiz Rally",
      desc: "Race three rivals. Correct answers give a burst of speed, streaks fill nitro, and misses spin you out.",
      rules: "The race runs in real time while you answer. A correct answer boosts your car (a fast one on a straight boosts it longer), streaks fill the nitro meter (press N), and a wrong answer spins you out. Questions dealt in a corner get less thinking time.",
      hearts: false, powerups: false, perQuestionTimer: true
    }
  };
  var GAME_ORDER = ["boss", "survival", "blitz", "fishing", "tycoon", "td", "rally", "delve"];
  /* Games built on hooks (Hold the Line, Quiz Rally) register here. */
  var GAME_HOOKS = {};
  function gameHooks(id) { return GAME_HOOKS[id || (game && game.id)] || null; }
  function onGameSetupOpened(id) { var hk = gameHooks(id); if (hk && hk.setupOpened) hk.setupOpened(); }
  function onGameEnded(g) { var hk = gameHooks(g.id); if (hk && hk.ended) hk.ended(g); }
  var GAME_FEEDBACK_MS = 1300;
  var BLITZ_FEEDBACK_MS = 650;
  var BLITZ_SECONDS = 60;
  var BLITZ_PENALTY_MS = 3000;
  var MAX_HEARTS = 3;
  function maxHearts() { return game && game.maxHearts || MAX_HEARTS; }
  var MAX_POWERUPS = 3;
  var FISHING_MIN_MINUTES = 1, FISHING_MAX_MINUTES = 120;
  function fishingMinutes(v) {
    if (v === "" || v === null || v === undefined) return 10;
    var n = Math.round(Number(v));
    return isFinite(n) ? clamp(n, FISHING_MIN_MINUTES, FISHING_MAX_MINUTES) : 10;
  }
  var LEVEL_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard" };
  var POWERUP_INFO = {
    fifty: { label: "50/50", key: "Q" },
    freeze: { label: "Freeze", key: "W" },
    heal: { label: "Heal", key: "E" }
  };

  var gameSetupFor = "boss";
  var game = null;
  var gameRunToken = 0;
  var gameQuitTo = "games";

  function scoreKey(id, diffMode, level, variant) {
    return id + (variant ? "-" + variant : "") + ":" + (diffMode === "rising" ? "rising" : level);
  }
  /* Numbers up to 999 show in full; bigger ones are shortened (1.25K,
     38.4M, 9.18T, then 1.2Qa and 3.4Qi) and anything past that switches to
     scientific notation (2.50e21), so huge Tycoon fortunes fit on buttons. */
  var SHORT_UNITS = ["", "K", "M", "B", "T", "Qa", "Qi"];
  function shortNumber(n) {
    n = Number(n || 0);
    if (!isFinite(n)) return n > 0 ? "∞" : "-∞";
    var a = Math.abs(n);
    var sign = n < 0 && a >= 0.5 ? "-" : "";
    if (a < 999.5) return sign + Math.round(a).toLocaleString();
    var e = Math.max(1, Math.floor(Math.log10(a) / 3));
    var v = a / Math.pow(1000, e);
    if (v >= 999.5) { e++; v /= 1000; }
    if (e >= SHORT_UNITS.length) {
      var exp = a.toExponential(2).split("e");
      return sign + exp[0] + "e" + Number(exp[1]);
    }
    var digits = v < 10 ? 2 : v < 100 ? 1 : 0;
    return sign + Number(v.toFixed(digits)).toString() + SHORT_UNITS[e];
  }
  function fmtScore(n) { return shortNumber(n); }
  function fmtMoney(n) { var s = shortNumber(Math.round(n)); return s.charAt(0) === "-" ? "-$" + s.slice(1) : "$" + s; }
  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ------------------------- Fishing data ------------------------- */

  var FISH_LOCATIONS = [
    { id: "pond", name: "Pond", price: 0, mult: 1, water: "#5aa6c8", species: [
      ["bluegill", "Bluegill", "common", 200], ["perch", "Yellow Perch", "common", 45], ["carp", "Mud Carp", "common", 95],
      ["koi", "Golden Koi", "rare", 40], ["pike", "Reed Pike", "rare", 130], ["moonkoi", "Moonscale Koi", "legendary", 270],
      ["dawnkoi", "Dawn Koi", "rare", 18, { time: ["morning"] }]] },
    { id: "river", name: "River", price: 1000, mult: 2, water: "#3f8fb5", species: [
      ["trout", "Brook Trout", "common", 15], ["chub", "River Chub", "common", 80], ["dace", "Silver Dace", "common", 210],
      ["salmon", "Red Salmon", "rare", 5], ["sturgeon", "Stone Sturgeon", "rare", 170], ["thunder", "Thunderfin", "legendary", 55],
      ["stormpike", "Storm Pike", "rare", 230, { weather: ["rain", "storm"] }]] },
    { id: "lake", name: "Lake", price: 4000, mult: 3.5, water: "#2f7aa6", species: [
      ["bass", "Largemouth Bass", "common", 105], ["walleye", "Walleye", "common", 50], ["crappie", "Crappie", "common", 290],
      ["muskie", "Muskie", "rare", 120], ["gar", "Spotted Gar", "rare", 30], ["glacier", "Glacier Pike", "legendary", 190],
      ["moonperch", "Moon Perch", "legendary", 250, { time: ["night"] }]] },
    { id: "coast", name: "Coast", price: 12000, mult: 6, water: "#2a6e9e", species: [
      ["mackerel", "Mackerel", "common", 220], ["snapper", "Red Snapper", "common", 0], ["flounder", "Flounder", "common", 35],
      ["tarpon", "Tarpon", "rare", 50], ["grouper", "Grouper", "rare", 25], ["coral", "Coral Emperor", "legendary", 300],
      ["sunray", "Sunray Wrasse", "rare", 48, { weather: ["sunny"], time: ["noon"] }]] },
    { id: "deep", name: "Deep Sea", price: 35000, mult: 10, water: "#1f4f80", species: [
      ["tuna", "Bluefin Tuna", "common", 210], ["swordfish", "Swordfish", "common", 195], ["lantern", "Lanternfish", "common", 170],
      ["marlin", "Blue Marlin", "rare", 220], ["oarfish", "Oarfish", "rare", 280], ["abyss", "Abyssal Leviathan", "legendary", 265],
      ["ghostangler", "Ghost Angler", "legendary", 185, { time: ["night"], weather: ["cloudy", "rain", "storm"] }]] }
  ];
  /* Weather (fixed for a session) and time of day (moves on every 2.5
     minutes of fishing) change the odds, and some fish only bite in
     certain conditions. */
  var FISH_WEATHER = [
    { id: "sunny", name: "Sunny", w: 35, odds: { common: 10, rare: 0, legendary: 0 } },
    { id: "cloudy", name: "Cloudy", w: 30, odds: { common: 0, rare: 3, legendary: 0 } },
    { id: "rain", name: "Rain", w: 25, odds: { common: 0, rare: 8, legendary: 1 } },
    { id: "storm", name: "Storm", w: 10, odds: { common: 0, rare: 5, legendary: 4 } }
  ];
  var FISH_TIMES = [
    { id: "morning", name: "Morning", odds: { common: 0, rare: 3, legendary: 0 } },
    { id: "noon", name: "Noon", odds: { common: 5, rare: 0, legendary: 0 } },
    { id: "evening", name: "Evening", odds: { common: 0, rare: 2, legendary: 1 } },
    { id: "night", name: "Night", odds: { common: 0, rare: 0, legendary: 3 } }
  ];
  var FISH_PHASE_MS = 150000;
  function fishCondText(cond) {
    if (!cond) return "";
    var bits = [];
    if (cond.time) bits.push(cond.time.join(" or "));
    if (cond.weather) bits.push("in " + cond.weather.join(" or ") + " weather");
    return "only bites " + bits.join(", ");
  }
  var FISH_BASE_VALUE = { common: 10, rare: 40, legendary: 150 };
  var FISH_RODS = [
    { id: "bamboo", name: "Bamboo Rod", price: 0, time: 0, perk: "No special perk." },
    { id: "fiberglass", name: "Fiberglass Rod", price: 800, time: 2000, perk: "10% chance to land a double catch." },
    { id: "carbon", name: "Carbon Rod", price: 3000, time: 3000, perk: "Shows the fish's rarity as soon as it bites, and +10% coins." },
    { id: "pro", name: "Pro Rod", price: 10000, time: 4000, perk: "Every fish gets one free second chance after a wrong answer (multiple choice and picture questions)." }
  ];
  var FISH_STATS = [
    { id: "reel", name: "Reel speed", base: 200, desc: "+1 second before a fish escapes, per level." },
    { id: "bait", name: "Bait", base: 300, desc: "Better odds of rare and legendary bites." },
    { id: "line", name: "Line strength", base: 250, desc: "+10% chance per level to keep the fish after a wrong answer (multiple choice and picture questions)." },
    { id: "luck", name: "Luck", base: 300, desc: "+8% coins per catch, per level." },
    { id: "cast", name: "Cast speed", base: 150, desc: "Fish bite sooner after you cast." }
  ];
  var STAT_MAX = 5;

  function statPrice(base, level) { return Math.round(base * Math.pow(level + 1, 1.6)); }
  function locationById(id) { for (var i = 0; i < FISH_LOCATIONS.length; i++) if (FISH_LOCATIONS[i].id === id) return FISH_LOCATIONS[i]; return FISH_LOCATIONS[0]; }
  function rodById(id) { for (var i = 0; i < FISH_RODS.length; i++) if (FISH_RODS[i].id === id) return FISH_RODS[i]; return FISH_RODS[0]; }
  function speciesValue(loc, sp) { return Math.round(FISH_BASE_VALUE[sp[2]] * loc.mult); }

  /* ------------------------- Tycoon data ------------------------- */

  var TY_UP_MAX = 8;
  /* More trucks multiply every shipped order's revenue. */
  var TY_TRUCKS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16];
  var TYCOON_UPGRADES = [
    { id: "conveyor", name: "Conveyor belt", base: 150, growth: 2.3, desc: "+1 second of thinking time per order, per level." },
    { id: "docks", name: "Loading docks", base: 200, growth: 2.3, desc: "+15 seconds per day, per level (1 minute at the start, 3 minutes maxed)." },
    { id: "forklifts", name: "Forklifts", base: 250, growth: 2.3, desc: "Streak bonuses grow 25% bigger per level." },
    { id: "marketing", name: "Marketing", base: 300, growth: 2.3, desc: "+20% order value per level." },
    { id: "qc", name: "Quality control", base: 150, growth: 2.3, desc: "-10% return and late penalties per level." },
    { id: "trucks", name: "More trucks", base: 600, growth: 3.4, desc: "Multiplies the revenue of every order: ×1.5, ×2, ×3, ×4, ×6, ×8, ×12, ×16." }
  ];
  function tyFreshUps() { return { conveyor: 0, docks: 0, forklifts: 0, marketing: 0, qc: 0, trucks: 0 }; }
  function tyTrucks(p) { return TY_TRUCKS[p.upgrades.trucks || 0]; }
  function tyDayMs(p) { return 60000 + 15000 * p.upgrades.docks; }
  var TYCOON_CUSTOMERS = ["Northside Grocers", "Apex Hardware", "Bluebird Cafe", "Summit Outdoor", "Harbor Pharmacy", "Lakeview Books", "Metro Electronics", "Prairie Feed Co.", "Copperline Auto", "Willow Florists", "Granite Builders", "Sunrise Bakery"];
  var TYCOON_ITEMS = ["pallets of paper towels", "boxes of LED bulbs", "crates of canned goods", "rolls of shrink wrap", "cases of motor oil", "bundles of lumber", "cartons of coffee beans", "kits of hand tools", "cases of bottled water", "bins of fasteners"];

  function tycoonUpgradePrice(up, level) { return Math.round(up.base * Math.pow(up.growth || 2.3, level)); }
  function tycoonOverhead(day) { return 30 + 10 * day; }

  /* ------------------------- Saved game data ------------------------- */

  function freshFishingProfile() {
    return { coins: 0, rod: "bamboo", rods: { bamboo: true }, stats: { reel: 0, bait: 0, line: 0, luck: 0, cast: 0 },
      location: "pond", locations: { pond: true }, caught: {}, minutes: 10, bounty: null };
  }
  function freshTycoonProfile() {
    var ups = tyFreshUps();
    return { money: 200, day: 1, totalProfit: 0, wh: "main", warehouses: { main: { owned: true, upgrades: ups } },
      upgrades: ups, staff: {}, contract: null, contractsDone: 0, milestones: {} };
  }
  function freshGameData() {
    return { ratings: {}, progress: {}, fishing: freshFishingProfile(), tycoon: freshTycoonProfile(),
      td: freshTdProfile(), rally: freshRallyProfile(), garden: freshGardenProfile(), boss: freshBossProfile(), delve: freshDelveProfile(),
      survival: freshSurvivalProfile(), blitz: freshBlitzProfile(), rivals: {}, skill: {} };
  }
  state.gameData = freshGameData();

  /* Read the "games" field of a progress file, filling in anything missing
     so an older or hand-edited file can't break the games. */
  function parseGameData(text) {
    var out = freshGameData();
    if (!text) return out;
    var data;
    try { data = JSON.parse(text).games; } catch (err) { return out; }
    if (!data || typeof data !== "object") return out;
    var num = function (v, d) { return typeof v === "number" && isFinite(v) ? v : d; };
    if (data.ratings && typeof data.ratings === "object") {
      Object.keys(data.ratings).forEach(function (k) { if (hasOwn(GAMES, k)) out.ratings[k] = clamp(num(data.ratings[k], 1000), 100, 3000); });
    }
    out.rivals = parseRivals(data.rivals);
    out.skill = parseSkill(data.skill);
    var f = data.fishing;
    if (f && typeof f === "object") {
      var fp = out.fishing;
      fp.coins = Math.max(0, Math.floor(num(f.coins, 0)));
      if (f.rods && typeof f.rods === "object") FISH_RODS.forEach(function (r) { if (f.rods[r.id] === true) fp.rods[r.id] = true; });
      if (hasOwn(fp.rods, f.rod)) fp.rod = f.rod;
      if (f.stats && typeof f.stats === "object") FISH_STATS.forEach(function (s) { fp.stats[s.id] = clamp(Math.floor(num(f.stats[s.id], 0)), 0, STAT_MAX); });
      if (f.locations && typeof f.locations === "object") FISH_LOCATIONS.forEach(function (l) { if (f.locations[l.id] === true) fp.locations[l.id] = true; });
      if (hasOwn(fp.locations, f.location)) fp.location = f.location;
      var realKeys = {};
      FISH_LOCATIONS.forEach(function (l) { l.species.forEach(function (sp) { realKeys[l.id + ":" + sp[0]] = true; }); });
      if (f.caught && typeof f.caught === "object") Object.keys(f.caught).forEach(function (k) {
        var n = Math.floor(num(f.caught[k], 0));
        if (n > 0 && realKeys[k]) fp.caught[k] = n;
      });
      if (typeof f.minutes === "number") fp.minutes = fishingMinutes(f.minutes);
      var bt = f.bounty;
      if (bt && typeof bt === "object" && typeof bt.day === "number" && Array.isArray(bt.list)) {
        fp.bounty = { day: Math.floor(bt.day), list: bt.list.filter(function (x) { return x && realKeys[x.key] && typeof x.n === "number"; }).slice(0, 3).map(function (x) {
          return { key: x.key, n: clamp(Math.floor(x.n), 1, 5), got: clamp(Math.floor(num(x.got, 0)), 0, 5), reward: clamp(Math.round(num(x.reward, 0)), 0, 100000), done: x.done === true };
        }) };
      }
    }
    if (data.progress && typeof data.progress === "object") {
      Object.keys(data.progress).forEach(function (gid) {
        var src = data.progress[gid];
        if (!src || typeof src !== "object" || !hasOwn(GAMES, gid)) return;
        var dst = { xp: Math.max(0, Math.floor(num(src.xp, 0))), stats: {}, ach: {}, challenges: null };
        if (src.stats && typeof src.stats === "object") Object.keys(src.stats).forEach(function (k) {
          var v = num(src.stats[k], 0); if (v > 0) dst.stats[k] = v;
        });
        if (src.ach && typeof src.ach === "object") Object.keys(src.ach).forEach(function (k) {
          if (typeof src.ach[k] === "string") dst.ach[k] = src.ach[k].slice(0, 10);
        });
        var cs = src.challenges;
        if (cs && typeof cs === "object" && Array.isArray(cs.list) && typeof cs.session === "string") {
          var list = cs.list.filter(function (c) { return c && challengeTemplate(c.t) && typeof c.n === "number"; }).slice(0, 3)
            .map(function (c) { return { t: c.t, n: c.n, tier: clamp(Math.floor(num(c.tier, 0)), 0, 2), p: Math.max(0, num(c.p, 0)), done: c.done === true }; });
          if (list.length === 3) dst.challenges = { session: cs.session, list: list };
        }
        out.progress[gid] = dst;
      });
    }
    out.td = parseTdProfile(data.td);
    out.rally = parseRallyProfile(data.rally);
    out.garden = parseGardenProfile(data.garden);
    out.boss = parseBossProfile(data.boss);
    out.delve = parseDelveProfile(data.delve);
    out.survival = parseSurvivalProfile(data.survival);
    out.blitz = parseBlitzProfile(data.blitz);
    var t = data.tycoon;
    if (t && typeof t === "object") {
      var tp = out.tycoon;
      tp.money = Math.round(num(t.money, 200));
      tp.day = Math.max(1, Math.floor(num(t.day, 1)));
      tp.totalProfit = Math.round(num(t.totalProfit, 0));
      var readUps = function (src, dst) {
        if (src && typeof src === "object") TYCOON_UPGRADES.forEach(function (u) { dst[u.id] = clamp(Math.floor(num(src[u.id], 0)), 0, TY_UP_MAX); });
      };
      // Older files kept upgrades at the top level; they belong to the main warehouse.
      var whs = t.warehouses && typeof t.warehouses === "object" ? t.warehouses : null;
      readUps(whs && whs.main ? whs.main.upgrades : t.upgrades, tp.warehouses.main.upgrades);
      ["wh2", "wh3"].forEach(function (id) {
        if (whs && whs[id] && whs[id].owned === true) {
          tp.warehouses[id] = { owned: true, upgrades: tyFreshUps() };
          readUps(whs[id].upgrades, tp.warehouses[id].upgrades);
        }
      });
      if (typeof t.wh === "string" && Object.prototype.hasOwnProperty.call(tp.warehouses, t.wh) && tp.warehouses[t.wh].owned !== false) tp.wh = t.wh;
      tp.upgrades = tp.warehouses[tp.wh].upgrades;
      if (t.staff && typeof t.staff === "object") ["picker", "driver", "manager"].forEach(function (k) { if (t.staff[k] === true) tp.staff[k] = true; });
      var c = t.contract;
      if (c && typeof c === "object" && typeof c.customer === "string" && num(c.target, 0) > 0 && num(c.daysLeft, 0) > 0) {
        tp.contract = { customer: c.customer.slice(0, 60), target: Math.floor(c.target), days: Math.floor(num(c.days, 2)), daysLeft: Math.floor(c.daysLeft),
          minAcc: clamp(num(c.minAcc, 80), 0, 100), bonus: Math.max(0, Math.round(num(c.bonus, 0))),
          shipped: Math.max(0, Math.floor(num(c.shipped, 0))), answered: Math.max(0, Math.floor(num(c.answered, 0))), correct: Math.max(0, Math.floor(num(c.correct, 0))) };
      }
      tp.contractsDone = Math.max(0, Math.floor(num(t.contractsDone, 0)));
      if (t.crateWeek && typeof t.crateWeek === "object" && typeof t.crateWeek.week === "number") {
        tp.crateWeek = { week: Math.floor(t.crateWeek.week), bought: {} };
        TY_POWERUPS.forEach(function (pu) { if (pu.mult && t.crateWeek.bought && t.crateWeek.bought[pu.id] === true) tp.crateWeek.bought[pu.id] = true; });
      }
      if (t.milestones && typeof t.milestones === "object") TY_MILESTONES.forEach(function (m) { if (t.milestones[m[0]] === true) tp.milestones[m[0]] = true; });
    }
    return out;
  }

  function playerRating(id) { var r = state.gameData.ratings[id]; return typeof r === "number" ? r : 1000; }

