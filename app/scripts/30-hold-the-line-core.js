  /* =========================== Hold the Line ===========================
     Tower defense where every question is one "step". A correct answer
     fires every tower (faster answers and streaks hit harder), then the
     enemies move one step. A wrong answer or a timeout fires nothing and
     the enemies surge two steps. Gold from kills and cleared waves buys
     and upgrades towers in fixed slots. The pure simulation (tdNewRun,
     tdStep, ...) has no DOM access so it can be balanced headlessly. */

  var TD_STEP = 22;            // path units an enemy at speed 1 moves per step
  var TD_POWER = 2;          // global tower damage scale (balance knob)
  var TD_SPAWN_GAP = 4;        // spacing between enemies entering the map
  var TD_W = 100, TD_H = 60;   // map coordinates

  var TD_REGIONS = [
    { id: "meadow", name: "Meadow", ground: "#8fc26a", road: "#e8d6a8", accent: "#5c8f3e", hp: 1, stars: 0 },
    { id: "canyon", name: "Canyon", ground: "#d9a066", road: "#f3dcb4", accent: "#a8643a", hp: 1.2, stars: 6 },
    { id: "tundra", name: "Tundra", ground: "#cfe3ee", road: "#ffffff", accent: "#7aa6c2", hp: 1.4, stars: 15 },
    { id: "volcano", name: "Volcano", ground: "#5a3b3b", road: "#b98f7a", accent: "#e0612f", hp: 1.55, stars: 24 }
  ];
  var TD_MAPS = [
    { id: "m1", region: 0, name: "Green Fields", path: [[0, 30], [26, 30], [26, 12], [54, 12], [54, 46], [80, 46], [80, 28], [100, 28]] },
    { id: "m2", region: 0, name: "Willow Bend", path: [[0, 10], [76, 10], [76, 28], [22, 28], [22, 48], [100, 48]] },
    { id: "m3", region: 0, name: "Millstream", path: [[0, 50], [16, 50], [16, 14], [40, 14], [40, 46], [62, 46], [62, 14], [86, 14], [86, 50], [100, 50]] },
    { id: "c1", region: 1, name: "Red Gulch", path: [[0, 18], [24, 18], [24, 50], [50, 50], [50, 9], [76, 9], [76, 40], [100, 40]] },
    { id: "c2", region: 1, name: "Dust Devil", path: [[50, 0], [50, 18], [14, 18], [14, 46], [86, 46], [86, 26], [66, 26], [66, 60]] },
    { id: "c3", region: 1, name: "Mesa Run", path: [[0, 10], [86, 10], [86, 30], [14, 30], [14, 50], [100, 50]] },
    { id: "t1", region: 2, name: "Frostgate", path: [[0, 30], [18, 30], [18, 8], [38, 8], [38, 52], [60, 52], [60, 8], [80, 8], [80, 30], [100, 30]] },
    { id: "t2", region: 2, name: "Glacier Loop", path: [[0, 52], [70, 52], [70, 10], [30, 10], [30, 38], [100, 38]] },
    { id: "t3", region: 2, name: "Whiteout", path: [[100, 10], [10, 10], [10, 50], [50, 50], [50, 26], [88, 26], [88, 60]] },
    { id: "v1", region: 3, name: "Ash Road", path: [[0, 46], [22, 46], [22, 12], [46, 12], [46, 36], [70, 36], [70, 8], [100, 8]] },
    { id: "v2", region: 3, name: "Lava Falls", path: [[0, 6], [18, 6], [18, 54], [38, 54], [38, 6], [58, 6], [58, 54], [78, 54], [78, 6], [100, 6]] },
    { id: "v3", region: 3, name: "The Caldera", path: [[0, 8], [90, 8], [90, 52], [10, 52], [10, 24], [70, 24], [70, 38], [40, 38]] }
  ];
  /* One challenge map per region, with fixed rules. */
  var TD_CHALLENGES = [
    { id: "meadow-ch", region: 0, layout: "m2", name: "Archers Only", desc: "Only Arrow towers. 15 waves.", waves: 15, only: ["arrow"] },
    { id: "canyon-ch", region: 1, layout: "c1", name: "One Life", desc: "A single life. 15 waves.", waves: 15, lives: 1 },
    { id: "tundra-ch", region: 2, layout: "t1", name: "Cold Steel", desc: "Only Frost and Cannon towers. 15 waves.", waves: 15, only: ["frost", "cannon"] },
    { id: "volcano-ch", region: 3, layout: "v1", name: "Inferno", desc: "Enemies move 30% faster and selling is off. 15 waves.", waves: 15, speed: 1.3, noSell: true }
  ];
  var TD_TIERS = {
    normal: { name: "Normal", waves: 20, lives: 20, hp: 1, gold: 140, bossEvery: 10, think: 0 },
    hard: { name: "Hard", waves: 30, lives: 15, hp: 1.45, gold: 160, bossEvery: 10, think: -500 },
    nightmare: { name: "Nightmare", waves: 40, lives: 10, hp: 2.1, gold: 180, bossEvery: 10, think: -1000 }
  };
  var TD_NIGHTMARE_MODS = [
    { from: 11, name: "Faster enemies", desc: "Enemies move 20% faster." },
    { from: 21, name: "Armored fliers", desc: "Fliers gain 5 armor." },
    { from: 31, name: "Cleansing healers", desc: "Healers remove frost and heal twice as much." }
  ];

  /* Enemy types. cost = wave budget points. */
  var TD_ENEMIES = {
    grunt: { name: "Grunt", hp: 20, spd: 1, gold: 3, lives: 1, cost: 1, r: 1.6, color: "#6b8e23", desc: "The basic foot soldier." },
    runner: { name: "Runner", hp: 12, spd: 1.7, gold: 3, lives: 1, cost: 1, r: 1.3, color: "#e0a526", desc: "Fast but fragile." },
    swarm: { name: "Swarmling", hp: 7, spd: 1.3, gold: 1, lives: 1, cost: 0.35, r: 1, color: "#9c6ade", desc: "Tiny, and they come in packs." },
    brute: { name: "Brute", hp: 64, spd: 0.7, gold: 8, lives: 2, cost: 3, r: 2.3, color: "#8b5a2b", desc: "Slow and tough. Costs 2 lives if it gets through." },
    flier: { name: "Flier", hp: 20, spd: 1.1, gold: 5, lives: 1, cost: 2, r: 1.5, color: "#4fa3e0", fly: true, desc: "Flies straight to your base. Cannons and Mortars can't hit it." },
    armored: { name: "Armored", hp: 36, spd: 0.9, gold: 7, lives: 1, cost: 2.5, r: 1.8, color: "#7d8597", armor: 6, desc: "Armor blocks 6 damage per hit. Cannons break armor; Ballistas ignore it." },
    burrower: { name: "Burrower", hp: 32, spd: 1, gold: 6, lives: 1, cost: 2, r: 1.6, color: "#a0522d", burrow: true, desc: "Digs under part of the path, where towers can't reach it." },
    splitter: { name: "Splitter", hp: 36, spd: 0.9, gold: 5, lives: 1, cost: 2.5, r: 1.9, color: "#3cb371", split: true, desc: "Splits into two small fast blobs when defeated." },
    splitling: { name: "Splitling", hp: 10, spd: 1.4, gold: 1, lives: 1, cost: 0, r: 1.1, color: "#66cdaa", child: true, desc: "" },
    shield: { name: "Shield bearer", hp: 34, spd: 0.9, gold: 8, lives: 1, cost: 3, r: 1.9, color: "#c0c0c0", shield: true, desc: "Nearby enemies take 30% less damage." },
    healer: { name: "Healer", hp: 28, spd: 0.9, gold: 8, lives: 1, cost: 3, r: 1.7, color: "#ff8fab", heal: true, desc: "Heals nearby enemies every step." },
    wraith: { name: "Wraith", hp: 28, spd: 1.2, gold: 7, lives: 1, cost: 2.5, r: 1.6, color: "#a9a9d9", dodge: 0.3, desc: "Dodges 30% of direct shots. Splash and auras always land." },
    knight: { name: "Knight", hp: 100, spd: 0.75, gold: 12, lives: 2, cost: 4.5, r: 2.3, color: "#4a6fa5", armor: 3, desc: "Heavily armored and hard to stop." },
    skyguard: { name: "Skyguard", hp: 50, spd: 1, gold: 10, lives: 1, cost: 4, r: 2, color: "#2f5f8a", fly: true, armor: 4, desc: "An armored flier." },
    golem: { name: "Golem", hp: 200, spd: 0.55, gold: 20, lives: 3, cost: 8, r: 2.8, color: "#6e5a4a", armor: 8, desc: "A walking wall. Bring Cannons and Ballistas." },
    ogre: { name: "Ogre King", hp: 380, spd: 0.5, gold: 80, lives: 5, cost: 0, r: 3.6, color: "#556b2f", armor: 2, boss: true, desc: "Meadow boss. Takes 5 lives if it reaches your base." },
    wyrm: { name: "Sand Wyrm", hp: 520, spd: 0.6, gold: 100, lives: 5, cost: 0, r: 3.6, color: "#c2833f", burrow: true, boss: true, desc: "Canyon boss. Burrows under the middle of the path." },
    giant: { name: "Frost Giant", hp: 700, spd: 0.5, gold: 120, lives: 5, cost: 0, r: 3.8, color: "#8fb8d8", armor: 6, boss: true, noSlow: true, desc: "Tundra boss. Frost can't slow it." },
    titan: { name: "Magma Titan", hp: 900, spd: 0.45, gold: 150, lives: 5, cost: 0, r: 4, color: "#d2491c", armor: 8, boss: true, selfHeal: 0.015, desc: "Volcano boss. Heals itself a little every step." }
  };
  var TD_BOSS_BY_REGION = ["ogre", "wyrm", "giant", "titan"];
  /* Enemy types each region adds, with the wave (on Normal) they first appear. */
  var TD_POOLS = [
    [["grunt", 1], ["runner", 3], ["brute", 5], ["flier", 7], ["swarm", 9]],
    [["armored", 1], ["burrower", 4], ["splitter", 7], ["shield", 11]],
    [["healer", 1], ["wraith", 4], ["knight", 7], ["skyguard", 12]],
    [["golem", 3]]
  ];

  /* Towers. Path descriptions are per level (1-5). */
  /* Each tower has two upgrade paths of 5 levels. Levels 1-2 are small
     stat bumps; level 3 unlocks an ability no other tower has and every
     level from 3 on grows the stats much faster; level 5 powers the
     ability up. (Levels count as 1, 2, 3.6, 5.2, 7.2 "steps" of a stat.) */
  var TD_TOWERS = {
    arrow: { name: "Arrow", key: "arrow", cost: 50, color: "#8b5e34", role: "Fast single target",
      a: { name: "Rapid fire", ability: "Critical shots", lv: ["+1 shot, +10% damage", "+10% damage", "Critical shots: 25% chance to deal ×3. +1 shot, +16% damage", "+16% damage, +5% crit chance", "Crits deal ×4 and happen 40% of the time. +1 shot, +20% damage"] },
      b: { name: "Piercing shots", ability: "Ricochet", lv: ["Hits 1 more enemy, pierces 2 armor", "Hits 1 more enemy, pierces 2 armor", "Ricochet: a killing shot jumps to the next enemy. Hits 2 more, pierces 3 armor", "Hits 2 more enemies, pierces 3 armor", "Ricochets jump twice. Hits 2 more, pierces 4 armor, +2 range"] } },
    cannon: { name: "Cannon", key: "arrow", cost: 80, color: "#444b55", role: "Splash damage, breaks armor; can't hit fliers",
      a: { name: "Bigger blast", ability: "Burning ground", lv: ["+2 blast radius, +8% damage", "+2 blast radius, +8% damage", "Burning ground: everything hit burns for 30% next step. +3 radius, +14% damage", "+3 blast radius, +14% damage", "Burn grows to 50% for 2 steps. +4 radius, +20% damage"] },
      b: { name: "Heavy shells", ability: "Stun shells", lv: ["+25% damage, breaks 1 more armor", "+25% damage, breaks 1 more armor", "Stun shells: 20% chance to stop everything hit for a step. +40% damage", "+40% damage, breaks 1 more armor", "Stun chance 35%. +55% damage, breaks 2 more armor"] } },
    frost: { name: "Frost", key: "arrow", cost: 60, color: "#5bc0eb", role: "Slows everything in range",
      a: { name: "Deep freeze", ability: "Shatter", lv: ["+8% slow", "+8% slow", "Shatter: slowed enemies take 30% more damage from every tower. +10% slow", "+10% slow", "Shatter grows to 50%, 25% chance to freeze for a step"] },
      b: { name: "Wider aura", ability: "Frostbite", lv: ["+3 range, +2 damage", "+3 range, +2 damage", "Frostbite: enemies in the aura lose 1 armor each volley. +4 range, +3 damage", "+4 range, +3 damage", "Frostbite strips 2 armor and freezes fliers too. +5 range, +4 damage"] } },
    lightning: { name: "Lightning", key: "lightning", cost: 100, color: "#f2c14e", role: "Chains between enemies",
      a: { name: "More chains", ability: "Arc storm", lv: ["+1 chain", "+1 chain", "Arc storm: chains no longer weaken as they jump. +2 chains", "+2 chains", "Each jump hits 10% harder than the last. +3 chains"] },
      b: { name: "Overcharge", ability: "Overload", lv: ["+25% damage", "+25% damage", "Overload: every 3rd volley strikes every enemy in range at once. +40% damage", "+40% damage", "Overload every 2nd volley. +60% damage"] } },
    mortar: { name: "Mortar", key: "mortar", cost: 120, color: "#7a5c3e", role: "Long range, fires every other correct answer; can't hit fliers",
      a: { name: "Cluster shells", ability: "Rapid loader", lv: ["+1 extra blast", "+1 extra blast", "Rapid loader: fires on every correct answer. +1 extra blast", "+2 extra blasts", "Extra blasts hit for 70% instead of 40%. +2 extra blasts"] },
      b: { name: "Siege range", ability: "Earthquake", lv: ["+5 range, +15% damage", "+5 range, +15% damage", "Earthquake: blasts knock enemies back along the road. +6 range, +25% damage", "+6 range, +25% damage", "Knockback doubles. +8 range, +35% damage"] } },
    beacon: { name: "Beacon", key: "beacon", cost: 90, color: "#e76f51", role: "Boosts nearby towers' damage by 15%",
      a: { name: "Damage aura", ability: "Overdrive", lv: ["+8% boost", "+8% boost", "Overdrive: towers in range get +3 range. +12% boost", "+12% boost", "Boosted towers also ignore 3 armor. +15% boost, +5 range"] },
      b: { name: "Gold aura", ability: "Bounty", lv: ["+2 gold per correct answer", "+2 gold per correct answer", "Bounty: kills by towers in range give 50% more gold. +3 gold per answer", "+3 gold per correct answer", "Bounty pays double. +4 gold per answer"] } },
    venom: { name: "Venom", key: "venom", cost: 90, color: "#6a994e", role: "Poison that keeps hurting (ignores armor)",
      a: { name: "Toxic stacks", ability: "Plague", lv: ["+2 poison, +1 max stack", "+2 poison, +1 max stack", "Plague: a poisoned enemy that dies spreads its poison to 2 neighbors. +3 poison, +1 stack", "+3 poison, +1 max stack", "Plague spreads to 4. +4 poison, +1 stack"] },
      b: { name: "Spreading cloud", ability: "Corrode", lv: ["+1 target, +1 range", "+1 target, +1 range", "Corrode: poison also strips 1 armor and slows 15% each tick. +2 targets, +1 range", "+2 targets, +1 range", "Corrode strips 2 armor and slows 25%. +3 targets, +2 range"] } },
    ballista: { name: "Ballista", key: "ballista", cost: 150, color: "#9d4edd", role: "Huge single hits on the toughest enemy; ignores armor",
      a: { name: "Heavy bolts", ability: "Execute", lv: ["+25% damage", "+25% damage", "Execute: finishes off any non-boss left under 25% health. +40% damage", "+40% damage", "Executes under 35%, and bosses take 50% more. +60% damage"] },
      b: { name: "Marksman", ability: "Twin bolts", lv: ["+30% vs fliers and bosses, +2 range", "+30% vs fliers and bosses, +2 range", "Twin bolts: also fires at the second-toughest enemy. +45% vs fliers and bosses, +3 range", "+45% vs fliers and bosses, +3 range", "A third bolt. +60% vs fliers and bosses, +4 range"] } }
  };
  var TD_TOWER_ORDER = ["arrow", "cannon", "frost", "lightning", "mortar", "beacon", "venom", "ballista"];
  var TD_UPGRADE_FACTORS = [0.6, 0.9, 1.6, 2.4, 3.6];
  var TD_LEVEL_STEPS = [0, 1, 2, 3.6, 5.2, 7.2];

  /* ----------------------------- Geometry ----------------------------- */

  function tdRoute(points) {
    var cum = [0];
    for (var i = 1; i < points.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    return { pts: points, cum: cum, len: cum[cum.length - 1] };
  }
  function tdPointAt(route, d) {
    if (d <= 0) return { x: route.pts[0][0], y: route.pts[0][1] };
    if (d >= route.len) { var e = route.pts[route.pts.length - 1]; return { x: e[0], y: e[1] }; }
    var i = 1;
    while (route.cum[i] < d) i++;
    var a = route.pts[i - 1], b = route.pts[i];
    var t = (d - route.cum[i - 1]) / (route.cum[i] - route.cum[i - 1]);
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t };
  }
  function tdDistToRoute(route, x, y) {
    var best = Infinity;
    for (var i = 1; i < route.pts.length; i++) {
      var a = route.pts[i - 1], b = route.pts[i];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      best = Math.min(best, Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t)));
    }
    return best;
  }
  /* Path length within `range` of a point, sampled. */
  function tdCoverage(route, x, y, range) {
    var n = 0;
    for (var d = 0; d <= route.len; d += 2) { var p = tdPointAt(route, d); if (Math.hypot(p.x - x, p.y - y) <= range) n += 2; }
    return n;
  }

  var tdLayoutCache = {};
  /* Fixed tower slots for a layout: spots just off the road that cover the
     most path, spread apart. Deterministic, so saved runs line up. */
  function tdLayout(layoutId) {
    if (tdLayoutCache[layoutId]) return tdLayoutCache[layoutId];
    var map = TD_MAPS.filter(function (m) { return m.id === layoutId; })[0];
    var route = tdRoute(map.path);
    var first = map.path[0], last = map.path[map.path.length - 1];
    var fly = tdRoute([first, last]);
    var cands = [];
    for (var x = 5; x <= 95; x += 2.5) for (var y = 5; y <= 55; y += 2.5) {
      var d = tdDistToRoute(route, x, y);
      if (d < 5.5 || d > 9) continue;
      if (Math.hypot(x - last[0], y - last[1]) < 8 || Math.hypot(x - first[0], y - first[1]) < 6) continue;
      cands.push({ x: x, y: y, cov: tdCoverage(route, x, y, 16) });
    }
    cands.sort(function (a, b) { return b.cov - a.cov || a.x - b.x || a.y - b.y; });
    var want = clamp(Math.round(route.len / 24), 7, 13);
    var slots = [];
    cands.forEach(function (c) {
      if (slots.length >= want) return;
      if (slots.some(function (s) { return Math.hypot(s.x - c.x, s.y - c.y) < 11; })) return;
      slots.push({ x: c.x, y: c.y });
    });
    slots.sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    tdLayoutCache[layoutId] = { route: route, fly: fly, slots: slots, map: map };
    return tdLayoutCache[layoutId];
  }

  /* ---------------------------- Map catalog ---------------------------- */

  /* Everything playable: 12 maps, 4 challenge maps and Endless. */
  function tdMapDef(id) {
    var m = TD_MAPS.filter(function (x) { return x.id === id; })[0];
    if (m) return { id: m.id, layout: m.id, region: m.region, name: m.name, kind: "map" };
    var c = TD_CHALLENGES.filter(function (x) { return x.id === id; })[0];
    if (c) return { id: c.id, layout: c.layout, region: c.region, name: c.name, kind: "challenge", rules: c };
    if (id === "endless") return { id: "endless", layout: "m1", region: 0, name: "Endless", kind: "endless" };
    return null;
  }

  /* -------------------------------- Runs -------------------------------- */

  function tdWaveCount(run) {
    if (run.kind === "endless") return Infinity;
    if (run.kind === "challenge") return run.rules.waves;
    return TD_TIERS[run.tier].waves;
  }

  /* opts: { mapId, tier, layout (endless only), level (player level) } */
  function tdNewRun(opts) {
    var def = tdMapDef(opts.mapId);
    var tier = def.kind === "map" ? opts.tier : "normal";
    var layoutId = def.kind === "endless" ? (opts.layout || "m1") : def.layout;
    var lay = tdLayout(layoutId);
    var region = def.kind === "endless" ? lay.map.region : def.region;
    var t = TD_TIERS[tier];
    var lives = def.rules && def.rules.lives ? def.rules.lives : t.lives;
    return {
      mapId: def.id, kind: def.kind, rules: def.rules || null, layout: layoutId, region: region, tier: tier,
      wave: 0, lives: lives, maxLives: lives, gold: t.gold + 40 * region, towers: [],
      enemies: [], nextId: 1, steps: 0, kills: 0, leaked: 0, waveLeaked: 0, waveActive: false,
      level: opts.level || 1, newTypes: []
    };
  }

  function tdHpScale(run, wave) {
    var t = TD_TIERS[run.tier];
    var regionHp = TD_REGIONS[run.region].hp;
    if (run.kind === "endless") regionHp = 1 + 0.12 * Math.max(0, wave - 1); // endless keeps scaling
    return regionHp * t.hp * (1 + 0.11 * (wave - 1));
  }

  /* Enemy types available on a wave. */
  function tdPool(run, wave) {
    var out = [];
    var hardShift = run.tier === "hard" ? 4 : run.tier === "nightmare" ? 99 : 0;
    var maxRegion = run.kind === "endless" ? Math.min(3, Math.floor((wave - 1) / 10)) : run.region;
    for (var r = 0; r <= maxRegion; r++) {
      TD_POOLS[r].forEach(function (pair) {
        var at = r < maxRegion ? Math.max(1, Math.ceil(pair[1] / 2)) : pair[1];
        if (wave + hardShift >= at) out.push(pair[0]);
      });
    }
    // Hard previews the next region's first enemy.
    if (run.tier !== "normal" && run.kind === "map" && run.region < 3 && wave >= 10) out.push(TD_POOLS[run.region + 1][0][0]);
    return out;
  }

  function tdIsBossWave(run, wave) {
    if (run.kind === "challenge") return wave === run.rules.waves;
    return wave % TD_TIERS[run.tier].bossEvery === 0;
  }

  /* The enemies of a wave, in spawn order (deterministic per run+wave). */
  function tdWavePlan(run, wave) {
    var rnd = mulberry32(((run.layout.charCodeAt(0) * 7919) ^ (wave * 104729) ^ (run.tier.length * 31)) >>> 0);
    var pool = tdPool(run, wave);
    var budget = 4 + 1.5 * wave;
    var list = [];
    if (tdIsBossWave(run, wave)) {
      var bossRegion = run.kind === "endless" ? Math.min(3, Math.floor((wave - 1) / 10)) : run.region;
      list.push(TD_BOSS_BY_REGION[bossRegion]);
      budget *= 0.5;
    }
    // Newest type gets a guaranteed showing on its debut wave.
    var guaranteed = pool.filter(function (k) { return TD_ENEMIES[k].cost <= budget; });
    while (budget > 0.3 && list.length < 60) {
      var k = guaranteed.length && rnd() < 0.35 ? guaranteed[guaranteed.length - 1 - Math.floor(rnd() * Math.min(2, guaranteed.length))] : pool[Math.floor(rnd() * pool.length)];
      var e = TD_ENEMIES[k];
      if (e.cost > budget && budget >= 1) continue;
      if (e.cost > budget) k = "grunt";
      if (k === "swarm") { list.push("swarm", "swarm", "swarm"); budget -= 3 * e.cost; }
      else { list.push(k); budget -= TD_ENEMIES[k].cost; }
    }
    // Bosses walk in the middle of their escort.
    if (list.length > 2 && TD_ENEMIES[list[0]].boss) { var b = list.shift(); list.splice(Math.floor(list.length / 2), 0, b); }
    return list;
  }

  function tdMakeEnemy(run, type, d, hpScale) {
    var e = TD_ENEMIES[type];
    var night = run.tier === "nightmare";
    // Bosses grow with the wave more gently than their escorts.
    if (e.boss) hpScale = 1 + (hpScale - 1) * 0.6;
    var hp = Math.round(e.hp * hpScale * (night && !e.boss ? 1.1 : 1));
    var armor = e.armor || 0;
    if (night && e.fly && run.wave >= 21) armor += 5;
    return { id: run.nextId++, type: type, hp: hp, max: hp, armor: armor, d: d, slow: 0, slowSteps: 0, frozen: 0,
      poison: [], alive: true, fly: !!e.fly, boss: !!e.boss };
  }

  function tdStartWave(run) {
    run.wave++;
    run.waveActive = true;
    run.waveLeaked = 0;
    var scale = tdHpScale(run, run.wave);
    var plan = tdWavePlan(run, run.wave);
    run.enemies = plan.map(function (type, i) { return tdMakeEnemy(run, type, -i * TD_SPAWN_GAP, scale); });
    return plan;
  }

  function tdRouteFor(run, e) { var lay = tdLayout(run.layout); return e.fly ? lay.fly : lay.route; }
  function tdPos(run, e) { return tdPointAt(tdRouteFor(run, e), e.d); }
  function tdProgress(run, e) { return e.d / tdRouteFor(run, e).len; }
  function tdBurrowed(run, e) {
    if (!TD_ENEMIES[e.type].burrow) return false;
    var p = tdProgress(run, e);
    return p > 0.3 && p < 0.55;
  }
  function tdVisible(run, e) { return e.alive && e.d >= 0 && !tdBurrowed(run, e); }

  /* -------------------------------- Towers -------------------------------- */

  function tdMaxPathLevel(level) { return level >= 10 ? 5 : level >= 6 ? 4 : 3; }
  function tdCanUpgrade(run, tower, path) {
    var cur = tower[path], other = tower[path === "a" ? "b" : "a"];
    if (cur >= tdMaxPathLevel(run.level)) return false;
    return cur + 1 <= 2 || other <= 2;
  }
  function tdUpgradeCost(tower, path) {
    return Math.round(TD_TOWERS[tower.type].cost * TD_UPGRADE_FACTORS[tower[path]]);
  }
  function tdSellValue(tower) { return Math.round(tower.spent * 0.7); }

  /* Effective stats of a tower (before beacon boosts). */
  function tdStats(t) {
    var a = t.a, b = t.b;
    var A = TD_LEVEL_STEPS[a] || 0, B = TD_LEVEL_STEPS[b] || 0; // stronger from level 3 on
    var s = { range: 16, dmg: 0, ab: {} };
    switch (t.type) {
      case "arrow":
        s.dmg = 9 * (1 + 0.1 * A); s.shots = 1 + (a >= 1) + (a >= 3) + (a >= 5);
        s.extra = b + (b >= 3 ? b - 2 : 0); s.pierce = 2 * Math.min(b, 2) + 3 * Math.max(0, Math.min(b, 4) - 2) + (b >= 5 ? 4 : 0);
        s.range = 16 + (b >= 5 ? 2 : 0);
        if (a >= 3) s.ab.crit = { chance: a >= 5 ? 0.4 : a >= 4 ? 0.3 : 0.25, mult: a >= 5 ? 4 : 3 };
        if (b >= 3) s.ab.ricochet = b >= 5 ? 2 : 1;
        break;
      case "cannon":
        s.dmg = 12 * (1 + 0.08 * Math.min(A, 5.2) + (a >= 5 ? 0.15 : 0)) * (1 + 0.25 * Math.min(B, 5.2) + (b >= 5 ? 0.4 : 0));
        s.splash = 6 + 2 * Math.min(A, 5.2) + (a >= 5 ? 3 : 0); s.shred = 2 + Math.min(b, 4) + (b >= 5 ? 2 : 0); s.range = 14; s.ground = true;
        if (a >= 3) s.ab.burn = { share: a >= 5 ? 0.5 : 0.3, steps: a >= 5 ? 2 : 1 };
        if (b >= 3) s.ab.stun = b >= 5 ? 0.35 : 0.2;
        break;
      case "frost":
        s.slow = Math.min(0.8, 0.3 + 0.08 * Math.min(a, 2) + 0.1 * Math.max(0, Math.min(a, 4) - 2)); s.freeze = a >= 5 ? 0.25 : 0;
        s.range = 12 + 3 * Math.min(B, 5.2) + (b >= 5 ? 4 : 0); s.dmg = 2 + 2 * Math.min(B, 5.2) + (b >= 5 ? 3 : 0);
        if (a >= 3) s.ab.shatter = a >= 5 ? 0.5 : 0.3;
        if (b >= 3) s.ab.frostbite = { armor: b >= 5 ? 2 : 1, fliers: b >= 5 };
        break;
      case "lightning":
        s.dmg = 8 * (1 + 0.25 * Math.min(B, 5.2) + (b >= 5 ? 0.4 : 0)); s.chains = 3 + Math.min(a, 2) + 2 * Math.max(0, Math.min(a, 4) - 2) + (a >= 5 ? 3 : 0); s.range = 15;
        s.falloff = a >= 5 ? 1.1 : a >= 3 ? 1 : 0.8;
        if (b >= 3) s.ab.overload = b >= 5 ? 2 : 3;
        break;
      case "mortar":
        s.dmg = 18 * (1 + 0.15 * Math.min(B, 5.2) + (b >= 5 ? 0.25 : 0)); s.splash = 7; s.cluster = Math.min(a, 2) + (a >= 3 ? 1 : 0) + (a >= 4 ? 2 : 0) + (a >= 5 ? 2 : 0);
        s.range = 30 + 5 * Math.min(B, 5.2) + (b >= 5 ? 6 : 0); s.minRange = 6; s.ground = true; s.slowFire = a < 3; s.bomblet = a >= 5 ? 0.7 : 0.4;
        if (b >= 3) s.ab.knockback = b >= 5 ? 8 : 4;
        break;
      case "beacon":
        s.boost = 0.15 + 0.08 * Math.min(a, 2) + 0.12 * Math.max(0, Math.min(a, 4) - 2) + (a >= 5 ? 0.15 : 0);
        s.goldPer = 2 * Math.min(b, 2) + 3 * Math.max(0, Math.min(b, 4) - 2) + (b >= 5 ? 4 : 0); s.range = 14;
        if (a >= 3) s.ab.overdrive = { range: a >= 5 ? 5 : 3, pierce: a >= 5 ? 3 : 0 };
        if (b >= 3) s.ab.bounty = b >= 5 ? 1 : 0.5;
        break;
      case "venom":
        s.dmg = 3; s.poison = 4 + 2 * Math.min(A, 5.2) + (a >= 5 ? 3 : 0); s.stacks = 3 + a; s.targets = 2 + Math.min(b, 2) + 2 * Math.max(0, Math.min(b, 4) - 2) + (b >= 5 ? 3 : 0);
        s.range = 13 + Math.min(b, 4) + (b >= 5 ? 2 : 0);
        if (a >= 3) s.ab.plague = a >= 5 ? 4 : 2;
        if (b >= 3) s.ab.corrode = { armor: b >= 5 ? 2 : 1, slow: b >= 5 ? 0.25 : 0.15 };
        break;
      case "ballista":
        s.dmg = 40 * (1 + 0.25 * Math.min(A, 5.2) + (a >= 5 ? 0.4 : 0)); s.marks = 1 + 0.3 * Math.min(B, 5.2) + (b >= 5 ? 0.45 : 0);
        s.range = 26 + 2 * Math.min(B, 5.2) + (b >= 5 ? 3 : 0); s.ignoreArmor = true;
        if (a >= 3) s.ab.execute = { under: a >= 5 ? 0.35 : 0.25, boss: a >= 5 ? 1.5 : 1 };
        s.bolts = b >= 5 ? 3 : b >= 3 ? 2 : 1;
        break;
    }
    return s;
  }

  function tdSlotPos(run, slot) { return tdLayout(run.layout).slots[slot]; }

  /* ------------------------------ One step ------------------------------ */

  function tdShielded(run, target) {
    return run.enemies.some(function (o) {
      if (!o.alive || !TD_ENEMIES[o.type].shield || o.d < 0) return false;
      var p = tdPos(run, o), q = tdPos(run, target);
      return Math.hypot(p.x - q.x, p.y - q.y) <= 10;
    });
  }

  /* Apply damage; returns damage dealt (0 on a dodge). */
  function tdHit(run, e, raw, opt, fx) {
    if (!e.alive) return 0;
    opt = opt || {};
    var def = TD_ENEMIES[e.type];
    if (def.dodge && !opt.splash && Math.random() < def.dodge) { fx.push({ kind: "dodge", id: e.id }); return 0; }
    if (tdShielded(run, e)) raw *= 0.7;
    if (e.brittle > 0 && e.slowSteps > 0) raw *= 1 + e.brittle; // Frost: Shatter
    var armor = opt.ignoreArmor ? 0 : Math.max(0, e.armor - (opt.pierce || 0));
    var dmg = Math.max(1, Math.round(raw - armor));
    e.hp -= dmg;
    if (opt.shred) e.armor = Math.max(0, e.armor - opt.shred);
    if (e.hp <= 0) tdKill(run, e, fx, opt.bounty);
    return dmg;
  }

  function tdKill(run, e, fx, bounty) {
    e.alive = false;
    e.hp = 0;
    var def = TD_ENEMIES[e.type];
    var gold = Math.round(def.gold * (run.goldMult || 1) * (1 + (bounty || 0)));
    // Venom: Plague passes the poison on to nearby enemies.
    if (e.plague && e.poison.length) {
      var near = tdNear(run, run.enemies.filter(function (o) { return o.alive && o !== e; }), e, 10).slice(0, e.plague);
      // Pass on the strongest dose only, within the usual stack limit.
      var dose = e.poison.reduce(function (a, p) { return !a || p.dmg > a.dmg ? p : a; }, null);
      near.forEach(function (o) {
        if (o.poison.length < (e.poisonCap || 8)) o.poison.push({ dmg: dose.dmg, steps: 3, corrode: dose.corrode });
        o.plague = e.plague;
        o.poisonCap = e.poisonCap;
      });
    }
    run.gold += gold;
    run.kills++;
    fx.push({ kind: "kill", id: e.id, gold: gold, boss: def.boss });
    if (def.split) {
      var scale = tdHpScale(run, run.wave);
      for (var i = 0; i < 2; i++) {
        var c = tdMakeEnemy(run, "splitling", e.d - 1.5 * i, scale);
        run.enemies.push(c);
        fx.push({ kind: "spawn", id: c.id });
      }
    }
  }

  function tdInRange(run, from, range, minRange, groundOnly) {
    return run.enemies.filter(function (e) {
      if (!tdVisible(run, e)) return false;
      if (groundOnly && e.fly) return false;
      var p = tdPos(run, e);
      var dist = Math.hypot(p.x - from.x, p.y - from.y);
      return dist <= range && dist >= (minRange || 0);
    });
  }
  function tdByFirst(run, list) { return list.sort(function (a, b) { return tdProgress(run, b) - tdProgress(run, a); }); }
  function tdNear(run, list, center, radius) {
    var c = tdPos(run, center);
    return list.filter(function (e) { if (!tdVisible(run, e)) return false; var p = tdPos(run, e); return Math.hypot(p.x - c.x, p.y - c.y) <= radius; });
  }

  /* A correct answer: every tower fires. power = speed and streak bonus. */
  function tdVolley(run, power) {
    var fx = [];
    run.volleys = (run.volleys || 0) + 1;
    var towers = run.towers.map(function (t) { return { t: t, s: tdStats(t), pos: tdSlotPos(run, t.slot) }; });
    // Beacon boosts (the strongest boost in range applies), plus Overdrive
    // range/armor-piercing and Bounty gold from beacons in range.
    towers.forEach(function (x) {
      x.boost = 1; x.extraRange = 0; x.extraPierce = 0; x.bounty = 0;
      towers.forEach(function (bk) {
        if (bk.t.type !== "beacon" || bk === x) return;
        if (Math.hypot(bk.pos.x - x.pos.x, bk.pos.y - x.pos.y) > bk.s.range) return;
        x.boost = Math.max(x.boost, 1 + bk.s.boost);
        if (bk.s.ab.overdrive) { x.extraRange = Math.max(x.extraRange, bk.s.ab.overdrive.range); x.extraPierce = Math.max(x.extraPierce, bk.s.ab.overdrive.pierce); }
        if (bk.s.ab.bounty) x.bounty = Math.max(x.bounty, bk.s.ab.bounty);
      });
      if (x.t.type === "beacon" && x.s.goldPer) { run.gold += x.s.goldPer; fx.push({ kind: "gold", slot: x.t.slot, gold: x.s.goldPer }); }
    });
    towers.forEach(function (x) {
      var t = x.t, s = x.s, pos = x.pos, ab = s.ab;
      var mult = power * x.boost * TD_POWER;
      if (t.type === "beacon") return;
      if (s.slowFire) { t.charge = !t.charge; if (!t.charge) return; }
      var range = s.range + x.extraRange;
      var targets = tdInRange(run, pos, range, s.minRange, s.ground);
      if (!targets.length) return;
      var base = { bounty: x.bounty, pierce: x.extraPierce };
      var withBase = function (opt) {
        var o = Object.assign({}, base, opt || {});
        o.pierce = (opt && opt.pierce || 0) + x.extraPierce;
        return o;
      };
      var shot = function (e, dmg, opt) { fx.push({ kind: "shot", slot: t.slot, id: e.id, type: t.type }); return tdHit(run, e, dmg, withBase(opt), fx); };
      if (t.type === "arrow") {
        for (var i = 0; i < s.shots; i++) {
          var live = tdByFirst(run, targets.filter(function (e) { return e.alive; }));
          if (!live.length) break;
          live.slice(0, 1 + s.extra).forEach(function (e) {
            var dmg = s.dmg * mult;
            if (ab.crit && Math.random() < ab.crit.chance) { dmg *= ab.crit.mult; fx.push({ kind: "crit", id: e.id }); }
            shot(e, dmg, { pierce: s.pierce });
            // Ricochet: a killing shot carries on to the next enemy.
            var cur = e;
            for (var r = 0; ab.ricochet && r < ab.ricochet && !cur.alive; r++) {
              var nextOne = tdByFirst(run, tdNear(run, run.enemies, cur, 12).filter(function (o) { return o.alive; }))[0];
              if (!nextOne) break;
              fx.push({ kind: "zap", id: nextOne.id, slot: null, from: cur.id });
              tdHit(run, nextOne, dmg, withBase({ pierce: s.pierce }), fx);
              cur = nextOne;
            }
          });
        }
      } else if (t.type === "cannon") {
        var first = tdByFirst(run, targets)[0];
        fx.push({ kind: "blast", id: first.id, r: s.splash, type: t.type, slot: t.slot });
        tdNear(run, run.enemies.filter(function (e) { return !e.fly; }), first, s.splash).forEach(function (e) {
          var dealt = tdHit(run, e, s.dmg * mult, withBase({ splash: true, shred: s.shred }), fx);
          if (!e.alive) return;
          if (ab.burn && dealt) e.poison.push({ dmg: dealt * ab.burn.share, steps: ab.burn.steps });
          if (ab.stun && !e.boss && Math.random() < ab.stun) { e.frozen = Math.max(e.frozen, 1); fx.push({ kind: "stun", id: e.id }); }
        });
      } else if (t.type === "frost") {
        fx.push({ kind: "aura", slot: t.slot, r: range, type: t.type });
        targets.forEach(function (e) {
          var def = TD_ENEMIES[e.type];
          if (!def.noSlow) {
            e.slow = Math.max(e.slow, s.slow); e.slowSteps = 2;
            if (ab.shatter) e.brittle = Math.max(e.brittle || 0, ab.shatter);
            if (s.freeze && !e.boss && Math.random() < s.freeze) e.frozen = 1;
          }
          if (ab.frostbite) {
            e.armor = Math.max(0, e.armor - ab.frostbite.armor);
            if (ab.frostbite.fliers && e.fly && !e.boss && Math.random() < 0.15) e.frozen = 1;
          }
          tdHit(run, e, s.dmg * mult, withBase({ splash: true }), fx);
        });
      } else if (t.type === "lightning") {
        // Overload: every few volleys, strike everything in range at once.
        if (ab.overload && run.volleys % ab.overload === 0) {
          targets.forEach(function (e) {
            fx.push({ kind: "zap", id: e.id, slot: t.slot, from: null });
            tdHit(run, e, s.dmg * mult, withBase({ splash: true }), fx);
          });
          return;
        }
        var cur = tdByFirst(run, targets)[0], hit = {}, dmg = s.dmg * mult, prevId = null;
        for (var j = 0; j < s.chains && cur; j++) {
          hit[cur.id] = true;
          fx.push({ kind: "zap", id: cur.id, slot: j === 0 ? t.slot : null, from: prevId });
          prevId = cur.id;
          tdHit(run, cur, dmg, withBase({ splash: true }), fx);
          dmg *= s.falloff; // Arc storm: no weakening (or stronger) per jump
          var cands = tdNear(run, run.enemies, cur, 11).filter(function (e) { return !hit[e.id]; });
          cur = tdByFirst(run, cands)[0];
        }
      } else if (t.type === "mortar") {
        // Aim at the densest group.
        var best = null, bestN = -1;
        targets.forEach(function (e) { var n = tdNear(run, targets, e, s.splash).length; if (n > bestN) { bestN = n; best = e; } });
        var blast = function (center, r, dmg) {
          fx.push({ kind: "blast", id: center.id, r: r, type: t.type, slot: t.slot });
          tdNear(run, run.enemies.filter(function (e) { return !e.fly; }), center, r).forEach(function (e) {
            tdHit(run, e, dmg, withBase({ splash: true }), fx);
            // Earthquake: knock survivors back along the road (not bosses).
            if (ab.knockback && e.alive && !e.boss) e.d = Math.max(0, e.d - ab.knockback);
          });
        };
        blast(best, s.splash, s.dmg * mult);
        for (var k = 0; k < s.cluster; k++) {
          var rest = targets.filter(function (e) { return e.alive; });
          if (!rest.length) break;
          blast(rest[Math.floor(Math.random() * rest.length)], 4, s.dmg * mult * s.bomblet);
        }
      } else if (t.type === "venom") {
        targets.slice().sort(function (p, q) { return p.poison.length - q.poison.length || tdProgress(run, q) - tdProgress(run, p); })
          .slice(0, s.targets).forEach(function (e) {
            fx.push({ kind: "shot", slot: t.slot, id: e.id, type: t.type });
            var dose = { dmg: s.poison * mult, steps: 3, corrode: ab.corrode || null };
            if (e.poison.length < s.stacks) e.poison.push(dose);
            else { e.poison[0].steps = 3; if (ab.corrode) e.poison[0].corrode = ab.corrode; }
            if (ab.plague) { e.plague = Math.max(e.plague || 0, ab.plague); e.poisonCap = Math.max(e.poisonCap || 0, s.stacks); }
            tdHit(run, e, s.dmg * mult, withBase({ splash: true }), fx);
          });
      } else if (t.type === "ballista") {
        // Twin bolts: the toughest one, two or three enemies.
        targets.slice().sort(function (p, q) { return q.hp - p.hp; }).slice(0, s.bolts).forEach(function (e) {
          var bonus = e.fly || e.boss ? s.marks : 1;
          if (ab.execute && e.boss) bonus *= ab.execute.boss;
          shot(e, s.dmg * mult * bonus, { ignoreArmor: true });
          if (ab.execute && e.alive && !e.boss && e.hp <= e.max * ab.execute.under) {
            fx.push({ kind: "crit", id: e.id });
            tdKill(run, e, fx, x.bounty);
          }
        });
      }
    });
    return fx;
  }

  /* Enemies move. factor 1 after a correct answer, 2 after a miss. */
  function tdMove(run, factor) {
    var fx = [];
    var night = run.tier === "nightmare";
    var speedMult = (run.rules && run.rules.speed || 1) * (night && run.wave >= 11 ? 1.2 : 1);
    var lay = tdLayout(run.layout);
    var mapScale = clamp(Math.sqrt(lay.route.len / 230), 0.9, 1.35); // longer maps move a little faster per step
    run.enemies.forEach(function (e) {
      if (!e.alive) return;
      var def = TD_ENEMIES[e.type];
      // Poison ticks.
      if (e.poison.length && e.d >= 0) {
        var pd = 0;
        e.poison.forEach(function (p) {
          pd += p.dmg; p.steps--;
          // Venom: Corrode eats armor and slows.
          if (p.corrode) { e.armor = Math.max(0, e.armor - p.corrode.armor); if (!TD_ENEMIES[e.type].noSlow) { e.slow = Math.max(e.slow, p.corrode.slow); e.slowSteps = Math.max(e.slowSteps, 1); } }
        });
        e.poison = e.poison.filter(function (p) { return p.steps > 0; });
        e.hp -= Math.round(pd);
        if (e.hp <= 0) { tdKill(run, e, fx); return; }
      }
      if (def.selfHeal && e.d >= 0) e.hp = Math.min(e.max, Math.round(e.hp + e.max * def.selfHeal));
      var step = TD_STEP * def.spd * speedMult * mapScale * factor;
      if (e.frozen > 0) { step = 0; e.frozen--; }
      else if (e.slowSteps > 0) { step *= 1 - e.slow; e.slowSteps--; if (!e.slowSteps) e.slow = 0; }
      if (tdBurrowed(run, e)) step *= 1.6;
      // Fliers take a shortcut; on maps where the shortcut is tiny they fly slower.
      if (e.fly) step *= Math.min(1, lay.fly.len / (0.6 * lay.route.len));
      e.d += step;
      var len = tdRouteFor(run, e).len;
      if (e.d >= len) {
        e.alive = false;
        e.leaked = true;
        run.lives = Math.max(0, run.lives - def.lives);
        run.leaked += def.lives;
        run.waveLeaked += def.lives;
        fx.push({ kind: "leak", id: e.id, lives: def.lives });
      }
    });
    // Healers.
    run.enemies.forEach(function (h) {
      if (!h.alive || !TD_ENEMIES[h.type].heal || h.d < 0) return;
      var amount = Math.round(5 * tdHpScale(run, run.wave) * (night && run.wave >= 31 ? 2 : 1));
      tdNear(run, run.enemies, h, 12).forEach(function (e) {
        if (e === h || e.hp >= e.max) return;
        e.hp = Math.min(e.max, e.hp + amount);
        if (night && run.wave >= 31) { e.slow = 0; e.slowSteps = 0; }
        fx.push({ kind: "heal", id: e.id });
      });
    });
    run.enemies = run.enemies.filter(function (e) { return e.alive; });
    run.steps++;
    return fx;
  }

  function tdWaveOver(run) { return run.waveActive && !run.enemies.some(function (e) { return e.alive; }); }

  /* Gold for clearing a wave. */
  function tdWaveBonus(run) { return Math.round((20 + 4 * run.wave) * (run.goldMult || 1)); }

  function tdStars(run) {
    var f = run.lives / run.maxLives;
    return f >= 0.85 ? 3 : f >= 0.5 ? 2 : 1;
  }

  /* Build / upgrade / sell. Return an error string or "". */
  function tdBuild(run, slot, type) {
    if (run.towers.some(function (t) { return t.slot === slot; })) return "That slot is taken.";
    var def = TD_TOWERS[type];
    if (run.rules && run.rules.only && run.rules.only.indexOf(type) === -1) return "This challenge only allows " + run.rules.only.map(function (k) { return TD_TOWERS[k].name; }).join(" and ") + ".";
    if (run.gold < def.cost) return "Not enough gold.";
    run.gold -= def.cost;
    run.towers.push({ slot: slot, type: type, a: 0, b: 0, spent: def.cost, charge: false });
    return "";
  }
  function tdUpgrade(run, tower, path) {
    if (!tdCanUpgrade(run, tower, path)) return "That path can't go higher.";
    var cost = tdUpgradeCost(tower, path);
    if (run.gold < cost) return "Not enough gold.";
    run.gold -= cost;
    tower.spent += cost;
    tower[path]++;
    return "";
  }
  function tdSell(run, tower) {
    if (run.rules && run.rules.noSell) return "Selling is off in this challenge.";
    run.gold += tdSellValue(tower);
    run.towers = run.towers.filter(function (t) { return t !== tower; });
    return "";
  }

