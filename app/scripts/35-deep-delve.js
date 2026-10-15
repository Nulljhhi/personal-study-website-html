  /* ============================== Deep Delve ==============================
     A dungeon crawl through 20 biomes of 5 floors (100 floors in all).
     The first five biomes are the original depths; the next ten are deeper,
     tougher versions of them; the last five (floors 76-100) are the Void,
     with its own monsters built to be nearly impossible. Each floor is a small map
     of rooms; you pick the next room. Monsters are fought with questions
     (a correct answer hits, a miss lets the monster hit you), and many
     monsters change how questions work. Relics bend the rules. Gold carries
     home as lanterns, spent at camp on permanent upgrades and new relics. */

  var DV_BASE_BIOMES = [
    { id: "crypt", name: "Crypt", bg: "#3b3a4a", fg: "#c9c3e6" },
    { id: "fungal", name: "Fungal Caves", bg: "#2f4a3a", fg: "#bfe6b5" },
    { id: "library", name: "Sunken Library", bg: "#2d3f55", fg: "#c4d8f0" },
    { id: "crystal", name: "Crystal Depths", bg: "#3a2f55", fg: "#e2c9ff" },
    { id: "core", name: "The Core", bg: "#552a22", fg: "#ffc7a8" }
  ];
  /* tier 0: floors 1-25, 1: 26-50, 2: 51-75, 3 (the Void): 76-100.
     hits/atk scale the base monsters for tiers 1-2; shields are how many
     shield layers each rank brings. */
  var DV_TIERS = [
    { id: "", label: "", hits: 1, atk: 0, shields: { normal: 0, elite: 0, boss: 1 }, names: ["Crypt", "Fungal Caves", "Sunken Library", "Crystal Depths", "The Core"] },
    { id: "deep", label: "Deep", hits: 1.4, atk: 2, shields: { normal: 0, elite: 1, boss: 1 }, names: ["Ossuary", "Blight Warrens", "Drowned Archive", "Geode Labyrinth", "Ashen Furnace"] },
    { id: "abyss", label: "Abyssal", hits: 1.8, atk: 4, shields: { normal: 1, elite: 2, boss: 2 }, names: ["Bone Cathedral", "Spore Abyss", "Silent Stacks", "Prism Rift", "Magma Sea"] },
    { id: "void", label: "Void", hits: 1, atk: 0, shields: { normal: 2, elite: 2, boss: 2 }, names: ["Void Threshold", "Hollow Gardens", "Unwritten Halls", "Starless Expanse", "The Endless Dark"] }
  ];
  var DV_FLOORS = 100;
  var DV_BIOMES = [];
  DV_TIERS.forEach(function (tier, t) {
    DV_BASE_BIOMES.forEach(function (b, i) {
      var dark = t === 3 ? ["#1a1426", "#14201c", "#151a26", "#120f22", "#0b0b10"][i] : null;
      DV_BIOMES.push({ id: t ? tier.id + "-" + b.id : b.id, name: tier.names[i], tier: t, base: i,
        bg: dark || (t ? shadeHex(b.bg, -0.25 * t) : b.bg), fg: t === 3 ? "#d9d0ff" : b.fg });
    });
  });
  function shadeHex(hex, f) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, bl = n & 255;
    var m = function (c) { return Math.max(0, Math.min(255, Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f))); };
    return "#" + ((1 << 24) + (m(r) << 16) + (m(g) << 8) + m(bl)).toString(16).slice(1);
  }
  function dvDepth(run) { return run.biome * 5 + run.floor + 1; }
  function dvTier(biome) { return DV_BIOMES[biome] ? DV_BIOMES[biome].tier : 0; }

  var DV_ABILITIES = {
    hasty: { name: "Hasty", desc: "1.5 s less thinking time." },
    mimic: { name: "Mimic", desc: "Hides one answer (it might be the right one)." },
    armored: { name: "Armored", desc: "Hits only land while you're on a 3-answer streak in this fight." },
    vampire: { name: "Vampire", desc: "Heals 1 when you miss." },
    shade: { name: "Shade", desc: "Answers are blurred for the first 1.5 s (you get that time back)." },
    poison: { name: "Poison", desc: "A miss poisons you: 1 damage after each of the next 3 questions." },
    berserk: { name: "Berserk", desc: "Hits twice as hard." },
    shielded: { name: "Warded", desc: "Blocks your first hit." },
    thief: { name: "Thief", desc: "Steals 10 gold when you miss." },
    splitting: { name: "Splitting", desc: "Splits into a small one when defeated." },
    riddler: { name: "Riddler", desc: "Every question uses hard wrong answers." }
  };
  /* [id, name, biome, hits, attack, abilities, kind, hue, rank] */
  var DV_MONSTERS = [
    ["skeleton", "Skeleton", 0, 3, 3, [], "golem", 40, "normal"], ["rat", "Crypt Rat", 0, 2, 2, ["hasty"], "beetle", 20, "normal"],
    ["mimic", "Mimic", 0, 3, 4, ["mimic"], "slime", 30, "normal"], ["bonegolem", "Bone Golem", 0, 3, 4, ["armored"], "golem", 50, "normal"],
    ["ghoul", "Ghoul Knight", 0, 6, 5, ["shielded"], "golem", 260, "elite"], ["lich", "Lich King", 0, 12, 5, ["shade", "vampire"], "wisp", 270, "boss"],
    ["spore", "Spore Puff", 1, 3, 2, ["poison"], "slime", 90, "normal"], ["myconid", "Myconid", 1, 3, 3, ["splitting"], "slime", 110, "normal"],
    ["spider", "Cave Spider", 1, 3, 3, ["hasty", "poison"], "beetle", 100, "normal"], ["fungbrute", "Fungus Brute", 1, 4, 3, ["berserk"], "golem", 80, "normal"],
    ["toadstool", "Toadstool Titan", 1, 7, 5, ["armored"], "slime", 0, "elite"], ["mycelium", "Mother Mycelium", 1, 14, 5, ["poison", "vampire"], "slime", 130, "boss"],
    ["paperwraith", "Paper Wraith", 2, 3, 3, ["shade"], "wisp", 50, "normal"], ["inkmimic", "Ink Mimic", 2, 4, 4, ["mimic"], "slime", 230, "normal"],
    ["bookgolem", "Book Golem", 2, 4, 4, ["armored"], "golem", 25, "normal"], ["imp", "Librarian Imp", 2, 3, 3, ["riddler", "hasty"], "wisp", 200, "normal"],
    ["archivist", "Archivist", 2, 7, 5, ["riddler", "shielded"], "golem", 210, "elite"], ["tome", "The Forbidden Tome", 2, 15, 6, ["mimic", "shade", "riddler"], "beetle", 280, "boss"],
    ["bat", "Crystal Bat", 3, 3, 3, ["hasty"], "wisp", 290, "normal"], ["prism", "Prism Golem", 3, 4, 5, ["armored", "shielded"], "golem", 300, "normal"],
    ["gemthief", "Gem Thief", 3, 3, 4, ["thief", "hasty"], "beetle", 320, "normal"], ["shardmimic", "Shard Mimic", 3, 4, 4, ["mimic", "berserk"], "slime", 310, "normal"],
    ["geode", "Geode Colossus", 3, 8, 6, ["armored", "berserk"], "golem", 270, "elite"], ["hydra", "Crystal Hydra", 3, 16, 6, ["vampire", "hasty", "armored"], "dragon", 290, "boss"],
    ["magmaimp", "Magma Imp", 4, 4, 5, ["hasty", "berserk"], "wisp", 15, "normal"], ["obsknight", "Obsidian Knight", 4, 5, 6, ["shielded", "armored"], "golem", 0, "normal"],
    ["emberwraith", "Ember Wraith", 4, 4, 5, ["shade", "poison"], "wisp", 25, "normal"], ["coreleech", "Core Leech", 4, 4, 5, ["vampire", "thief"], "beetle", 5, "normal"],
    ["warden", "Flame Warden", 4, 9, 7, ["riddler", "berserk", "shielded"], "golem", 10, "elite"], ["heart", "Heart of the Core", 4, 20, 7, ["hasty", "shade", "armored", "vampire"], "dragon", 0, "boss"]
  ].map(function (m) { return { id: m[0], name: m[1], biome: m[2], hits: m[3], atk: m[4], ab: m[5], kind: m[6], hue: m[7], rank: m[8] }; });
  // Deeper tiers: the same monsters, tougher, each with one more trick.
  var DV_TIER_EXTRA = [["shielded", "hasty", "vampire", "riddler", "poison"], ["berserk", "armored", "shade", "mimic", "thief"]];
  DV_MONSTERS.slice().forEach(function (m) {
    [1, 2].forEach(function (t) {
      var tier = DV_TIERS[t];
      var extra = DV_TIER_EXTRA[t - 1].filter(function (a) { return m.ab.indexOf(a) === -1 && !(m.rank === "boss" && a === "splitting"); })[(m.hue + t) % 3];
      DV_MONSTERS.push({ id: m.id + "_" + tier.id, name: tier.label + " " + m.name, biome: t * 5 + m.biome, hits: Math.round(m.hits * tier.hits),
        atk: m.atk + tier.atk, ab: extra ? m.ab.concat([extra]) : m.ab.slice(), kind: m.kind, hue: (m.hue + 25 * t) % 360, rank: m.rank });
    });
  });
  // The Void (floors 76-100): its own monsters, meant to be nearly impossible.
  [
    ["nullwisp", "Null Wisp", 15, 10, 9, ["shade", "hasty", "mimic"], "wisp", 270, "normal"], ["hollowknight", "Hollow Knight", 15, 11, 10, ["armored", "shielded", "berserk"], "golem", 260, "normal"],
    ["echowraith", "Echo Wraith", 15, 10, 9, ["riddler", "shade", "vampire"], "wisp", 250, "normal"], ["gateleech", "Gate Leech", 15, 9, 10, ["vampire", "thief", "poison"], "beetle", 280, "normal"],
    ["sentinel", "Threshold Sentinel", 15, 16, 12, ["armored", "shielded", "riddler", "berserk"], "golem", 265, "elite"], ["gatekeeper", "The Gatekeeper", 15, 28, 13, ["hasty", "shade", "armored", "vampire", "riddler"], "dragon", 270, "boss"],
    ["ashbloom", "Ashen Bloom", 16, 10, 9, ["poison", "splitting", "hasty"], "slime", 300, "normal"], ["thornrevenant", "Thorn Revenant", 16, 11, 10, ["berserk", "vampire", "armored"], "golem", 310, "normal"],
    ["gloommoth", "Gloom Moth", 16, 9, 9, ["shade", "mimic", "hasty"], "wisp", 290, "normal"], ["rotshepherd", "Rot Shepherd", 16, 10, 10, ["poison", "vampire", "riddler"], "slime", 305, "normal"],
    ["dryad", "Withered Dryad", 16, 16, 12, ["poison", "shielded", "armored", "vampire"], "golem", 300, "elite"], ["lastroot", "The Last Root", 16, 30, 13, ["poison", "vampire", "armored", "hasty", "berserk"], "dragon", 300, "boss"],
    ["blankpage", "Blank Page", 17, 10, 9, ["mimic", "riddler", "shade"], "wisp", 230, "normal"], ["scribe", "Inkless Scribe", 17, 10, 10, ["riddler", "hasty", "thief"], "beetle", 220, "normal"],
    ["silence", "Silence", 17, 11, 10, ["shade", "armored", "berserk"], "golem", 240, "normal"], ["marginhorror", "Margin Horror", 17, 10, 10, ["mimic", "vampire", "poison"], "slime", 235, "normal"],
    ["redactor", "The Redactor", 17, 17, 12, ["riddler", "mimic", "shielded", "shade"], "golem", 230, "elite"], ["unwritten", "The Unwritten Word", 17, 32, 14, ["riddler", "mimic", "shade", "armored", "vampire"], "beetle", 235, "boss"],
    ["darkmatter", "Dark Matter", 18, 12, 10, ["armored", "berserk", "hasty"], "golem", 280, "normal"], ["horizon", "Event Horizon", 18, 11, 10, ["vampire", "shielded", "armored"], "slime", 275, "normal"],
    ["cometshade", "Comet Shade", 18, 10, 11, ["hasty", "shade", "berserk"], "wisp", 285, "normal"], ["pulsarmite", "Pulsar Mite", 18, 10, 10, ["hasty", "thief", "poison", "mimic"], "beetle", 290, "normal"],
    ["collapsar", "Collapsing Star", 18, 18, 13, ["berserk", "armored", "shielded", "hasty"], "golem", 280, "elite"], ["stareater", "The Star Eater", 18, 34, 14, ["berserk", "armored", "hasty", "vampire", "shade"], "dragon", 285, "boss"],
    ["unmaker", "Unmaker", 19, 12, 11, ["berserk", "armored", "vampire", "hasty"], "golem", 0, "normal"], ["finalecho", "Final Echo", 19, 11, 11, ["riddler", "shade", "mimic", "hasty"], "wisp", 0, "normal"],
    ["entropy", "Entropy", 19, 12, 11, ["poison", "vampire", "thief", "armored"], "slime", 0, "normal"], ["nameless", "The Nameless", 19, 12, 11, ["shade", "mimic", "berserk", "riddler"], "beetle", 0, "normal"],
    ["herald", "Herald of Nothing", 19, 20, 14, ["shade", "mimic", "armored", "shielded", "berserk"], "golem", 0, "elite"],
    ["endofall", "The End of All Things", 19, 40, 15, ["hasty", "shade", "armored", "vampire", "berserk", "riddler"], "dragon", 0, "boss"]
  ].forEach(function (m) { DV_MONSTERS.push({ id: m[0], name: m[1], biome: m[2], hits: m[3], atk: m[4], ab: m[5], kind: m[6], hue: m[7], rank: m[8] }); });
  var DV_SPLITLING = { id: "splitling", name: "Sporeling", biome: 1, hits: 1, atk: 2, ab: [], kind: "slime", hue: 120, rank: "normal" };
  function dvMonster(id) { for (var i = 0; i < DV_MONSTERS.length; i++) if (DV_MONSTERS[i].id === id) return DV_MONSTERS[i]; return id === "splitling" ? DV_SPLITLING : null; }

  /* Relics. pool: true = available from the start; otherwise bought at camp. */
  var DV_RELICS = [
    ["whetstone", "Whetstone", "+1 damage on every hit.", true, 0], ["hourglass", "Hourglass", "+2 s thinking time.", true, 0],
    ["vampfang", "Vampire Fang", "Heal 1 HP on every kill.", true, 0], ["streakheal", "Streak Charm", "Every 3-answer streak heals 2 HP.", true, 0],
    ["forgive", "Pardon Seal", "The first miss on each floor is forgiven.", true, 0], ["goldtooth", "Gold Tooth", "Double gold, but 1 s less thinking time.", true, 0],
    ["ironskin", "Iron Skin", "Take 1 less damage from hits (at least 1).", true, 0], ["bomb", "Pocket Bomb", "Every fight starts with 2 damage to the monster.", true, 0],
    ["thorns", "Thorn Vest", "A monster takes 1 damage whenever it hits you.", true, 0], ["luckycoin", "Lucky Coin", "20% chance a miss does no damage.", true, 0],
    ["quill", "Scholar's Quill", "Fast answers deal +2 instead of +1.", true, 0], ["heartstone", "Heartstone", "+6 max HP.", true, 0],
    ["merchant", "Merchant Badge", "Shop prices 25% lower.", true, 0], ["campkit", "Camping Kit", "Campfires heal 50% instead of 35%.", true, 0],
    ["trapsense", "Trap Sense", "Traps never hurt you.", true, 0], ["executioner", "Executioner's Axe", "Double damage on monsters under 30% health.", true, 0],
    ["mirror", "Mirror Shield", "Blocks the first monster hit in each fight.", true, 0], ["adrenaline", "Adrenaline", "+1 damage while you're under half HP.", true, 0],
    ["coinpurse", "Coin Purse", "+15 gold at the start of each floor.", true, 0], ["regen", "Regrowth Ring", "Heal 3 HP at the start of each floor.", true, 0],
    ["combocrown", "Combo Crown", "+1 damage per 5-answer streak (up to +3).", false, 40], ["elitehunter", "Elite Hunter", "+1 damage against elites and bosses.", false, 40],
    ["treasuremap", "Treasure Map", "Chests hold double gold and a second relic.", false, 50], ["phoenix", "Phoenix Feather", "Once per run, come back with half your HP.", false, 120],
    ["glasscannon", "Glass Cannon", "+2 damage, but -5 max HP.", false, 60], ["anchor", "Time Anchor", "Hasty monsters can't speed you up.", false, 50],
    ["trueeye", "Eye of Truth", "Mimics can't hide answers and Shades can't blur them.", false, 60], ["pickaxe", "Pickaxe", "Armor cracks after 2 in a row instead of 3.", false, 50],
    ["secondwind", "Second Wind", "Start a fight under 5 HP: heal 4.", false, 40], ["bloodlust", "Bloodlust", "Each kill gives +1 damage for the rest of the floor (up to +3).", false, 70],
    ["antidote", "Antidote", "You can't be poisoned.", false, 40], ["wardrum", "War Drum", "Fights start you on a 2-answer combo.", false, 50],
    ["berserkhelm", "Berserker Helm", "+1 damage, but take 1 more damage.", false, 50], ["tithe", "Tithe Box", "Shrines ask for half as much health.", false, 40],
    ["midas", "Midas Glove", "50% more gold from kills.", false, 60], ["ember", "Ember Stone", "Your first hit in each fight deals triple damage.", false, 70],
    ["calm", "Calm Mind", "Timeouts don't hurt (wrong answers still do).", false, 60], ["lantern", "Old Lantern", "+25% lanterns when the run ends.", false, 80],
    ["scholarcap", "Scholar's Cap", "+1 damage on hard questions.", false, 60], ["spyglass", "Spyglass", "Shops offer 3 relics instead of 2.", false, 50]
  ].map(function (r) { return { id: r[0], name: r[1], desc: r[2], pool: r[3], price: r[4] }; });
  function dvRelic(id) { for (var i = 0; i < DV_RELICS.length; i++) if (DV_RELICS[i].id === id) return DV_RELICS[i]; return null; }

  var DV_CLASSES = [
    { id: "scholar", name: "Scholar", key: "scholar", hp: 22, relic: "hourglass", ability: "Study", abilityDesc: "Remove two wrong answers, once per fight." },
    { id: "rogue", name: "Rogue", key: "rogue", hp: 20, relic: "luckycoin", ability: "Evade", abilityDesc: "Skip a question with no damage, once per floor." },
    { id: "knight", name: "Knight", key: "knight", hp: 30, relic: "ironskin", ability: "Guard", abilityDesc: "Your next miss in this fight does no damage, once per fight." },
    { id: "alchemist", name: "Alchemist", key: "alchemist", hp: 22, relic: "campkit", ability: "Potion", abilityDesc: "Drink a potion to heal 8 (you start with 2 and brew more at campfires)." }
  ];
  function dvClass(id) { for (var i = 0; i < DV_CLASSES.length; i++) if (DV_CLASSES[i].id === id) return DV_CLASSES[i]; return DV_CLASSES[0]; }

  var DV_CAMP = [
    { id: "vitality", name: "Vitality", desc: "+3 max HP per level.", max: 5, cost: [30, 60, 90, 120, 150] },
    { id: "purse", name: "Purse", desc: "+15 starting gold per level.", max: 3, cost: [25, 50, 75] },
    { id: "insight", name: "Insight", desc: "+0.5 s thinking time per level.", max: 4, cost: [40, 80, 120, 160] }
  ];
  function dvShortcutCost(bi) { return bi <= 4 ? [0, 60, 120, 200, 300][bi] : Math.round(300 + 140 * (bi - 4) + 12 * Math.pow(bi - 4, 2)); }

  /* The outfitter at camp (bought with lanterns, before a run):
     gear     lasts a number of runs (one per slot: weapon, armor, trinket)
     supplies used up by the next run (up to 3)
     relics   carried into the next run only (up to 2)
     Clean runs bring nothing. */
  var DV_GEAR = [
    { id: "ironsword", slot: "weapon", name: "Iron Sword", desc: "+1 damage on every hit.", price: 40, runs: 3, dmg: 1 },
    { id: "steelsword", slot: "weapon", name: "Steel Sword", desc: "+2 damage on every hit.", price: 100, runs: 3, dmg: 2 },
    { id: "runeblade", slot: "weapon", name: "Runeblade", desc: "+3 damage on every hit.", price: 260, runs: 4, dmg: 3, need: 26 },
    { id: "voidedge", slot: "weapon", name: "Voidedge", desc: "+5 damage on every hit.", price: 700, runs: 5, dmg: 5, need: 51 },
    { id: "leather", slot: "armor", name: "Leather Vest", desc: "+5 max HP.", price: 35, runs: 3, hp: 5 },
    { id: "chainmail", slot: "armor", name: "Chainmail", desc: "+10 max HP.", price: 90, runs: 3, hp: 10 },
    { id: "plate", slot: "armor", name: "Plate Armor", desc: "+12 max HP and take 1 less damage from hits.", price: 240, runs: 4, hp: 12, armor: 1, need: 26 },
    { id: "voidplate", slot: "armor", name: "Void Plate", desc: "+20 max HP and take 2 less damage from hits.", price: 650, runs: 5, hp: 20, armor: 2, need: 51 },
    { id: "sandglass", slot: "trinket", name: "Sandglass", desc: "+1.5 s thinking time.", price: 50, runs: 3, think: 1500 },
    { id: "pouch", slot: "trinket", name: "Merchant's Pouch", desc: "Start with 60 more gold.", price: 45, runs: 3, gold: 60 },
    { id: "wardstone", slot: "trinket", name: "Wardstone", desc: "Shield layers on monsters start a quarter weaker.", price: 160, runs: 3, shieldCut: 0.25, need: 26 },
    { id: "starmap", slot: "trinket", name: "Star Map", desc: "+3 s thinking time and +1 damage.", price: 520, runs: 4, think: 3000, dmg: 1, need: 51 }
  ];
  var DV_SUPPLIES = [
    { id: "potions", name: "Potion Pack", desc: "Alchemist only: start with 2 more potions. Refunded if you start a run as another class.", price: 25 },
    { id: "rations", name: "Field Rations", desc: "+8 max HP for this run.", price: 20 },
    { id: "oil", name: "Whetstone Oil", desc: "+1 damage for this run.", price: 30 },
    { id: "gold", name: "Gold Sack", desc: "Start with 80 more gold.", price: 30 }
  ];
  var DV_PACK_MAX = { supplies: 3, relics: 2 };
  function dvGearDef(id) { for (var i = 0; i < DV_GEAR.length; i++) if (DV_GEAR[i].id === id) return DV_GEAR[i]; return null; }
  function dvSupplyDef(id) { for (var i = 0; i < DV_SUPPLIES.length; i++) if (DV_SUPPLIES[i].id === id) return DV_SUPPLIES[i]; return null; }
  // Relics bought at camp cost more the stronger they are.
  function dvRelicPrice(r) { return r.price ? r.price + 30 : 45; }

  var DV_EVENTS = [
    { id: "well", name: "Wishing Well", text: "A well glitters with old coins.", choices: [["Toss 25 gold (it may grant a relic)", "well"], ["Walk away", "leave"]] },
    { id: "adventurer", name: "Wounded Adventurer", text: "A hurt adventurer offers gold for help.", choices: [["Give 5 HP for 45 gold", "adventurer"], ["Leave", "leave"]] },
    { id: "altar", name: "Riddle Altar", text: "An altar asks one hard question. A right answer may earn a relic; a wrong one costs 5 HP.", choices: [["Answer the riddle", "altar"], ["Leave", "leave"]] },
    { id: "cursed", name: "Cursed Chest", text: "A chest hums with dark magic.", choices: [["Open it (it may hold a relic, for -4 max HP)", "cursed"], ["Leave it", "leave"]] },
    { id: "nook", name: "Reading Nook", text: "A quiet corner with a comfortable chair.", choices: [["Rest and read (+3 HP, +1 s thinking this floor)", "nook"], ["Move on", "leave"]] },
    { id: "ghost", name: "Ghost Merchant", text: "A ghost offers to trade.", choices: [["Offer your newest relic for two random ones", "ghost"], ["Decline", "leave"]] },
    { id: "mushroom", name: "Strange Mushroom", text: "A glowing mushroom. It might heal you. It might not.", choices: [["Eat it", "mushroom"], ["Leave it", "leave"]] },
    { id: "echo", name: "Echoing Hall", text: "Voices dare you to answer three questions in a row. All right pays 80 gold; a miss ends it and costs 3 HP.", choices: [["Take the dare", "echo"], ["Leave", "leave"]] }
  ];
  var DV_ROOM_INFO = {
    fight: { name: "Fight", color: "#c0392b" }, elite: { name: "Elite", color: "#8e44ad" }, treasure: { name: "Chest", color: "#d4a017" },
    trap: { name: "Trap", color: "#7f8c8d" }, shop: { name: "Shop", color: "#16a085" }, shrine: { name: "Shrine", color: "#2980b9" },
    camp: { name: "Campfire", color: "#e67e22" }, event: { name: "?", color: "#6c5ce7" }, boss: { name: "Boss", color: "#e74c3c" }, stairs: { name: "Stairs", color: "#95a5a6" }
  };

  /* ------------------------------ Profile ------------------------------ */

  function freshDelveProfile() {
    return { lanterns: 0, camp: { vitality: 0, purse: 0, insight: 0 }, shortcuts: {}, deepest: 0, cls: "scholar",
      codex: { monsters: {}, relics: {}, events: {} }, run: null, wins: 0,
      gear: { weapon: null, armor: null, trinket: null }, supplies: [], packRelics: [] };
  }
  // Gameplay and the save loader share these caps, so nothing earned in a
  // run is cut off when it's reloaded.
  var DV_MAX_POTIONS = 20, DV_MAX_DMG_BONUS = 10, DV_BONUS_HP_MIN = -40, DV_BONUS_HP_MAX = 200;

  function parseDelveProfile(src) {
    var p = freshDelveProfile();
    if (!src || typeof src !== "object") return p;
    var num = function (v, d) { return typeof v === "number" && isFinite(v) ? v : d; };
    p.lanterns = Math.max(0, Math.floor(num(src.lanterns, 0)));
    DV_CAMP.forEach(function (c) { p.camp[c.id] = clamp(Math.floor(num(src.camp && src.camp[c.id], 0)), 0, c.max); });
    for (var b = 1; b < DV_BIOMES.length; b++) if (src.shortcuts && src.shortcuts[b] === true) p.shortcuts[b] = true;
    p.deepest = clamp(Math.floor(num(src.deepest, 0)), 0, DV_FLOORS);
    ["weapon", "armor", "trinket"].forEach(function (slot) {
      var it = src.gear && src.gear[slot];
      var def = it && dvGearDef(it.id);
      var runs = it ? Math.floor(num(it.runs, 0)) : 0;
      if (def && def.slot === slot && runs > 0) p.gear[slot] = { id: def.id, runs: Math.min(runs, def.runs) };
    });
    if (Array.isArray(src.supplies)) p.supplies = src.supplies.filter(function (id) { return dvSupplyDef(id); }).slice(0, DV_PACK_MAX.supplies);
    if (Array.isArray(src.packRelics)) p.packRelics = src.packRelics.filter(function (id, i, a) { return dvRelic(id) && a.indexOf(id) === i; }).slice(0, DV_PACK_MAX.relics);
    p.wins = Math.max(0, Math.floor(num(src.wins, 0)));
    if (DV_CLASSES.some(function (c) { return c.id === src.cls; })) p.cls = src.cls;
    var cx = src.codex || {};
    DV_MONSTERS.forEach(function (m) { var n = Math.floor(num(cx.monsters && cx.monsters[m.id], 0)); if (n > 0) p.codex.monsters[m.id] = n; });
    DV_RELICS.forEach(function (r) { if (cx.relics && cx.relics[r.id] === true) p.codex.relics[r.id] = true; });
    DV_EVENTS.forEach(function (e) { if (cx.events && cx.events[e.id] === true) p.codex.events[e.id] = true; });
    var r = src.run;
    if (r && typeof r === "object" && DV_CLASSES.some(function (c) { return c.id === r.cls; }) && Array.isArray(r.relics) && r.map && Array.isArray(r.map.rows)) {
      var ok = r.map.rows.length >= 2 && r.map.rows.every(function (row) {
        return Array.isArray(row) && row.length >= 1 && row.length <= 4 && row.every(function (n) { return n && hasOwn(DV_ROOM_INFO, n.type) && Array.isArray(n.links); });
      });
      var hp = Math.floor(num(r.hp, 0)), maxHp = Math.floor(num(r.maxHp, 0));
      if (ok && hp > 0 && maxHp >= hp) {
        p.run = {
          cls: r.cls, hp: hp, maxHp: maxHp, gold: Math.max(0, Math.floor(num(r.gold, 0))), goldEarned: Math.max(0, Math.floor(num(r.goldEarned, 0))),
          relics: r.relics.filter(function (id) { return dvRelic(id); }).slice(0, 40), potions: clamp(Math.floor(num(r.potions, 0)), 0, DV_MAX_POTIONS),
          dmgBonus: clamp(Math.floor(num(r.dmgBonus, 0)), 0, DV_MAX_DMG_BONUS), biome: clamp(Math.floor(num(r.biome, 0)), 0, DV_BIOMES.length - 1), floor: clamp(Math.floor(num(r.floor, 0)), 0, 4),
          map: { rows: r.map.rows.map(function (row, ri) {
            var next = r.map.rows[ri + 1];
            return row.map(function (n) {
              var node = { type: n.type, links: n.links.filter(function (x) { return typeof x === "number" && next && x >= 0 && x < next.length && x === Math.floor(x); }).slice(0, 4), done: n.done === true };
              if (typeof n.mon === "string" && dvMonster(n.mon)) node.mon = n.mon;
              if (typeof n.ev === "string" && DV_EVENTS.some(function (e) { return e.id === n.ev; })) node.ev = n.ev;
              if (Array.isArray(n.stock)) node.stock = n.stock.filter(function (id) { return dvRelic(id); }).slice(0, 3);
              if (typeof n.gold === "number" && isFinite(n.gold)) node.gold = clamp(Math.round(n.gold), 0, 1000);
              if (typeof n.relic === "string" && dvRelic(n.relic)) node.relic = n.relic;
              if (typeof n.relic2 === "string" && dvRelic(n.relic2) && n.relic2 !== node.relic) node.relic2 = n.relic2;
              return node;
            });
          }) },
          row: clamp(Math.floor(num(r.row, -1)), -1, r.map.rows.length - 1), col: Math.max(0, Math.floor(num(r.col, 0))),
          inRoom: r.inRoom === true, floorsCleared: Math.max(0, Math.floor(num(r.floorsCleared, 0))), bosses: Math.max(0, Math.floor(num(r.bosses, 0))),
          kills: Math.max(0, Math.floor(num(r.kills, 0))), phoenixUsed: r.phoenixUsed === true, startBiome: clamp(Math.floor(num(r.startBiome, 0)), 0, DV_BIOMES.length - 1),
          gearBonus: dvParseGearBonus(r.gearBonus),
          floorFlags: { forgiven: !!(r.floorFlags && r.floorFlags.forgiven === true), evaded: !!(r.floorFlags && r.floorFlags.evaded === true), nook: !!(r.floorFlags && r.floorFlags.nook === true) },
          bonusHp: clamp(Math.floor(num(r.bonusHp, 0)), DV_BONUS_HP_MIN, DV_BONUS_HP_MAX)
        };
        if (p.run.col >= (p.run.row >= 0 ? p.run.map.rows[p.run.row].length : 99)) p.run.col = 0;
        // Every room except the last row must lead somewhere.
        var rowsOk = p.run.map.rows.every(function (row, ri) { return ri === p.run.map.rows.length - 1 || row.every(function (n) { return n.links.length > 0; }); });
        var lastType = p.run.map.rows[p.run.map.rows.length - 1][0].type;
        if (!rowsOk || (lastType !== "stairs" && lastType !== "boss")) p.run = null;
      }
    }
    return p;
  }

  function dvParseGearBonus(src) {
    var out = { dmg: 0, hp: 0, armor: 0, think: 0, shieldCut: 0 };
    if (!src || typeof src !== "object") return out;
    var n = function (v, hi) { return typeof v === "number" && isFinite(v) ? clamp(v, 0, hi) : 0; };
    out.dmg = Math.floor(n(src.dmg, 12)); out.hp = Math.floor(n(src.hp, 60)); out.armor = Math.floor(n(src.armor, 4));
    out.think = Math.floor(n(src.think, 8000)); out.shieldCut = n(src.shieldCut, 0.5);
    return out;
  }

  /* Every relic can turn up in a run now (there's no pool to buy into). */
  function dvPool() { return DV_RELICS; }

  /* ------------------------------- Floors ------------------------------- */

  /* Four rows of rooms, then stairs (or the boss on a biome's fifth floor). */
  function dvMakeFloor(biome, floor) {
    var rows = [];
    var pick = function (rowIdx) {
      var r = Math.random();
      if (rowIdx === 0) return r < 0.92 ? "fight" : r < 0.95 ? "treasure" : "event";
      var table = [["fight", 0.515], ["elite", rowIdx >= 2 ? 0.12 : 0.04], ["treasure", 0.02], ["trap", 0.1], ["shop", 0.08], ["shrine", 0.06], ["camp", 0.08], ["event", 0.035]];
      var total = table.reduce(function (s, x) { return s + x[1]; }, 0);
      r *= total;
      for (var i = 0; i < table.length; i++) { r -= table[i][1]; if (r <= 0) return table[i][0]; }
      return "fight";
    };
    for (var k = 0; k < 4; k++) {
      var n = 2 + (Math.random() < 0.55 ? 1 : 0);
      var row = [];
      for (var j = 0; j < n; j++) row.push({ type: pick(k), links: [], done: false });
      rows.push(row);
    }
    // A campfire before every boss.
    if (floor === 4) rows[3][Math.floor(Math.random() * rows[3].length)].type = "camp";
    rows.push([{ type: floor === 4 ? "boss" : "stairs", links: [], done: false }]);
    // Links: each room reaches the nearest one or two rooms in the next row.
    for (var a = 0; a < rows.length - 1; a++) {
      var cur = rows[a], nxt = rows[a + 1];
      cur.forEach(function (node, i) {
        var pos = cur.length === 1 ? 0.5 : i / (cur.length - 1);
        var best = Math.round(pos * (nxt.length - 1));
        node.links = [best];
        var alt = best + (Math.random() < 0.5 ? -1 : 1);
        if (alt >= 0 && alt < nxt.length && Math.random() < 0.6) node.links.push(alt);
      });
      // Every next room must be reachable.
      nxt.forEach(function (node, j) {
        if (!cur.some(function (c) { return c.links.indexOf(j) !== -1; })) {
          var nearest = Math.round(j / Math.max(1, nxt.length - 1) * (cur.length - 1));
          cur[nearest].links.push(j);
        }
      });
    }
    return { rows: rows };
  }

  function dvMonsterFor(biome, rank) {
    var list = DV_MONSTERS.filter(function (m) { return m.biome === biome && m.rank === rank; });
    return list[Math.floor(Math.random() * list.length)] || DV_MONSTERS[0];
  }

  /* -------------------------------- Run -------------------------------- */

  function dvGame() { return game && game.id === "delve" ? game.delve : null; }
  function dvHas(id) { var D = dvGame(); return !!(D && D.run.relics.indexOf(id) !== -1); }
  function dvMaxHpFor(run, p) {
    var base = dvClass(run.cls).hp + 3 * p.camp.vitality;
    if (run.relics.indexOf("heartstone") !== -1) base += 6;
    if (run.relics.indexOf("glasscannon") !== -1) base -= 5;
    return Math.max(5, base + (run.bonusHp || 0) + (run.gearBonus ? run.gearBonus.hp : 0));
  }

  function dvNewRun(p, cls, startBiome, outfit) {
    var c = dvClass(cls);
    var run = { cls: c.id, hp: 0, maxHp: 0, gold: 15 * p.camp.purse, goldEarned: 0, relics: [c.relic], potions: c.id === "alchemist" ? 2 : 0,
      dmgBonus: 0, biome: startBiome, floor: 0, map: dvMakeFloor(startBiome, 0), row: -1, col: 0, inRoom: false, floorsCleared: 0, bosses: 0,
      kills: 0, phoenixUsed: false, startBiome: startBiome, floorFlags: {}, bonusHp: 0, gearBonus: dvParseGearBonus(null) };
    if (outfit) dvOutfit(p, run);
    run.maxHp = dvMaxHpFor(run, p);
    run.hp = run.maxHp;
    return run;
  }

  /* A new run takes the outfitter's gear (one run of durability each),
     supplies and relics. Returns lines describing what came along. */
  function dvOutfit(p, run) {
    var gb = run.gearBonus, notes = [];
    ["weapon", "armor", "trinket"].forEach(function (slot) {
      var it = p.gear[slot];
      var def = it && dvGearDef(it.id);
      if (!def) return;
      gb.dmg += def.dmg || 0; gb.hp += def.hp || 0; gb.armor += def.armor || 0; gb.think += def.think || 0; gb.shieldCut = Math.max(gb.shieldCut, def.shieldCut || 0);
      if (def.gold) run.gold += def.gold;
      it.runs--;
      notes.push(def.name + (it.runs > 0 ? " (" + it.runs + (it.runs === 1 ? " more run)" : " more runs)") : " (its last run)"));
      if (it.runs <= 0) p.gear[slot] = null;
    });
    p.supplies.forEach(function (id) {
      // Only Alchemists can drink potions; the pack waits for one.
      if (id === "potions" && run.cls !== "alchemist") {
        p.lanterns += dvSupplyDef(id).price;
        notes.push("Potion Pack refunded (" + dvSupplyDef(id).price + " lanterns): only Alchemists drink potions");
        return;
      }
      if (id === "potions") run.potions = Math.min(DV_MAX_POTIONS, run.potions + 2);
      if (id === "rations") gb.hp += 8;
      if (id === "oil") gb.dmg += 1;
      if (id === "gold") run.gold += 80;
      notes.push(dvSupplyDef(id).name);
    });
    p.supplies = [];
    p.packRelics.forEach(function (id) { if (run.relics.indexOf(id) === -1) { run.relics.push(id); p.codex.relics[id] = true; notes.push(dvRelic(id).name); } });
    p.packRelics = [];
    run.outfitNotes = notes;
    return notes;
  }

  function dvSave() {
    var g = game, D = g.delve;
    if (g.clean) return;
    var r = D.run;
    g.profile.run = { cls: r.cls, hp: r.hp, maxHp: r.maxHp, gold: r.gold, goldEarned: r.goldEarned, relics: r.relics.slice(), potions: r.potions,
      dmgBonus: r.dmgBonus, biome: r.biome, floor: r.floor, map: JSON.parse(JSON.stringify(r.map)), row: r.row, col: r.col, inRoom: !!D.room,
      floorsCleared: r.floorsCleared, bosses: r.bosses, kills: r.kills, phoenixUsed: r.phoenixUsed, startBiome: r.startBiome, bonusHp: r.bonusHp || 0,
      gearBonus: r.gearBonus || dvParseGearBonus(null),
      floorFlags: { forgiven: !!r.floorFlags.forgiven, evaded: !!r.floorFlags.evaded, nook: !!r.floorFlags.nook } };
    persistCompleted();
  }

  function dvGainRelic(id) {
    var D = dvGame(), run = D.run, p = game.profile;
    if (!id || run.relics.indexOf(id) !== -1) return null;
    run.relics.push(id);
    var oldMax = run.maxHp;
    run.maxHp = dvMaxHpFor(run, p);
    if (run.maxHp > oldMax) run.hp += run.maxHp - oldMax;
    run.hp = Math.min(run.hp, run.maxHp);
    if (!game.clean) p.codex.relics[id] = true;
    return dvRelic(id);
  }
  function dvRandomRelic(exclude) {
    var D = dvGame();
    var pool = dvPool(game.profile).filter(function (r) { return D.run.relics.indexOf(r.id) === -1 && (!exclude || exclude.indexOf(r.id) === -1); });
    return pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
  }

  function dvHeal(n) {
    var run = dvGame().run;
    var before = run.hp;
    run.hp = Math.min(run.maxHp, run.hp + n);
    return run.hp - before;
  }
  /* Returns true if the run survives the damage. */
  function dvHurt(n) {
    var D = dvGame(), run = D.run;
    run.hp = Math.max(0, run.hp - n);
    if (run.hp <= 0 && dvHas("phoenix") && !run.phoenixUsed) {
      run.phoenixUsed = true;
      run.hp = Math.ceil(run.maxHp / 2);
      notify("The Phoenix Feather burns and you rise again!");
    }
    if (!game.clean && game.profile.run) { game.profile.run.hp = run.hp; game.profile.run.phoenixUsed = run.phoenixUsed; if (run.hp <= 0) game.profile.run = null; persistCompleted(); }
    return run.hp > 0;
  }

  /* --------------------------- Floor navigation --------------------------- */

  function dvStartFloor() {
    var D = dvGame(), run = D.run;
    run.floorFlags = {};
    D.bloodlust = 0;
    var notes = [];
    if (dvHas("regen")) { var h = dvHeal(3); if (h) notes.push("Regrowth Ring: +" + h + " HP"); }
    if (dvHas("coinpurse")) { run.gold += 15; notes.push("Coin Purse: +15 gold"); }
    if (notes.length) notify(notes.join(" · "));
  }

  function dvReachable() {
    var run = dvGame().run;
    if (run.row < 0) return run.map.rows[0].map(function (n, i) { return i; });
    return run.map.rows[run.row][run.col].links.slice();
  }

  function dvShowMap(title, text) {
    var g = game, D = g.delve, run = D.run;
    D.phase = "map";
    D.room = null;
    g.current = null;
    g.locked = true;
    showQuestionPane(false);
    renderArena();
    byId("game-idle-title").textContent = title || DV_BIOMES[run.biome].name + " · floor " + dvDepth(run) + " of " + DV_FLOORS;
    byId("game-idle-text").textContent = text || "Pick the next room on the map. Lit rooms are the ones you can reach.";
    dvActions([]);
    byId("game-cast-btn").classList.add("hidden");
    renderGameHud();
    renderGameTimer();
    dvSave();
  }

  /* Buttons in the idle pane: [[label, fn, primary?, disabled?], ...] */
  function dvActions(list) {
    var box = byId("game-idle-actions");
    box.textContent = "";
    list.forEach(function (a, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = a[0];
      if (a[2]) b.className = "primary";
      b.disabled = !!a[3];
      b.addEventListener("click", function () { if (game && !game.paused && !game.over && purchaseAllowed()) a[1](); });
      box.appendChild(b);
      if (i === 0 && !a[3]) setTimeout(function () { if (document.body.contains(b)) b.focus(); }, 0);
    });
  }

  function dvEnterRoom(col) {
    var g = game, D = g.delve, run = D.run;
    if (D.phase !== "map" || g.paused || g.over) return;
    if (dvReachable().indexOf(col) === -1) return;
    run.row++;
    run.col = col;
    var node = run.map.rows[run.row][col];
    // Decide what's inside now, so quitting and coming back can't reroll it.
    if (node.type === "fight" || node.type === "elite" || node.type === "boss") node.mon = dvMonsterFor(run.biome, node.type === "fight" ? "normal" : node.type).id;
    if (node.type === "event") node.ev = DV_EVENTS[Math.floor(Math.random() * DV_EVENTS.length)].id;
    if (node.type === "shop") {
      var stock = [];
      for (var s = 0; s < (dvHas("spyglass") ? 3 : 2); s++) { var sid = dvRandomRelic(stock); if (sid) stock.push(sid); }
      node.stock = stock;
    }
    if (node.type === "treasure") {
      // Chests always hold a relic (a Treasure Map adds a second).
      node.gold = Math.round((25 + Math.random() * 15 + run.biome * 8) * (dvHas("treasuremap") ? 2 : 1) * dvGoldMult(false));
      node.relic = dvRandomRelic();
      node.relic2 = dvHas("treasuremap") ? dvRandomRelic(node.relic ? [node.relic] : null) : null;
    }
    D.room = { type: node.type };
    dvSave(); // the save from entering the room is the one a quit returns to
    dvRoom(node.type);
  }

  function dvRoom(type) {
    var g = game, D = g.delve, run = D.run;
    var title = byId("game-idle-title"), text = byId("game-idle-text");
    D.phase = "room";
    renderArena();
    var price = function (base) { return Math.round(base * (dvHas("merchant") ? 0.75 : 1)); };
    var node = run.row >= 0 ? run.map.rows[run.row][run.col] : {};
    if (type === "fight" || type === "elite" || type === "boss") {
      var mdef = DV_MONSTERS.filter(function (x) { return x.id === node.mon; })[0] || dvMonsterFor(run.biome, type === "fight" ? "normal" : type);
      dvStartFight(mdef);
      return;
    }
    if (type === "stairs") { dvNextFloor(); return; }
    if (type === "treasure") {
      var gold = node.gold || 25;
      dvAddGold(gold);
      var rel = node.relic ? dvGainRelic(node.relic) : null;
      var rel2 = node.relic2 ? dvGainRelic(node.relic2) : null;
      title.textContent = "A treasure chest!";
      text.textContent = "+" + gold + " gold." + (rel ? " Inside you also find the " + rel.name + ": " + rel.desc : " (You already carry every relic.)") +
        (rel2 ? " Your Treasure Map leads to a second: the " + rel2.name + ", " + rel2.desc : "");
      dvActions([["Continue", dvRoomDone, true]]);
    } else if (type === "trap") {
      title.textContent = "A trap!";
      text.textContent = dvHas("trapsense") ? "Your Trap Sense spots it. You step around it." : "Answer correctly to slip past. A miss costs " + dvTrapDamage(run) + " HP.";
      if (dvHas("trapsense")) dvActions([["Continue", dvRoomDone, true]]);
      else { D.phase = "trap"; dvAsk(); }
    } else if (type === "shop") {
      var cost = price(70 + 12 * run.biome);
      if (!D.shopStock) D.shopStock = (node.stock || []).filter(function (id) { return dvRelic(id) && run.relics.indexOf(id) === -1; });
      title.textContent = "A wandering shop";
      text.textContent = "You have " + run.gold + " gold. " + D.shopStock.map(function (id) { return dvRelic(id).name + ": " + dvRelic(id).desc; }).join(" ");
      var acts = D.shopStock.map(function (id) {
        return ["Buy " + dvRelic(id).name + " (" + cost + ")", function () {
          if (run.gold < cost || D.shopStock.indexOf(id) === -1) return;
          run.gold -= cost;
          dvGainRelic(id);
          D.shopStock = D.shopStock.filter(function (x) { return x !== id; });
          notify("Bought the " + dvRelic(id).name + ".");
          dvRoom("shop");
        }, false, run.gold < cost];
      });
      var potionsFull = run.potions >= DV_MAX_POTIONS;
      if (run.cls === "alchemist") acts.push(["Potion: heal 8 (" + (potionsFull ? "bag full" : price(30)) + ")", function () { if (run.gold < price(30) || run.potions >= DV_MAX_POTIONS) return; run.gold -= price(30); run.potions++; dvRoom("shop"); }, false, run.gold < price(30) || potionsFull]);
      acts.push(["Leave", function () { D.shopStock = null; dvRoomDone(); }, true]);
      dvActions(acts);
      renderGameHud();
    } else if (type === "shrine") {
      var pay = Math.max(1, Math.round(run.hp * (dvHas("tithe") ? 0.15 : 0.3)));
      title.textContent = "An old shrine";
      text.textContent = "Offer " + pay + " HP. The shrine answers about half of offerings with a relic, and sometimes with greater vitality.";
      dvActions([["Offer " + pay + " HP", function () {
        if (!dvHurt(pay)) { dvDie(); return; }
        var r = Math.random() < DV_SHRINE_CHANCE ? dvGainRelic(dvRandomRelic()) : null;
        var vigor = !r && (run.bonusHp || 0) + 4 <= DV_BONUS_HP_MAX && Math.random() < DV_SHRINE_HP_CHANCE;
        if (vigor) { run.bonusHp = (run.bonusHp || 0) + 4; run.maxHp = dvMaxHpFor(run, game.profile); run.hp += 4; }
        title.textContent = r ? "The shrine grants the " + r.name : vigor ? "The shrine grants vitality" : "The shrine is silent";
        text.textContent = r ? r.desc : vigor ? "+4 max HP for the rest of this run." : "It takes your offering and gives nothing back this time.";
        dvActions([["Continue", dvRoomDone, true]]);
        renderGameHud();
      }, true, run.hp <= pay], ["Leave", dvRoomDone]]);
    } else if (type === "camp") {
      var heal = Math.round(run.maxHp * (dvHas("campkit") ? 0.5 : 0.35));
      title.textContent = "A campfire";
      text.textContent = "Rest to heal " + heal + " HP, or use the fire" + (run.cls === "alchemist" ? " to brew a potion" : " to sharpen your weapon (+1 damage for the rest of the run)") + ".";
      var fireMaxed = run.cls === "alchemist" ? run.potions >= DV_MAX_POTIONS : run.dmgBonus >= DV_MAX_DMG_BONUS;
      dvActions([["Rest (+" + heal + " HP)", function () { dvHeal(heal); dvRoomDone(); }, true],
        [(run.cls === "alchemist" ? "Brew a potion" : "Sharpen (+1 damage)") + (fireMaxed ? (run.cls === "alchemist" ? " (bag full)" : " (maxed)") : ""), function () { if (fireMaxed) return; if (run.cls === "alchemist") run.potions = Math.min(DV_MAX_POTIONS, run.potions + 1); else run.dmgBonus = Math.min(DV_MAX_DMG_BONUS, run.dmgBonus + 1); dvRoomDone(); }, false, fireMaxed]]);
    } else if (type === "event") {
      dvEvent();
    }
  }

  function dvRoomDone() {
    var g = game, D = g.delve, run = D.run;
    run.map.rows[run.row][run.col].done = true;
    D.room = null;
    D.shopStock = null;
    dvShowMap();
  }

  function dvNextFloor() {
    var g = game, D = g.delve, run = D.run, p = g.profile;
    run.floorsCleared++;
    if (run.floor === 4) {
      // A biome's boss is down: descend or go home.
      if (run.biome === DV_BIOMES.length - 1) { dvEnd("victory"); return; }
      run.biome++;
    }
    run.floor = run.floor === 4 ? 0 : run.floor + 1;
    run.map = dvMakeFloor(run.biome, run.floor);
    run.row = -1;
    run.col = 0;
    var depth = dvDepth(run);
    if (!g.clean && depth > p.deepest) {
      p.deepest = depth;
      if (run.floor === 0) notify("New depth: " + DV_BIOMES[run.biome].name + "! You can buy a shortcut here at camp." +
        (run.biome === 5 ? " The Deep begins: stronger monsters, shields on elites and bosses." : run.biome === 10 ? " The Abyss: every monster has a shield now." : run.biome === 15 ? " The Void. Few come back from here." : ""));
    }
    gameEvent("delvefloor", { value: depth });
    dvStartFloor();
    dvShowMap();
  }

  /* ------------------------------- Events ------------------------------- */

  function dvEvent() {
    var g = game, D = g.delve, run = D.run;
    var node = run.map.rows[run.row][run.col];
    var ev = DV_EVENTS.filter(function (e) { return e.id === node.ev; })[0] || DV_EVENTS[0];
    if (ev.id === "ghost" && run.relics.length < 1) ev = DV_EVENTS[0];
    if (!g.clean) g.profile.codex.events[ev.id] = true;
    byId("game-idle-title").textContent = ev.name;
    byId("game-idle-text").textContent = ev.text;
    var outcome = function (msg) {
      byId("game-idle-title").textContent = ev.name;
      byId("game-idle-text").textContent = msg;
      dvActions([["Continue", dvRoomDone, true]]);
      renderGameHud();
    };
    dvActions(ev.choices.map(function (c, i) {
      return [c[0], function () {
        var r;
        switch (c[1]) {
          case "leave": dvRoomDone(); return;
          case "well":
            if (run.gold < 25) { outcome("You don't have 25 gold."); return; }
            run.gold -= 25; r = dvEventRelic() ? dvGainRelic(dvRandomRelic()) : null;
            outcome(r ? "A relic floats up: the " + r.name + ". " + r.desc : "The coins sink. Nothing happens."); return;
          case "adventurer":
            if (!dvHurt(5)) { dvDie(); return; }
            dvAddGold(45); outcome("They thank you with 45 gold."); return;
          case "altar": D.phase = "altar"; D.forceHard = true; dvAsk(); return;
          case "cursed":
            if ((run.bonusHp || 0) - 4 < DV_BONUS_HP_MIN) { outcome("The chest's curse can't take any more from you, and it stays sealed."); return; }
            if (!dvEventRelic()) { outcome("The chest is empty, and its magic fades before it can curse you."); return; }
            run.bonusHp = (run.bonusHp || 0) - 4; r = dvGainRelic(dvRandomRelic());
            run.maxHp = dvMaxHpFor(run, game.profile); run.hp = Math.min(run.hp, run.maxHp);
            outcome((r ? "You take the " + r.name + ". " : "The chest was empty. ") + "Your max HP drops by 4."); return;
          case "nook":
            dvHeal(3); run.floorFlags.nook = true; outcome("You feel rested: +3 HP and 1 extra second of thinking time on this floor."); return;
          case "ghost":
            if (!dvEventRelic()) { outcome("The ghost looks over your relics, shakes its head and fades away."); return; }
            var lost = run.relics.pop(); run.maxHp = dvMaxHpFor(run, game.profile); run.hp = Math.min(run.hp, run.maxHp);
            var a = dvGainRelic(dvRandomRelic([lost])), b2 = dvGainRelic(dvRandomRelic([lost]));
            outcome("The ghost takes your " + dvRelic(lost).name + " and leaves " + [a, b2].filter(Boolean).map(function (x) { return x.name; }).join(" and ") + "."); return;
          case "mushroom":
            if (Math.random() < 0.5) { dvHeal(10); outcome("Delicious! +10 HP."); }
            else { if (!dvHurt(4)) { dvDie(); return; } outcome("Ugh. -4 HP."); }
            return;
          case "echo": D.phase = "echo"; D.echoLeft = 3; dvAsk(); return;
        }
      }, i === 0];
    }));
  }

  /* ------------------------------- Fights ------------------------------- */

  function dvStartFight(mon) {
    var g = game, D = g.delve, run = D.run;
    var hp = Math.round(mon.hits * (mon.rank === "boss" ? 1.6 : 2)); // a typical hit deals 1-2
    D.mon = { def: mon, hp: hp, max: hp, shield: mon.ab.indexOf("shielded") !== -1, hitsLanded: 0, shields: dvShieldsFor(mon, hp, run) };
    D.fightStreak = 0;
    D.guard = false;
    D.studyUsed = false;
    D.mirrorUsed = false;
    D.phase = "fight";
    if (dvHas("wardrum")) g.combo = Math.max(g.combo, 2);
    var notes = [];
    if (dvHas("secondwind") && run.hp < 5) { dvHeal(4); notes.push("Second Wind: +4 HP."); }
    if (dvHas("bomb")) { D.mon.hp = Math.max(1, D.mon.hp - 2); notes.push("Pocket Bomb: 2 damage."); }
    if (notes.length) notify(notes.join(" "));
    if (!g.clean && !g.profile.codex.monsters[mon.id]) notify("New monster: " + mon.name + (mon.ab.length ? " (" + mon.ab.map(function (a) { return DV_ABILITIES[a].name; }).join(", ") + ")" : "") + ".");
    renderArena();
    dvAsk();
  }

  /* Shield layers: bars that have to be broken before the monster's
     health. A hit that breaks a layer stops there, and a miss lets the
     outer layer recharge a little. How many layers depends on the depth
     and the monster's rank (see DV_TIERS). */
  function dvShieldsFor(mon, hp, run) {
    if (mon.id === "splitling") return [];
    var n = DV_TIERS[dvTier(mon.biome)].shields[mon.rank] || 0;
    var cut = run.gearBonus ? run.gearBonus.shieldCut : 0;
    var size = Math.max(2, Math.ceil(hp * 0.35 * (1 - cut)));
    var out = [];
    for (var i = 0; i < n; i++) out.push({ hp: size, max: size });
    return out;
  }

  function dvAsk() {
    var g = game;
    g.locked = false;
    dvActions([]);
    nextGameQuestion();
    g.lastFrame = performance.now();
  }

  function dvAb(a) { var D = dvGame(); return !!(D && D.phase === "fight" && D.mon && D.mon.def.ab.indexOf(a) !== -1); }

  var DV_SHRINE_CHANCE = 0.5;     // a relic
  var DV_SHRINE_HP_CHANCE = 0.5;  // otherwise, +4 max HP
  var DV_EVENT_RELIC_CHANCE = 0.4; // "?" rooms that offer a relic
  function dvEventRelic() { return Math.random() < DV_EVENT_RELIC_CHANCE; }
  function dvTrapDamage(run) { return 4 + Math.round(run.biome * 0.8); }

  function dvGoldMult(kill) {
    return (dvHas("goldtooth") ? 2 : 1) * (kill && dvHas("midas") ? 1.5 : 1) * (game.rewardMult || 1);
  }
  function dvAddGold(n) { var run = dvGame().run; run.gold += n; run.goldEarned += n; }

  function dvDamage(speed) {
    var g = game, D = g.delve, run = D.run, m = D.mon;
    var dmg = 1 + run.dmgBonus + (run.gearBonus ? run.gearBonus.dmg : 0);
    if (dvHas("whetstone")) dmg++;
    if (dvHas("glasscannon")) dmg += 2;
    if (dvHas("berserkhelm")) dmg++;
    if (dvHas("adrenaline") && run.hp < run.maxHp / 2) dmg++;
    if (dvHas("combocrown")) dmg += Math.min(3, Math.floor(g.combo / 5));
    if (dvHas("bloodlust")) dmg += D.bloodlust || 0;
    if (dvHas("elitehunter") && m.def.rank !== "normal") dmg++;
    if (dvHas("scholarcap") && g.current && g.current.level === "hard") dmg++;
    if (speed > 0.5) dmg += dvHas("quill") ? 2 : 1;
    if (g.current && g.current.mgBonus) dmg += g.current.mgBonus; // won the minigame
    if (dvHas("executioner") && m.hp <= m.max * 0.3) dmg *= 2;
    if (dvHas("ember") && m.hitsLanded === 0) dmg *= 3;
    return dmg;
  }

  function dvCorrect(c, speed) {
    var g = game, D = g.delve;
    var msg = "";
    if (dvHas("streakheal") && g.combo > 0 && g.combo % 3 === 0) { var hh = dvHeal(2); if (hh) msg += " Streak Charm: +" + hh + " HP."; }
    // A lethal poison tick ends the run before the answer does anything.
    if (!dvTickPoison()) return { points: 0, message: "The poison finishes you." + msg };
    if (D.phase === "trap") {
      dvAddGold(10);
      D.after = function () { byId("game-idle-title").textContent = "You slip past the trap"; byId("game-idle-text").textContent = "+10 gold."; dvActions([["Continue", dvRoomDone, true]]); };
      return { points: 0, message: "You slip past the trap! +10 gold." + msg };
    }
    if (D.phase === "altar") {
      D.forceHard = false;
      var r = dvEventRelic() ? dvGainRelic(dvRandomRelic()) : null;
      D.after = function () { byId("game-idle-title").textContent = r ? "The altar glows" : "The altar dims"; byId("game-idle-text").textContent = r ? "You receive the " + r.name + ": " + r.desc : "It accepts your answer but gives nothing this time."; dvActions([["Continue", dvRoomDone, true]]); };
      return { points: 0, message: "Correct!" + (r ? " The altar rewards you." : "") + msg };
    }
    if (D.phase === "echo") {
      D.echoLeft--;
      if (D.echoLeft > 0) return { points: 0, message: "Correct! " + D.echoLeft + " to go." + msg };
      dvAddGold(80);
      D.after = function () { byId("game-idle-title").textContent = "The hall falls silent"; byId("game-idle-text").textContent = "Three in a row. +80 gold."; dvActions([["Continue", dvRoomDone, true]]); };
      return { points: 0, message: "Three in a row! +80 gold." + msg };
    }
    var m = D.mon;
    D.fightStreak++;
    var need = dvHas("pickaxe") ? 2 : 3;
    if (m.def.ab.indexOf("armored") !== -1 && D.fightStreak < need) {
      dvRenderFight("block");
      return { points: 0, message: "Your hit glances off its armor (" + D.fightStreak + "/" + need + " streak)." + msg };
    }
    if (m.shield) {
      m.shield = false;
      dvRenderFight("block");
      return { points: 0, message: "Its shield blocks the hit and breaks!" + msg };
    }
    var dmg = dvDamage(speed);
    if (m.shields && m.shields.length) {
      var sh = m.shields[0];
      sh.hp = Math.max(0, sh.hp - dmg);
      m.hitsLanded++;
      floatText("-" + dmg + " shield", "dmg-float shield");
      dvRenderFight("block");
      if (sh.hp <= 0) {
        m.shields.shift();
        return { points: 0, message: "Shield broken!" + (m.shields.length ? " One more layer to go." : " Now its health.") + msg };
      }
      return { points: 0, message: "Hit the shield for " + dmg + " (" + sh.hp + " left)." + msg };
    }
    m.hp = Math.max(0, m.hp - dmg);
    m.hitsLanded++;
    floatText("-" + dmg, "dmg-float" + (dmg >= 3 ? " crit" : ""));
    if (m.hp <= 0) return { points: 0, message: dvKill() + msg };
    dvRenderFight("hit");
    return { points: 0, message: "Hit for " + dmg + "!" + msg };
  }

  function dvKill() {
    var g = game, D = g.delve, run = D.run, m = D.mon;
    var base = m.def.rank === "boss" ? 60 + 15 * run.biome : m.def.rank === "elite" ? 25 + 6 * run.biome : 8 + 3 * run.biome + Math.floor(Math.random() * 6);
    var gold = Math.round(base * dvGoldMult(true));
    dvAddGold(gold);
    run.kills++;
    if (!g.clean && m.def.id !== "splitling") g.profile.codex.monsters[m.def.id] = (g.profile.codex.monsters[m.def.id] || 0) + 1;
    var extra = "";
    if (dvHas("vampfang")) { var h = dvHeal(1); if (h) extra += " +1 HP."; }
    if (dvHas("bloodlust")) D.bloodlust = Math.min(3, (D.bloodlust || 0) + 1);
    // Elites always drop a relic.
    if (m.def.rank === "elite") {
      var drop = dvGainRelic(dvRandomRelic());
      if (drop) extra += " It drops the " + drop.name + ": " + drop.desc;
    }
    gameEvent("delvekill");
    if (m.def.rank === "boss") {
      run.bosses++;
      gameEvent("delveboss");
      addXp(100, true);
    }
    var name = m.def.name;
    if (m.def.ab.indexOf("splitting") !== -1 && m.def.id !== "splitling") {
      D.split = true;
    }
    dvRenderFight("dead");
    D.won = true;
    return name + " defeated! +" + gold + " gold." + extra;
  }

  function dvTickPoison() {
    var D = dvGame();
    if (!D.poison) return true;
    D.poison--;
    floatText("-1 poison", "arena-penalty");
    return dvHurt(1);
  }

  function dvMiss(late) {
    var g = game, D = g.delve, run = D.run;
    var alive = dvTickPoison();
    if (!alive) return "The poison finishes you. ";
    if (D.phase === "trap") {
      var t = dvTrapDamage(run);
      alive = dvHurt(t);
      D.after = function () { byId("game-idle-title").textContent = "The trap springs"; byId("game-idle-text").textContent = "-" + t + " HP."; dvActions([["Continue", dvRoomDone, true]]); };
      return alive ? "The trap springs! -" + t + " HP. " : "The trap was fatal. ";
    }
    if (D.phase === "altar") {
      D.forceHard = false;
      alive = dvHurt(5);
      D.after = function () { byId("game-idle-title").textContent = "The altar burns you"; byId("game-idle-text").textContent = "-5 HP."; dvActions([["Continue", dvRoomDone, true]]); };
      return alive ? "Wrong. The altar burns you for 5 HP. " : "Wrong. The altar's fire was fatal. ";
    }
    if (D.phase === "echo") {
      alive = dvHurt(3);
      D.after = function () { byId("game-idle-title").textContent = "The echoes laugh"; byId("game-idle-text").textContent = "-3 HP."; dvActions([["Continue", dvRoomDone, true]]); };
      return alive ? "The echoes laugh. -3 HP. " : "The echoes laugh, and it was fatal. ";
    }
    var m = D.mon;
    D.fightStreak = 0;
    var notes = [];
    var dmg = m.def.atk * (m.def.ab.indexOf("berserk") !== -1 ? 2 : 1);
    if (run.gearBonus && run.gearBonus.armor) dmg = Math.max(1, dmg - run.gearBonus.armor);
    if (dvHas("ironskin")) dmg = Math.max(1, dmg - 1);
    if (dvHas("berserkhelm")) dmg++;
    var blocked = "";
    if (D.guard) { D.guard = false; blocked = "You raise your guard"; }
    else if (late && dvHas("calm")) blocked = "Calm Mind";
    else if (dvHas("forgive") && !run.floorFlags.forgiven) { run.floorFlags.forgiven = true; blocked = "Pardon Seal"; }
    else if (dvHas("mirror") && !D.mirrorUsed) { D.mirrorUsed = true; blocked = "Mirror Shield"; }
    else if (dvHas("luckycoin") && Math.random() < 0.2) blocked = "Lucky Coin";
    if (blocked) notes.push(blocked + ": no damage.");
    else {
      alive = dvHurt(dmg);
      notes.push(m.def.name + " hits you for " + dmg + ".");
      floatText("-" + dmg + " HP", "arena-penalty");
      if (dvHas("thorns") && alive) { m.hp = Math.max(0, m.hp - 1); notes.push("Thorns: 1 back."); }
    }
    if (m.shields && m.shields.length) {
      var sh = m.shields[0], back = Math.max(1, Math.round(sh.max * 0.15));
      if (sh.hp < sh.max) { sh.hp = Math.min(sh.max, sh.hp + back); notes.push("Its shield recharges."); }
    }
    if (m.def.ab.indexOf("vampire") !== -1 && m.hp > 0) { m.hp = Math.min(m.max, m.hp + 1); notes.push("It drains 1 HP back."); }
    if (m.def.ab.indexOf("thief") !== -1) { var stolen = Math.min(10, run.gold); run.gold -= stolen; if (stolen) notes.push("It steals " + stolen + " gold."); }
    if (m.def.ab.indexOf("poison") !== -1 && !dvHas("antidote")) { D.poison = 3; notes.push("You're poisoned."); }
    if (alive && m.hp <= 0) { notes.push(dvKill()); }
    else dvRenderFight("miss");
    return (late ? "Too slow! " : "Missed! ") + notes.join(" ") + " ";
  }

  function dvAfterFeedback() {
    var g = game, D = g.delve, run = D.run;
    if (run.hp <= 0) { dvDie(); return true; }
    if (D.after) { var fn = D.after; D.after = null; D.phase = "room"; g.current = null; g.locked = true; showQuestionPane(false); renderArena(); fn(); renderGameHud(); return true; }
    if (D.phase === "echo" || D.phase === "fight" && !D.won) return false; // next question
    if (D.phase === "fight" && D.won) {
      D.won = false;
      if (D.split) { D.split = false; notify("It splits! A Sporeling remains."); dvStartFight(DV_SPLITLING); return true; }
      g.current = null; g.locked = true; showQuestionPane(false);
      var wasBoss = D.mon.def.rank === "boss";
      D.mon = null;
      D.phase = "room";
      D.poison = 0;
      renderArena();
      if (wasBoss) {
        var next = run.biome < DV_BIOMES.length - 1 ? DV_BIOMES[run.biome + 1].name : null;
        byId("game-idle-title").textContent = DV_BIOMES[run.biome].name + " conquered!";
        byId("game-idle-text").textContent = next ? "Go deeper into the " + next + " (floor " + (dvDepth(run) + 1) + "), or head back to camp and keep every lantern you've earned." : "The Endless Dark ends after all. You conquered all 100 floors!";
        if (next) dvActions([["Descend to the " + next, dvRoomDoneThenNext, true], ["Return to camp", function () { dvEnd("leave"); }]]);
        else dvActions([["Climb out victorious", function () { dvEnd("victory"); }, true]]);
      } else {
        byId("game-idle-title").textContent = "Room cleared";
        byId("game-idle-text").textContent = "HP " + run.hp + " / " + run.maxHp + " · " + run.gold + " gold.";
        dvActions([["Continue", dvRoomDone, true]]);
      }
      renderGameHud();
      return true;
    }
    return false;
  }
  function dvRoomDoneThenNext() {
    var run = dvGame().run;
    run.map.rows[run.row][run.col].done = true;
    dvGame().room = null;
    dvNextFloor();
  }

  function dvAbility() {
    var g = game, D = dvGame();
    if (!D || g.paused || g.over) return;
    var run = D.run, cls = run.cls;
    var c = g.current;
    var inQuestion = c && !g.locked && !byId("game-question-pane").classList.contains("hidden");
    if (cls === "alchemist") {
      if (run.potions <= 0 || run.hp >= run.maxHp || run.hp <= 0 || D.ended) return;
      if (g.locked && g.current) return; // not during the feedback after an answer
      run.potions--;
      var h = dvHeal(8);
      floatText("+" + h + " HP", "dmg-float money");
      if (!g.clean && g.profile.run) { g.profile.run.hp = run.hp; g.profile.run.potions = run.potions; persistCompleted(); }
      renderGameHud();
      dvRenderFight();
      return;
    }
    if (D.phase !== "fight" || !inQuestion) return;
    if (cls === "scholar") {
      if (D.studyUsed || c.tf || c.hs) return;
      D.studyUsed = true;
      var wrong = ["a", "b", "c", "d"].filter(function (s) { return s !== c.correctSlot; });
      seededShuffle(wrong, (Date.now() >>> 0)).slice(0, 2).forEach(function (s) {
        var b = document.querySelector('#game-choices button.choice[data-slot="' + s + '"]');
        if (b) b.classList.add("removed");
      });
    } else if (cls === "rogue") {
      if (run.floorFlags.evaded) return;
      run.floorFlags.evaded = true;
      g.locked = true;
      byId("game-choices").classList.add("locked");
      var fb = byId("game-feedback");
      fb.classList.remove("wrong"); fb.classList.add("right");
      fb.textContent = "You slip out of the way. No damage.";
      gameAfter(900, function () { afterGameFeedback(false); });
    } else if (cls === "knight") {
      if (D.guard || D.guardUsedFight === D.mon) return;
      D.guard = true;
      D.guardUsedFight = D.mon;
      notify("Guard up: your next miss in this fight does no damage.");
    }
    renderGameHud();
    dvRenderFight();
  }

  /* ------------------------------ Ending ------------------------------ */

  function dvLanterns(reason) {
    var D = dvGame(), run = D.run;
    var base = run.goldEarned * 0.25 + 2 * run.floorsCleared + 10 * run.bosses;
    if (dvHas("lantern")) base *= 1.25;
    return Math.round(base * (reason === "death" ? 0.6 : 1));
  }

  function dvDie() {
    var D = dvGame();
    if (!D || D.ended) return;
    dvEnd("death");
  }

  function dvEnd(reason) {
    var g = game, D = g.delve, run = D.run, p = g.profile;
    if (D.ended) return;
    D.ended = true;
    D.reason = reason;
    D.lanterns = dvLanterns(reason);
    if (!g.clean) {
      p.lanterns += D.lanterns;
      p.run = null;
      if (reason === "victory") p.wins++;
      checkAchievements("delve");
    }
    g.score = dvDepth(run);
    if (reason === "victory") gameEvent("delvewin");
    endGame(false);
  }

