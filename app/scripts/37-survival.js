  /* =========================== Survival: biomes and perks ===========================
     The run moves to a new biome every 15 correct answers; each biome has a
     hazard. Perks are picked before a run and unlock at single-run
     milestones; milestones at 25/50/100/200 pay XP. */

  var SV_BIOMES = [
    { id: "meadow", name: "Meadow", hazards: [], desc: "Calm. No hazard." },
    { id: "storm", name: "Storm", hazards: ["storm"], desc: "Lightning hides one answer for the first 2 seconds (you get a second back)." },
    { id: "heat", name: "Heat Wave", hazards: ["heat"], desc: "Thinking time shrinks twice as fast here." },
    { id: "fog", name: "Fog Bank", hazards: ["fog"], desc: "The question is hidden for the first second (you get it back)." },
    { id: "swamp", name: "Swamp", hazards: ["swamp"], desc: "Streaks don't earn power-ups here." },
    { id: "volcano", name: "Volcano", hazards: ["volcano"], desc: "Every question uses hard wrong answers." },
    { id: "blizzard", name: "Blizzard", hazards: ["blizzard"], desc: "Power-ups can't be used here." },
    { id: "eclipse", name: "Eclipse", hazards: ["storm", "heat"], desc: "Storm and Heat Wave at once." }
  ];
  var SV_PERKS = [
    { id: "chill", name: "Chill", desc: "Start with a Freeze.", need: 0 },
    { id: "tough", name: "Tough", desc: "Start with 4 hearts.", need: 25 },
    { id: "medic", name: "Medic", desc: "Start with a Heal.", need: 40 },
    { id: "steady", name: "Steady", desc: "The timer shrinks half as fast.", need: 50 },
    { id: "lucky", name: "Lucky", desc: "A power-up every 4 in a row instead of 5.", need: 75 },
    { id: "secondwind", name: "Second wind", desc: "Once per run, a miss on your last heart is forgiven.", need: 100 },
    { id: "scholar", name: "Scholar", desc: "+1 s thinking time all run.", need: 150 },
    { id: "collector", name: "Collector", desc: "Start with a 50/50.", need: 200 }
  ];
  var SV_MILESTONES = [[25, 50], [50, 100], [100, 250], [200, 500]];

  function freshSurvivalProfile() { return { best: 0, perks: ["chill"] }; }
  function parseSurvivalProfile(src) {
    var p = freshSurvivalProfile();
    if (!src || typeof src !== "object") return p;
    if (typeof src.best === "number" && isFinite(src.best)) p.best = Math.max(0, Math.floor(src.best));
    if (Array.isArray(src.perks)) p.perks = src.perks.filter(function (id) { return SV_PERKS.some(function (k) { return k.id === id; }); }).slice(0, 3);
    return p;
  }
  function svSlots(best) { return best >= 200 ? 3 : best >= 100 ? 2 : 1; }
  function svPerkOpen(p, perk) { return p.best >= perk.need; }

  function svFillSetup() {
    var p = state.gameData.survival;
    var box = byId("survival-perks");
    box.textContent = "";
    var slots = svSlots(p.best);
    var chosen = p.perks.filter(function (id) { return svPerkOpen(p, SV_PERKS.filter(function (k) { return k.id === id; })[0]); }).slice(0, slots);
    SV_PERKS.forEach(function (perk) {
      var open = svPerkOpen(p, perk);
      var lab = document.createElement("label");
      lab.className = "option sv-perk" + (open ? "" : " locked");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = perk.id;
      cb.disabled = !open;
      cb.checked = open && chosen.indexOf(perk.id) !== -1;
      cb.addEventListener("change", function () {
        var on = Array.prototype.filter.call(box.querySelectorAll("input:checked"), function (x) { return x !== cb; });
        if (cb.checked && on.length >= slots) { on[0].checked = false; }
        svSyncSetup();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(" " + perk.name + " "));
      var hint = document.createElement("span");
      hint.className = "skip-hint-inline";
      hint.textContent = open ? "" : "(" + perk.need + ")";
      if (!open) lab.title = perk.desc + " Unlocks at " + perk.need + " correct in one run.";
      if (open) lab.title = perk.desc;
      lab.appendChild(hint);
      box.appendChild(lab);
    });
    svSyncSetup();
  }
  function svSyncSetup() {
    var p = state.gameData.survival;
    var slots = svSlots(p.best);
    var picked = Array.prototype.map.call(byId("survival-perks").querySelectorAll("input:checked"), function (x) {
      var k = SV_PERKS.filter(function (pk) { return pk.id === x.value; })[0];
      return k.name + ": " + k.desc;
    });
    byId("survival-info").textContent = (picked.length ? picked.join(" ") + " " : "") + "Pick up to " + slots + (slots === 1 ? " perk" : " perks") + ". Best run: " + p.best + " correct." +
      (slots < 3 ? " A " + (slots === 1 ? "second slot opens at 100" : "third slot opens at 200") + " correct in one run." : "");
  }

  function svBiome(g) { return SV_BIOMES[Math.floor((g || game).correct / 15) % SV_BIOMES.length]; }
  function svHazard(h) { var g = game; return !!(g && g.survival && svBiome(g).hazards.indexOf(h) !== -1); }

  /* After a correct answer in Survival: milestones and biome changes. */
  function svAfterCorrect() {
    var g = game, S = g.survival;
    SV_MILESTONES.forEach(function (m) {
      if (g.correct === m[0]) {
        addXp(m[1], true);
        var fresh = SV_PERKS.filter(function (k) { return k.need === m[0] && g.profile.best < m[0]; });
        notify("Milestone: " + m[0] + " correct! +" + m[1] + " XP." + (fresh.length ? " Perk unlocked: " + fresh.map(function (k) { return k.name; }).join(", ") + "." : ""));
        gameEvent("svmilestone", { value: m[0] });
      }
    });
    if (g.correct % 15 === 0) {
      var b = svBiome(g);
      S.biomeStart = g.correct;
      var lap = Math.floor(g.correct / (15 * SV_BIOMES.length));
      notify("Entering the " + b.name + (lap ? " " + ROMAN[Math.min(lap, ROMAN.length - 1)].trim() : "") + ". " + b.desc);
    }
  }

  GAME_HOOKS.survival = {
    keepBest: true,
    setupPanel: "game-survival-options",
    setupOpened: function () { svFillSetup(); },
    readSetup: function () {
      return { perks: Array.prototype.map.call(byId("survival-perks").querySelectorAll("input:checked"), function (x) { return x.value; }) };
    },
    begin: function (g, setup) {
      var p = g.profile = state.gameData.survival;
      var chosen = (setup.extra && setup.extra.perks || []).filter(function (id) {
        var perk = SV_PERKS.filter(function (k) { return k.id === id; })[0];
        return perk && svPerkOpen(p, perk);
      }).slice(0, svSlots(p.best));
      p.perks = chosen.slice();
      var has = {};
      chosen.forEach(function (id) { has[id] = true; });
      g.survival = { perks: has, biomeStart: 0, windUsed: false };
      if (has.tough) { g.maxHearts = 4; g.hearts = 4; }
      if (has.chill) g.powerups.freeze++;
      if (has.medic) g.powerups.heal++;
      if (has.collector && g.types.indexOf("mc") !== -1) g.powerups.fifty++;
    },
    thinkAdjust: function (who) {
      var g = game, S = g.survival;
      if (!S || (who && who.bot)) return 0;
      var t = 0;
      if (S.perks.scholar) t += 1000;
      if (S.perks.steady) t += 50 * g.correct; // half the usual 100 ms per correct
      if (svHazard("heat")) t -= 100 * (g.correct - S.biomeStart);
      if (svHazard("storm")) t += 1000;
      if (svHazard("fog")) t += 1000;
      return t;
    },
    decorate: function (box) {
      if (svHazard("storm")) {
        var btns = box.querySelectorAll("button.choice");
        var b = btns[Math.floor(Math.random() * btns.length)];
        if (b) {
          b.classList.add("struck");
          gameAfter(2000, function () { b.classList.remove("struck"); }, true);
        }
      }
      if (svHazard("fog")) {
        var qEl = byId("game-question");
        qEl.classList.add("fogged-q");
        gameAfter(1000, function () { qEl.classList.remove("fogged-q"); }, true);
      }
    },
    ended: function (g) {
      if (g.clean || !g.survival) return;
      g.profile.best = Math.max(g.profile.best, g.correct);
    }
  };

