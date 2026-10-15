  /* ============================== Study Garden ==============================
     Spaced review as a garden. Every question is a seed. A correct answer
     waters the plant and it grows a stage; each stage waits longer before
     it needs water again (1, 3, 7, 14, then 30 days). A wrong answer wilts
     it back a stage and it comes up tomorrow. Full bloom marks the question
     completed. No levels, no reset, no bots: it runs on the review clock. */

  var GARDEN_STAGES = ["Seed", "Sprout", "Seedling", "Budding", "Flowering", "Full bloom"];
  var GARDEN_WAIT = [1, 1, 3, 7, 14, 30]; // days until next watering after reaching each stage
  var GARDEN_PLOTS = [
    { id: "veg", name: "Vegetable beds", share: 0, soil: "#8d6e4f" },
    { id: "flower", name: "Flower beds", share: 0.03, soil: "#7a5a3c" },
    { id: "water", name: "Pond", share: 0.1, soil: "#4f8fbf" },
    { id: "green", name: "Greenhouse", share: 0.25, soil: "#a7c4a0" },
    { id: "tree", name: "Orchard", share: 0.45, soil: "#6f8f4e" }
  ];
  var GARDEN_SPECIES = [
    ["lettuce", "Lettuce", "veg", "leafy", 110], ["carrot", "Carrot", "veg", "root", 28], ["tomato", "Tomato", "veg", "fruit", 4],
    ["radish", "Radish", "veg", "root", 340], ["pepper", "Pepper", "veg", "fruit", 48], ["pumpkin", "Pumpkin", "veg", "fruit", 30],
    ["daisy", "Daisy", "flower", "flower", 55], ["tulip", "Tulip", "flower", "flower", 350], ["sunflower", "Sunflower", "flower", "flower", 45],
    ["rose", "Rose", "flower", "flower", 345], ["lavender", "Lavender", "flower", "flower", 270], ["poppy", "Poppy", "flower", "flower", 8],
    ["marigold", "Marigold", "flower", "flower", 35],
    ["lily", "Water lily", "water", "lily", 320], ["lotus", "Lotus", "water", "lily", 335], ["iris", "Iris", "water", "flower", 255],
    ["cattail", "Cattail", "water", "fern", 30], ["watermint", "Water mint", "water", "leafy", 140],
    ["orchid", "Orchid", "green", "flower", 300], ["cactus", "Cactus", "green", "cactus", 330], ["fern", "Fern", "green", "fern", 120],
    ["aloe", "Aloe", "green", "cactus", 15], ["paradise", "Bird of paradise", "green", "flower", 25], ["flytrap", "Venus flytrap", "green", "leafy", 0],
    ["apple", "Apple tree", "tree", "tree", 0], ["cherry", "Cherry blossom", "tree", "tree", 335], ["lemon", "Lemon tree", "tree", "tree", 52],
    ["peach", "Peach tree", "tree", "tree", 22], ["plum", "Plum tree", "tree", "tree", 280], ["fig", "Fig tree", "tree", "tree", 95]
  ].map(function (s) { return { id: s[0], name: s[1], plot: s[2], shape: s[3], hue: s[4] }; });
  var GARDEN_SEASONS = [
    { id: "spring", name: "Spring", sky: "#bfe3ff", grass: "#8fd06a" },
    { id: "summer", name: "Summer", sky: "#9fd3ff", grass: "#6dbb4a" },
    { id: "autumn", name: "Autumn", sky: "#f3d9b1", grass: "#c2a14d" },
    { id: "winter", name: "Winter", sky: "#dfe8f2", grass: "#e9eef3" }
  ];
  var GARDEN_DECOR = [
    { id: "path", name: "Stone path", price: 50 }, { id: "gnome", name: "Garden gnome", price: 60 },
    { id: "fence", name: "Picket fence", price: 80 }, { id: "bench", name: "Bench", price: 120 },
    { id: "lanterns", name: "Lanterns", price: 150 }, { id: "birdbath", name: "Bird bath", price: 200 },
    { id: "arch", name: "Rose arch", price: 300 }, { id: "fountain", name: "Fountain", price: 400 }
  ];
  /* Visitors come when the garden meets a condition. */
  var GARDEN_VISITORS = [
    { id: "bee", name: "Bee", color: "#f2c94c", desc: "A flower is flowering", test: function (s) { return s.flowering.flower >= 1; } },
    { id: "ladybug", name: "Ladybug", color: "#e63946", desc: "A vegetable reaches the budding stage", test: function (s) { return s.budding.veg >= 1; } },
    { id: "butterfly", name: "Butterfly", color: "#9b5de5", desc: "Three flowers are flowering", test: function (s) { return s.flowering.flower >= 3; } },
    { id: "robin", name: "Robin", color: "#d1495b", desc: "Five plants in full bloom", test: function (s) { return s.blooms >= 5; } },
    { id: "rabbit", name: "Rabbit", color: "#b8a99a", desc: "Two vegetables in full bloom", test: function (s) { return s.bloom.veg >= 2; } },
    { id: "frog", name: "Frog", color: "#55a630", desc: "A pond plant is flowering", test: function (s) { return s.flowering.water >= 1; } },
    { id: "duck", name: "Duck", color: "#2a9d8f", desc: "Two pond plants in full bloom", test: function (s) { return s.bloom.water >= 2; } },
    { id: "songbird", name: "Songbird", color: "#f4a261", desc: "Five flowers in full bloom", test: function (s) { return s.bloom.flower >= 5; } },
    { id: "hedgehog", name: "Hedgehog", color: "#8d6e63", desc: "Eight blooms in autumn", test: function (s) { return s.season === "autumn" && s.blooms >= 8; } },
    { id: "fox", name: "Fox", color: "#e76f51", desc: "Twelve blooms in winter", test: function (s) { return s.season === "winter" && s.blooms >= 12; } },
    { id: "deer", name: "Deer", color: "#a0522d", desc: "A fruit tree in full bloom", test: function (s) { return s.bloom.tree >= 1; } },
    { id: "owl", name: "Owl", color: "#6d597a", desc: "Twenty-five plants in full bloom", test: function (s) { return s.blooms >= 25; } }
  ];

  function gardenDay(date) {
    var d = date || new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }
  function gardenSeason(day) { return GARDEN_SEASONS[Math.floor(((day === undefined ? gardenDay() : day) + 3) / 7) % 4]; }
  function gardenDayText(day) {
    var diff = day - gardenDay();
    if (diff <= 0) return "today";
    if (diff === 1) return "tomorrow";
    if (diff < 7) return "in " + diff + " days";
    return new Date(day * 86400000).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric" });
  }

  function freshGardenProfile() { return { plants: Object.create(null), coins: 0, gp: 0, decor: {}, visitors: {}, seedSize: 5 }; }
  function parseGardenProfile(src) {
    var p = freshGardenProfile();
    if (!src || typeof src !== "object") return p;
    var num = function (v, d) { return typeof v === "number" && isFinite(v) ? v : d; };
    var species = {};
    GARDEN_SPECIES.forEach(function (s) { species[s.id] = true; });
    if (src.plants && typeof src.plants === "object") Object.keys(src.plants).forEach(function (k) {
      var pl = src.plants[k];
      if (!pl || typeof pl !== "object" || !hasOwn(species, pl.species)) return;
      p.plants[k] = { stage: clamp(Math.floor(num(pl.stage, 0)), 0, 5), due: Math.floor(num(pl.due, gardenDay())), species: pl.species,
        bloomed: pl.bloomed === true, waterings: Math.max(0, Math.floor(num(pl.waterings, 0))) };
      if (typeof pl.lastWatered === "number" && isFinite(pl.lastWatered)) p.plants[k].lastWatered = Math.floor(pl.lastWatered);
    });
    p.coins = Math.max(0, Math.floor(num(src.coins, 0)));
    p.gp = Math.max(0, Math.floor(num(src.gp, 0)));
    if (src.decor && typeof src.decor === "object") GARDEN_DECOR.forEach(function (d) { if (src.decor[d.id] === true) p.decor[d.id] = true; });
    if (src.visitors && typeof src.visitors === "object") GARDEN_VISITORS.forEach(function (v) { var day = num(src.visitors[v.id], 0); if (day > 0) p.visitors[v.id] = Math.floor(day); });
    if ([5, 10, 20].indexOf(src.seedSize) !== -1) p.seedSize = src.seedSize;
    return p;
  }

  function gardenProfile() { return state.gameData.garden; }

  /* Plants for questions still in the bank. */
  function gardenEntries() {
    var p = gardenProfile();
    if (!state.unit) return [];
    // A question that appears twice in the bank is one plant.
    var seen = new Set();
    return state.unit.questions.filter(function (q) {
      var k = completedKey(q);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map(function (q) { return { q: q, key: completedKey(q), plant: p.plants[completedKey(q)] || null }; });
  }
  function gardenStats(given) {
    var entries = given || gardenEntries();
    var today = gardenDay();
    var s = { total: entries.length, planted: 0, due: 0, blooms: 0, nextDay: null, nextCount: 0,
      flowering: { veg: 0, flower: 0, water: 0, green: 0, tree: 0 }, budding: { veg: 0, flower: 0, water: 0, green: 0, tree: 0 },
      bloom: { veg: 0, flower: 0, water: 0, green: 0, tree: 0 }, season: gardenSeason().id };
    entries.forEach(function (e) {
      var pl = e.plant;
      if (!pl) return;
      s.planted++;
      var type = gardenSpecies(pl.species).plot;
      if (pl.due <= today) s.due++;
      else if (s.nextDay === null || pl.due < s.nextDay) { s.nextDay = pl.due; s.nextCount = 1; }
      else if (pl.due === s.nextDay) s.nextCount++;
      if (pl.stage >= 3) s.budding[type]++;
      if (pl.stage >= 4) s.flowering[type]++;
      if (pl.stage >= 5) { s.blooms++; s.bloom[type]++; }
    });
    return s;
  }
  function gardenSpecies(id) { for (var i = 0; i < GARDEN_SPECIES.length; i++) if (GARDEN_SPECIES[i].id === id) return GARDEN_SPECIES[i]; return GARDEN_SPECIES[0]; }
  function gardenPlotOpen(plot, stats) {
    return stats.blooms >= Math.ceil(plot.share * Math.max(1, stats.total)) && (plot.share === 0 || stats.blooms >= 1);
  }
  /* Species unlock gradually within each open plot as the garden grows. */
  function gardenUnlockedSpecies(stats, gp) {
    var out = [];
    GARDEN_PLOTS.forEach(function (plot) {
      if (!gardenPlotOpen(plot, stats)) return;
      GARDEN_SPECIES.filter(function (sp) { return sp.plot === plot.id; }).forEach(function (sp, k) {
        if (k < 2 || gp >= (k - 1) * 10) out.push(sp);
      });
    });
    return out;
  }

  function gardenPickSpecies(stats) {
    var list = gardenUnlockedSpecies(stats, gardenProfile().gp);
    // Lean toward the newest plots so new areas fill up.
    var weights = list.map(function (sp) { return 1 + GARDEN_PLOTS.map(function (p) { return p.id; }).indexOf(sp.plot); });
    var total = weights.reduce(function (a, b) { return a + b; }, 0), r = Math.random() * total;
    for (var i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
    return list[0];
  }

  /* Full-bloom plants in other beds that could move to this one; the most
     crowded beds give theirs first. */
  function gardenTransplantable(entries, plotId) {
    var counts = {};
    entries.forEach(function (e) { if (e.plant) { var id = gardenSpecies(e.plant.species).plot; counts[id] = (counts[id] || 0) + 1; } });
    var seen = new Set();
    return entries.filter(function (e) {
      if (!e.plant || e.plant.stage !== 5 || seen.has(e.key)) return false;
      seen.add(e.key);
      var from = gardenSpecies(e.plant.species).plot;
      return from !== plotId && counts[from] > 1;
    }).sort(function (a, b) { return counts[gardenSpecies(b.plant.species).plot] - counts[gardenSpecies(a.plant.species).plot]; });
  }
  function gardenTransplant(plotId) {
    var p = gardenProfile(), entries = gardenEntries(), stats = gardenStats(entries);
    var plot = GARDEN_PLOTS.filter(function (x) { return x.id === plotId; })[0];
    if (!plot || !gardenPlotOpen(plot, stats)) return;
    var species = gardenUnlockedSpecies(stats, p.gp).filter(function (sp) { return sp.plot === plotId; });
    if (!species.length) return;
    var moved = gardenTransplantable(entries, plotId).slice(0, p.seedSize);
    moved.forEach(function (e, i) { p.plants[e.key].species = species[i % species.length].id; });
    if (!moved.length) return;
    notify("Moved " + moved.length + (moved.length === 1 ? " bloom" : " blooms") + " to the " + plot.name.toLowerCase() + ".");
    persistCompleted();
    renderGarden();
  }

  /* Checks visitors; returns the newly arrived ones. */
  function gardenCheckVisitors() {
    var p = gardenProfile(), s = gardenStats();
    var fresh = [];
    GARDEN_VISITORS.forEach(function (v) {
      if (!p.visitors[v.id] && v.test(s)) { p.visitors[v.id] = gardenDay(); fresh.push(v); }
    });
    return fresh;
  }

  /* ------------------------------- Drawing ------------------------------- */

  // The same species and stage always draw the same picture.
  var gardenSvgCache = new Map();
  function gardenPlantSvgCached(sp, stage) {
    var k = sp.id + ":" + stage + ":" + gardenSeason().id; // the drawing follows the season
    var svg = gardenSvgCache.get(k);
    if (svg === undefined) { svg = gardenPlantSvg(sp, stage); gardenSvgCache.set(k, svg); }
    return svg;
  }
  var GARDEN_TILE_LIMIT = 240; // per bed; the rest are summarized

  function gardenPlantSvg(sp, stage, opts) {
    opts = opts || {};
    var season = opts.season || gardenSeason();
    var h = sp.hue, petal = "hsl(" + h + ",75%,62%)", petalDark = "hsl(" + h + ",70%,42%)";
    var leaf = season.id === "autumn" && sp.shape === "tree" ? "#c8782f" : "#3f9b3f", leafLight = season.id === "autumn" && sp.shape === "tree" ? "#e0a050" : "#6cc24a";
    var parts = [];
    var add = function (s) { parts.push(s); };
    add('<ellipse cx="20" cy="46" rx="13" ry="3.2" fill="rgba(0,0,0,.18)"/>');
    if (stage === 0) {
      add('<ellipse cx="20" cy="44" rx="8" ry="3.5" fill="#7a5230"/><ellipse cx="20" cy="42.5" rx="2.2" ry="1.6" fill="#d9b382"/>');
    } else if (sp.shape === "tree") {
      var trunkH = [0, 8, 14, 20, 24, 26][stage], crown = [0, 4, 7, 10, 12, 13][stage];
      add('<rect x="18.5" y="' + (45 - trunkH) + '" width="3" height="' + trunkH + '" rx="1" fill="#7b5534"/>');
      add('<circle cx="20" cy="' + (45 - trunkH) + '" r="' + crown + '" fill="' + leaf + '"/><circle cx="' + (20 - crown * 0.4) + '" cy="' + (44 - trunkH - crown * 0.3) + '" r="' + crown * 0.55 + '" fill="' + leafLight + '"/>');
      if (stage >= 4) for (var i = 0; i < (stage === 5 ? 7 : 4); i++) {
        var a = i * 2.4, rr = crown * 0.65;
        add('<circle cx="' + (20 + Math.cos(a) * rr).toFixed(1) + '" cy="' + (45 - trunkH + Math.sin(a) * rr).toFixed(1) + '" r="' + (stage === 5 ? 2 : 1.4) + '" fill="' + petal + '"/>');
      }
    } else if (sp.shape === "cactus") {
      var ch = [0, 6, 11, 16, 20, 22][stage];
      add('<rect x="16" y="' + (45 - ch) + '" width="8" height="' + ch + '" rx="4" fill="#4c9a5b"/>');
      if (stage >= 2) add('<rect x="10" y="' + (40 - ch * 0.5) + '" width="5" height="' + ch * 0.4 + '" rx="2.5" fill="#4c9a5b"/>');
      if (stage >= 3) add('<rect x="25" y="' + (38 - ch * 0.6) + '" width="5" height="' + ch * 0.45 + '" rx="2.5" fill="#4c9a5b"/>');
      if (stage >= 4) add('<circle cx="20" cy="' + (44 - ch) + '" r="' + (stage === 5 ? 3.6 : 2.4) + '" fill="' + petal + '"/>');
    } else if (sp.shape === "lily") {
      add('<ellipse cx="20" cy="43" rx="' + (6 + stage * 1.6) + '" ry="' + (2 + stage * 0.5) + '" fill="#3f9b3f"/>');
      if (stage >= 3) add('<circle cx="20" cy="' + (39 - stage) + '" r="' + (stage - 1.2) + '" fill="' + petal + '" stroke="' + petalDark + '" stroke-width=".6"/>');
      if (stage >= 4) add('<circle cx="20" cy="' + (39 - stage) + '" r="' + (stage === 5 ? 1.8 : 1.2) + '" fill="#ffd166"/>');
    } else {
      var sh = [0, 6, 12, 18, 22, 25][stage];
      add('<path d="M20 45 L20 ' + (45 - sh) + '" stroke="#3f8f3a" stroke-width="1.6"/>');
      var leaves = Math.min(stage + 1, 4);
      for (var j = 0; j < leaves; j++) {
        var y = 44 - (j + 1) * sh / (leaves + 1), side = j % 2 ? 1 : -1;
        var len = sp.shape === "leafy" ? 8 : sp.shape === "fern" ? 9 : 5.5;
        add('<ellipse cx="' + (20 + side * len * 0.55) + '" cy="' + y.toFixed(1) + '" rx="' + (len * 0.6) + '" ry="' + (len * 0.25) + '" fill="' + leafLight + '" transform="rotate(' + (side * -25) + ' ' + (20 + side * len * 0.55) + ' ' + y.toFixed(1) + ')"/>');
      }
      var top = 45 - sh;
      if (sp.shape === "leafy" && stage >= 3) add('<circle cx="20" cy="' + (top + 2) + '" r="' + (stage + 1) + '" fill="' + (sp.id === "flytrap" ? "#c0392b" : leaf) + '"/>');
      if (sp.shape === "root" && stage >= 3) add('<path d="M17 45 Q20 ' + (49 + stage) + ' 23 45 Z" fill="' + petal + '"/>');
      if (sp.shape === "fruit" && stage >= 3) for (var f = 0; f < stage - 2; f++) add('<circle cx="' + (16 + f * 4) + '" cy="' + (top + 6 + (f % 2) * 3) + '" r="' + (stage === 5 ? 2.6 : 1.8) + '" fill="' + petal + '"/>');
      if (sp.shape === "fern" && stage >= 3) add('<rect x="19" y="' + (top - 4) + '" width="2.4" height="' + (stage + 2) + '" rx="1.2" fill="#8d5a2b"/>');
      if (sp.shape === "flower") {
        if (stage === 3) add('<ellipse cx="20" cy="' + top + '" rx="2" ry="3" fill="' + petalDark + '"/>');
        if (stage >= 4) {
          var pr = stage === 5 ? 5 : 3.6, n = sp.id === "tulip" ? 3 : 6;
          for (var k = 0; k < n; k++) {
            var ang = k * Math.PI * 2 / n;
            add('<circle cx="' + (20 + Math.cos(ang) * pr * 0.7).toFixed(1) + '" cy="' + (top + Math.sin(ang) * pr * 0.7).toFixed(1) + '" r="' + (pr * 0.55).toFixed(1) + '" fill="' + petal + '"/>');
          }
          add('<circle cx="20" cy="' + top + '" r="' + (pr * 0.4).toFixed(1) + '" fill="' + (sp.id === "sunflower" ? "#5b3a1a" : "#ffd166") + '"/>');
        }
      }
    }
    if (stage === 5) add('<path d="M33 8 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1z" fill="#ffd166"/>');
    if (opts.wilt) parts.push('<path d="M8 10 q12 -6 24 0" stroke="#8a6d3b" stroke-width="1" fill="none" opacity=".6"/>');
    if (season.id === "winter" && stage > 0) add('<ellipse cx="20" cy="45.5" rx="11" ry="1.6" fill="#fff" opacity=".9"/>');
    return '<svg viewBox="0 0 40 50" class="garden-plant' + (opts.wilt ? " wilted" : "") + '" aria-hidden="true">' + parts.join("") + '</svg>';
  }

  function gardenSceneSvg(p, stats) {
    var season = gardenSeason();
    var s = [];
    s.push('<rect width="1000" height="140" fill="' + season.sky + '"/>');
    s.push('<circle cx="900" cy="34" r="20" fill="' + (season.id === "winter" ? "#f5f7fa" : "#ffd166") + '"/>');
    s.push('<path d="M0 96 Q250 70 500 92 T1000 88 L1000 140 L0 140 Z" fill="' + season.grass + '"/>');
    if (p.decor.path) s.push('<path d="M430 140 Q470 112 520 100 L560 100 Q520 116 500 140 Z" fill="#c9c1b6"/>');
    if (p.decor.fence) for (var i = 0; i < 18; i++) s.push('<rect x="' + (20 + i * 22) + '" y="86" width="8" height="30" fill="#fff" stroke="#bbb"/>'), (i < 17 && s.push('<rect x="' + (20 + i * 22) + '" y="96" width="30" height="5" fill="#fff"/>'));
    if (p.decor.bench) s.push('<rect x="640" y="100" width="70" height="8" rx="2" fill="#8b5a2b"/><rect x="645" y="108" width="6" height="14" fill="#5c3a1a"/><rect x="698" y="108" width="6" height="14" fill="#5c3a1a"/><rect x="640" y="88" width="70" height="6" rx="2" fill="#8b5a2b"/>');
    if (p.decor.lanterns) [470, 760, 860].forEach(function (x) { s.push('<rect x="' + (x - 1) + '" y="70" width="3" height="50" fill="#444"/><rect x="' + (x - 6) + '" y="60" width="13" height="14" rx="2" fill="#ffd166" stroke="#444"/>'); });
    if (p.decor.birdbath) s.push('<rect x="790" y="96" width="8" height="26" fill="#bbb"/><ellipse cx="794" cy="96" rx="22" ry="6" fill="#ccc"/><ellipse cx="794" cy="94" rx="16" ry="3" fill="#7ec8e3"/>');
    if (p.decor.gnome) s.push('<path d="M592 92 L600 70 L608 92 Z" fill="#e63946"/><circle cx="600" cy="96" r="7" fill="#f1c27d"/><path d="M593 100 Q600 112 607 100 Z" fill="#fff"/><rect x="593" y="104" width="14" height="14" rx="3" fill="#2a6fdb"/>');
    if (p.decor.arch) s.push('<path d="M300 124 L300 70 Q330 36 360 70 L360 124" stroke="#7a4e2a" stroke-width="6" fill="none"/>' + [0, 1, 2, 3, 4, 5].map(function (k) { return '<circle cx="' + (300 + k * 12) + '" cy="' + (66 - Math.sin(k / 5 * Math.PI) * 28) + '" r="5" fill="#e75480"/>'; }).join(""));
    if (p.decor.fountain) s.push('<ellipse cx="160" cy="118" rx="44" ry="10" fill="#9aa5b1"/><ellipse cx="160" cy="114" rx="36" ry="6" fill="#7ec8e3"/><rect x="155" y="78" width="10" height="36" fill="#9aa5b1"/><path d="M160 76 Q150 60 140 80 M160 76 Q170 60 180 80" stroke="#7ec8e3" stroke-width="3" fill="none"/>');
    if (season.id === "winter") for (var f = 0; f < 40; f++) s.push('<circle cx="' + ((f * 97) % 1000) + '" cy="' + ((f * 53) % 90) + '" r="2" fill="#fff"/>');
    if (season.id === "autumn") for (var l = 0; l < 14; l++) s.push('<ellipse cx="' + ((l * 131) % 1000) + '" cy="' + (40 + (l * 37) % 60) + '" rx="4" ry="2" fill="#d2691e" transform="rotate(' + (l * 40) + ' ' + ((l * 131) % 1000) + ' ' + (40 + (l * 37) % 60) + ')"/>');
    // Today's visitors wander in the scene.
    GARDEN_VISITORS.forEach(function (v, k) {
      if (!p.visitors[v.id] || !v.test(stats)) return;
      var x = 60 + ((k * 173) % 880), y = 104 + (k % 3) * 8;
      s.push('<g class="garden-visitor"><circle cx="' + x + '" cy="' + y + '" r="7" fill="' + v.color + '" stroke="rgba(0,0,0,.35)"/><text x="' + x + '" y="' + (y - 11) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#333">' + v.name + '</text></g>');
    });
    return '<svg viewBox="0 0 1000 140" class="garden-scene" role="img" aria-label="Your garden">' + s.join("") + '</svg>';
  }

  /* ------------------------------- Screen ------------------------------- */

  function openGarden() {
    if (!state.unit) return;
    showScreen("garden");
    byId("garden-plots").textContent = "Loading your garden…";
    // Until this bank's garden has loaded, a change would go to a profile
    // that's about to be replaced: the controls wait for it (renderGarden).
    ["garden-water-btn", "garden-seed-btn", "garden-seed-size", "garden-shop-btn"].forEach(function (id) { byId(id).disabled = true; });
    state.completedReady.then(function () {
      if (state.screen !== "garden") return;
      var fresh = gardenCheckVisitors();
      fresh.forEach(function (v) { notify("A visitor arrived: " + v.name + "! (" + v.desc + ")"); });
      if (fresh.length) persistCompleted();
      renderGarden();
    });
  }

  function renderGarden() {
    var p = gardenProfile(), entries = gardenEntries(), stats = gardenStats(entries);
    var season = gardenSeason();
    byId("garden-season").textContent = season.name + " in the garden";
    var unplanted = stats.total - stats.planted;
    var line = [];
    line.push(stats.due ? stats.due + (stats.due === 1 ? " plant needs" : " plants need") + " water today" : stats.planted ? "Everything is watered" + (stats.nextDay !== null ? ". Next: " + stats.nextCount + " " + gardenDayText(stats.nextDay) : "") : "Nothing planted yet");
    line.push(stats.planted + " growing", stats.blooms + " in full bloom", unplanted + " seeds left", fmtScore(p.coins) + " coins");
    byId("garden-summary").textContent = line.join(" · ");
    byId("garden-scene").innerHTML = gardenSceneSvg(p, stats);
    var water = byId("garden-water-btn");
    water.textContent = stats.due ? "Water today's plants (" + stats.due + ")" : "Nothing to water today";
    water.disabled = !stats.due;
    var seeds = byId("garden-seed-btn");
    seeds.disabled = !unplanted;
    seeds.textContent = unplanted ? "Plant " + Math.min(p.seedSize, unplanted) + " new seeds" : "Every seed is planted";
    byId("garden-seed-size").value = String(p.seedSize);
    byId("garden-seed-size").disabled = false;
    byId("garden-shop-btn").disabled = false;
    var box = byId("garden-plots");
    box.textContent = "";
    var today = gardenDay();
    // Group plants by bed in one pass.
    var byPlot = {};
    entries.forEach(function (e) {
      if (!e.plant) return;
      var id = gardenSpecies(e.plant.species).plot;
      (byPlot[id] = byPlot[id] || []).push(e);
    });
    var frag = document.createDocumentFragment();
    GARDEN_PLOTS.forEach(function (plot) {
      var open = gardenPlotOpen(plot, stats);
      var sec = document.createElement("section");
      sec.className = "garden-plot" + (open ? "" : " locked");
      sec.style.setProperty("--soil", plot.soil);
      var h = document.createElement("h3");
      var mine = byPlot[plot.id] || [];
      var need = Math.max(1, Math.ceil(plot.share * Math.max(1, stats.total)));
      h.textContent = plot.name + (open ? " · " + mine.length + (mine.length === 1 ? " plant" : " plants") : " · opens at " + need + (need === 1 ? " bloom" : " blooms"));
      sec.appendChild(h);
      if (open) {
        var grid = document.createElement("div");
        grid.className = "garden-grid";
        if (!mine.length) {
          var empty = document.createElement("p");
          empty.className = "garden-empty";
          // With every seed planted, a newly opened bed would stay empty
          // forever, so full blooms can be moved into it.
          var movable = unplanted ? 0 : gardenTransplantable(entries, plot.id).length;
          empty.textContent = unplanted ? "New seeds can land here." : movable ? "Every seed is planted. Move some full blooms here to fill this bed." : "Every seed is planted. Grow plants to full bloom, then move some here.";
          grid.appendChild(empty);
          if (movable) {
            var mv = document.createElement("button");
            mv.type = "button";
            mv.className = "garden-transplant-btn";
            mv.textContent = "Transplant " + Math.min(p.seedSize, movable) + " blooms here";
            mv.addEventListener("click", (function (id) { return function () { gardenTransplant(id); }; })(plot.id));
            grid.appendChild(mv);
          }
        }
        // Plants due today first, then the most grown.
        mine.sort(function (a, b) { return (a.plant.due <= today ? 0 : 1) - (b.plant.due <= today ? 0 : 1) || b.plant.stage - a.plant.stage || a.plant.due - b.plant.due; });
        mine.slice(0, GARDEN_TILE_LIMIT).forEach(function (e) {
          var pl = e.plant, sp = gardenSpecies(pl.species);
          var tile = document.createElement("div");
          tile.className = "garden-tile" + (pl.due <= today ? " due" : "") + (pl.stage === 5 ? " bloom" : "");
          tile.innerHTML = gardenPlantSvgCached(sp, pl.stage);
          var cap = document.createElement("span");
          cap.textContent = sp.name;
          tile.appendChild(cap);
          tile.title = e.q.question + "\n" + GARDEN_STAGES[pl.stage] + " · " + (pl.due <= today ? "needs water today" : "water " + gardenDayText(pl.due));
          grid.appendChild(tile);
        });
        if (mine.length > GARDEN_TILE_LIMIT) {
          var more = document.createElement("p");
          more.className = "garden-empty";
          more.textContent = "+ " + (mine.length - GARDEN_TILE_LIMIT) + " more plants in this bed.";
          grid.appendChild(more);
        }
        sec.appendChild(grid);
      }
      frag.appendChild(sec);
    });
    box.appendChild(frag);
    var vis = byId("garden-visitors");
    vis.textContent = "";
    GARDEN_VISITORS.forEach(function (v) {
      var chip = document.createElement("span");
      chip.className = "garden-chip" + (p.visitors[v.id] ? "" : " unknown");
      chip.style.setProperty("--dot", p.visitors[v.id] ? v.color : "#bbb");
      chip.textContent = p.visitors[v.id] ? v.name : "???";
      chip.title = p.visitors[v.id] ? v.desc + " · first seen " + new Date(p.visitors[v.id] * 86400000).toLocaleDateString(undefined, { timeZone: "UTC" }) : "Not seen yet: " + v.desc;
      vis.appendChild(chip);
    });
  }

  function renderGardenShop() {
    var p = gardenProfile();
    var list = byId("garden-shop-list");
    list.textContent = "";
    byId("garden-shop-coins").textContent = fmtScore(p.coins) + " coins";
    GARDEN_DECOR.forEach(function (d) {
      var owned = !!p.decor[d.id];
      list.appendChild(shopCard(d.name, "Just for looks. It shows up in your garden scene.", owned ? "Placed" : fmtScore(d.price) + " coins",
        owned ? "Placed" : "Buy " + fmtScore(d.price), !owned && p.coins >= d.price, function () {
          if (!purchaseAllowed() || p.decor[d.id] || p.coins < d.price) return;
          p.coins -= d.price;
          p.decor[d.id] = true;
          notify(d.name + " added to your garden.");
          persistCompleted();
          renderGardenShop();
          renderGarden();
        }, owned ? "equipped" : ""));
    });
  }

  /* ------------------------------- Session ------------------------------- */

  function startGardenSession(mode) {
    if (!state.unit) return;
    whenProgressReady(function () {
      var p = gardenProfile(), today = gardenDay();
      // Questions that repeat in the bank share one plant: queue it once.
      var seenKeys = new Set();
      var entries = gardenEntries().filter(function (e) {
        if (seenKeys.has(e.key)) return false;
        seenKeys.add(e.key);
        return true;
      });
      var list;
      if (mode === "water") {
        list = entries.filter(function (e) { return e.plant && e.plant.due <= today && e.plant.lastWatered !== today; }).sort(function (a, b) { return a.plant.due - b.plant.due; });
      } else {
        list = seededShuffle(entries.filter(function (e) { return !e.plant; }), (Date.now() >>> 0)).slice(0, p.seedSize);
      }
      if (!list.length) { renderGarden(); return; }
      var setup = { diffMode: "rising", level: "easy", types: ["mc", "tf"], bots: false, skipCompleted: false, modifier: null, clean: false,
        minutes: 0, extra: { mode: mode, queue: list.map(function (e) { return e.q; }) } };
      startGame("garden", setup);
    });
  }

  GAME_HOOKS.garden = {
    noBots: true,
    noComplete: true,
    quitTo: "garden",
    keys: "",
    begin: function (g, setup) {
      g.profile = gardenProfile();
      g.garden = { mode: setup.extra.mode, queue: setup.extra.queue.slice(), total: setup.extra.queue.length, done: 0,
        grew: 0, wilted: 0, bloomed: 0, planted: 0, coins: 0, current: null, last: null };
    },
    start: function () { nextGameQuestion(); },
    pick: function () {
      var G = game.garden;
      var q = G.queue.shift();
      G.current = q;
      // Show the plant for this question (not the one just answered).
      gardenRenderArena();
      return q;
    },
    levelStep: function () {
      var G = game.garden;
      var pl = G.current && gardenProfile().plants[completedKey(G.current)];
      var st = pl ? pl.stage : 0;
      return st <= 1 ? 0 : st <= 3 ? 1 : 2;
    },
    renderArena: function () { gardenRenderArena(); },
    hud: function (stats) {
      var G = game.garden;
      stats.appendChild(hudStat(G.mode === "water" ? "Watered" : "Planted", G.done + " / " + G.total));
      stats.appendChild(hudStat("Coins", fmtScore(gardenProfile().coins)));
    },
    correct: function (c) { return { points: 0, message: gardenAnswer(c.q, true) }; },
    wrong: function () { return gardenAnswer(game.current.q, false) + " "; },
    afterFeedback: function () {
      var G = game.garden;
      if (G.queue.length) return false; // the next question draws its own plant
      gardenSessionDone();
      return true;
    },
    idleAction: function () { gardenLeave(); },
    key: function (k) {
      if (game.garden.over && (k === " " || k === "enter")) { gardenLeave(); return true; }
      return false;
    },
    quitHint: "Every plant you've already watered stays watered."
  };

  /* Apply an answer to the current plant; returns the feedback line. */
  function gardenAnswer(q, right) {
    var g = game, G = g.garden, p = gardenProfile();
    var key = completedKey(q), today = gardenDay();
    var pl = p.plants[key];
    var msg;
    var stats = gardenStats();
    if (pl && pl.lastWatered === today) {
      // One watering per plant per day.
      G.done++;
      gardenRenderArena();
      return gardenSpecies(pl.species).name + " was already watered today.";
    }
    if (!pl) {
      var sp = gardenPickSpecies(stats);
      p.plants[key] = { stage: right ? 1 : 0, due: today + 1, species: sp.id, bloomed: false, waterings: right ? 1 : 0, lastWatered: today };
      G.planted++;
      p.coins += 2;
      G.coins += 2;
      msg = right ? "Planted a " + sp.name + " and it sprouted!" : "Planted a " + sp.name + " seed. It needs another try tomorrow.";
      if (right) { p.gp++; p.coins += 5; G.coins += 5; }
    } else if (right) {
      pl.lastWatered = today;
      var before = pl.stage;
      pl.stage = Math.min(5, pl.stage + 1);
      pl.waterings++;
      pl.due = today + GARDEN_WAIT[pl.stage];
      p.gp++;
      p.coins += 5; G.coins += 5;
      var name = gardenSpecies(pl.species).name;
      if (pl.stage === 5 && before < 5 && pl.bloomed) {
        markGameCompleted(q);
        msg = name + " is back in full bloom. Next watering " + gardenDayText(pl.due) + ".";
      } else if (pl.stage === 5 && before < 5) {
        p.coins += 25; G.coins += 25;
        G.bloomed++;
        pl.bloomed = true;
        markGameCompleted(q);
        msg = name + " is in full bloom! Question completed. +30 coins.";
      } else if (before === 5) {
        markGameCompleted(q);
        msg = name + " stays in full bloom. Next watering " + gardenDayText(pl.due) + ".";
      } else {
        G.grew++;
        msg = name + " grew to " + GARDEN_STAGES[pl.stage].toLowerCase() + ". Next watering " + gardenDayText(pl.due) + ".";
      }
    } else {
      pl.lastWatered = today;
      pl.stage = Math.max(pl.stage > 0 ? 1 : 0, pl.stage - 1);
      pl.due = today + 1;
      G.wilted++;
      G.last = "wilt";
      msg = gardenSpecies(pl.species).name + " wilted to " + GARDEN_STAGES[pl.stage].toLowerCase() + ". It comes back tomorrow.";
    }
    G.done++;
    gardenRenderArena(right ? "grow" : "wilt");
    persistCompleted();
    return msg;
  }

  function gardenRenderArena(fx) {
    var g = game, G = g.garden;
    var arena = byId("game-arena");
    var q = G.current;
    var pl = q ? gardenProfile().plants[completedKey(q)] : null;
    var season = gardenSeason();
    var name, stage, svg;
    if (pl) {
      var sp = gardenSpecies(pl.species);
      name = sp.name; stage = GARDEN_STAGES[pl.stage];
      svg = gardenPlantSvg(sp, pl.stage, { wilt: fx === "wilt" });
    } else {
      name = "New seed"; stage = "Answer to plant it";
      svg = gardenPlantSvg(GARDEN_SPECIES[0], 0);
    }
    arena.innerHTML = '<p class="arena-name"></p><p class="arena-sub"></p><div class="garden-arena-plant' + (fx ? " " + fx : "") + '" style="background:' + season.sky + '">' + svg + '</div>' +
      '<div class="arena-row"><div><span class="arena-caption">This session</span><strong></strong></div><div><span class="arena-caption">Season</span><strong></strong></div></div>';
    arena.querySelector(".arena-name").textContent = name;
    arena.querySelector(".arena-sub").textContent = stage + (pl && pl.stage < 5 ? " · next: " + GARDEN_STAGES[pl.stage + 1].toLowerCase() : "");
    var strongs = arena.querySelectorAll(".arena-row strong");
    strongs[0].textContent = G.done + " of " + G.total;
    strongs[1].textContent = season.name;
  }

  function gardenSessionDone() {
    var g = game, G = g.garden;
    G.over = true;
    g.locked = true;
    g.current = null;
    showQuestionPane(false);
    var fresh = gardenCheckVisitors();
    persistCompleted();
    var bits = [];
    if (G.planted) bits.push(G.planted + " planted");
    if (G.grew) bits.push(G.grew + " grew");
    if (G.bloomed) bits.push(G.bloomed + " reached full bloom");
    if (G.wilted) bits.push(G.wilted + " wilted");
    byId("game-idle-title").textContent = G.mode === "water" ? "All watered!" : "Seeds planted!";
    byId("game-idle-text").textContent = (bits.join(", ") || "Done") + ". +" + G.coins + " coins." +
      (fresh.length ? " New visitor" + (fresh.length > 1 ? "s" : "") + ": " + fresh.map(function (v) { return v.name; }).join(", ") + "!" : "");
    var btn = byId("game-cast-btn");
    btn.textContent = "Back to the garden";
    btn.classList.remove("hidden");
    btn.disabled = false;
    btn.focus();
    renderGameHud();
  }

  /* The Home button shows how many plants need water today. */
  function updateGardenBadge() {
    var badge = byId("garden-due-badge");
    if (!badge || !state.unit) return;
    state.completedReady.then(function () {
      var due = gardenStats().due;
      badge.textContent = due ? due + " due" : "";
      badge.classList.toggle("hidden", !due);
    });
  }
  screenShowHooks.home = updateGardenBadge;
  screenShowHooks.sessions = function () {
    var line = byId("sessions-garden-line");
    line.textContent = "";
    if (!state.unit) return;
    state.completedReady.then(function () {
      var st = gardenStats();
      line.textContent = st.planted ? (st.due ? st.due + (st.due === 1 ? " plant needs" : " plants need") + " water today" : "Everything is watered") + " · " + st.blooms + " in full bloom" : "Nothing planted yet";
    });
  };
  screenShowHooks.garden = function () { if (state.unit) renderGarden(); };

  function gardenLeave() {
    var g = game;
    if (!g || g.id !== "garden") return;
    g.over = true;
    openGarden();
  }

