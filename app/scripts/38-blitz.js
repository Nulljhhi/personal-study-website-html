  /* ============================ Blitz: league, variants, themes ============================ */

  var BZ_TIERS = [
    { id: "bronze", name: "Bronze", rating: 850, wins: 2 }, { id: "silver", name: "Silver", rating: 950, wins: 3 },
    { id: "gold", name: "Gold", rating: 1050, wins: 3 }, { id: "platinum", name: "Platinum", rating: 1150, wins: 4 },
    { id: "diamond", name: "Diamond", rating: 1250, wins: 4 }, { id: "master", name: "Master", rating: 1350, wins: 0 }
  ];
  var BZ_VARIANTS = [
    { id: "league", name: "League match", secs: 60, key: null, desc: "60 seconds against three rivals at your league's level. Win to climb." },
    { id: "classic", name: "Classic", secs: 60, key: null, desc: "60 seconds. A miss costs 3 seconds." },
    { id: "sprint", name: "Sprint", secs: 30, key: "sprint", desc: "30 seconds, all out." },
    { id: "marathon", name: "Marathon", secs: 120, key: "marathon", desc: "120 seconds. Pace yourself." },
    { id: "sudden", name: "Sudden Death", secs: 90, key: "sudden", desc: "90 seconds, but one miss ends the round." },
    { id: "tfonly", name: "True/False only", secs: 60, key: "tfonly", desc: "60 seconds of True/False questions." }
  ];
  var BZ_THEMES = [
    { id: "plain", name: "Plain", tier: 0 }, { id: "silver", name: "Silver", tier: 1 }, { id: "gold", name: "Gold", tier: 2 },
    { id: "platinum", name: "Platinum", tier: 3 }, { id: "diamond", name: "Diamond", tier: 4 }, { id: "master", name: "Master", tier: 5 }
  ];
  function bzVariant(id) { for (var i = 0; i < BZ_VARIANTS.length; i++) if (BZ_VARIANTS[i].id === id) return BZ_VARIANTS[i]; return BZ_VARIANTS[1]; }

  function freshBlitzProfile() { return { tier: 0, wins: 0, bestTier: 0, masterWins: 0, theme: "plain", variant: "league" }; }
  function parseBlitzProfile(src) {
    var p = freshBlitzProfile();
    if (!src || typeof src !== "object") return p;
    var num = function (v, d) { return typeof v === "number" && isFinite(v) ? v : d; };
    p.tier = clamp(Math.floor(num(src.tier, 0)), 0, 5);
    p.wins = clamp(Math.floor(num(src.wins, 0)), 0, 10);
    p.bestTier = clamp(Math.max(p.tier, Math.floor(num(src.bestTier, 0))), 0, 5);
    p.masterWins = Math.max(0, Math.floor(num(src.masterWins, 0)));
    if (BZ_THEMES.some(function (t) { return t.id === src.theme && t.tier <= p.bestTier; })) p.theme = src.theme;
    if (BZ_VARIANTS.some(function (v) { return v.id === src.variant; })) p.variant = src.variant;
    return p;
  }
  function bzVariantOpen(v) { return !v.key || isUnlocked("blitz", v.key); }

  function bzFillSetup() {
    var p = state.gameData.blitz;
    var sel = byId("blitz-mode");
    sel.textContent = "";
    BZ_VARIANTS.forEach(function (v) {
      var o = document.createElement("option");
      var open = bzVariantOpen(v);
      o.value = v.id;
      o.textContent = v.id === "league" ? "League match (" + BZ_TIERS[p.tier].name + ")" : v.name + (open ? "" : " (level " + unlockLevelOf("blitz", v.key) + ")");
      o.disabled = !open;
      sel.appendChild(o);
    });
    sel.value = bzVariantOpen(bzVariant(p.variant)) ? p.variant : "league";
    var th = byId("blitz-theme");
    th.textContent = "";
    BZ_THEMES.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.name + (t.tier <= p.bestTier ? "" : " (reach " + BZ_TIERS[t.tier].name + ")");
      o.disabled = t.tier > p.bestTier;
      th.appendChild(o);
    });
    th.value = p.theme;
    bzSyncSetup();
  }
  function bzSyncSetup() {
    var p = state.gameData.blitz;
    var v = bzVariant(byId("blitz-mode").value);
    var tier = BZ_TIERS[p.tier];
    var info = v.desc;
    if (v.id === "league") info += " League: " + tier.name + (tier.wins ? ", " + p.wins + " of " + tier.wins + " wins to promote. Finishing 4th costs a win." : ", " + p.masterWins + " Master wins.");
    byId("blitz-info").textContent = info;
    byId("game-bots-row").classList.toggle("hidden", v.id === "league" || v.id === "sudden");
  }

  /* After a league round: move up or down the ladder. */
  function bzSettleLeague(g) {
    var p = g.profile;
    var place = g.standing ? g.standing.place
      : 1 + g.bots.filter(function (b) { return b.score > g.score; }).length;
    var tier = BZ_TIERS[p.tier];
    var note;
    if (place === 1) {
      if (!tier.wins) { p.masterWins++; note = "Master win #" + p.masterWins + "!"; }
      else {
        p.wins++;
        if (p.wins >= tier.wins) {
          p.tier++; p.wins = 0;
          p.bestTier = Math.max(p.bestTier, p.tier);
          note = "Promoted to " + BZ_TIERS[p.tier].name + "! New clock theme unlocked.";
          gameEvent("bzpromote", { value: p.tier });
        } else note = "Win! " + p.wins + " of " + tier.wins + " toward " + BZ_TIERS[p.tier + 1].name + ".";
      }
    } else if (place === 4 && p.wins > 0) { p.wins--; note = "Fourth place costs a win (" + p.wins + " of " + tier.wins + ")."; }
    else note = ordinal(place) + " place. " + (tier.wins ? p.wins + " of " + tier.wins + " wins toward " + BZ_TIERS[p.tier + 1].name + "." : "");
    g.leagueNote = BZ_TIERS[p.tier].name + " league · " + note;
    notify(g.leagueNote);
  }

  GAME_HOOKS.blitz = {
    keepBest: true,
    setupPanel: "game-blitz-options",
    setupOpened: function () { bzFillSetup(); },
    readSetup: function () { return { variant: byId("blitz-mode").value, theme: byId("blitz-theme").value }; },
    begin: function (g, setup) {
      var p = g.profile = state.gameData.blitz;
      var v = bzVariant(setup.extra && setup.extra.variant);
      if (!bzVariantOpen(v)) v = BZ_VARIANTS[0];
      p.variant = v.id;
      var theme = setup.extra && setup.extra.theme;
      if (BZ_THEMES.some(function (t) { return t.id === theme && t.tier <= p.bestTier; })) p.theme = theme;
      g.blitzVariant = v.id === "classic" ? null : v.id;
      g.league = v.id === "league";
      g.blitzTotal = v.secs;
      g.blitzLeft = v.secs * 1000;
      g.blitzTheme = p.theme;
      if (v.id === "tfonly") g.types = ["tf"];
      if (g.league) { g.botsOn = true; g.leagueBase = BZ_TIERS[p.tier].rating; }
      if (v.id === "sudden") g.botsOn = false; // bots can't play by sudden-death rules
    },
    quit: function (g) {
      // Walking out of a league match counts as finishing 4th.
      if (g.clean || !g.league || !g.answered) return;
      var p = g.profile, tier = BZ_TIERS[p.tier];
      if (tier.wins && p.wins > 0) { p.wins--; notify("Leaving a league match counts as 4th place (" + p.wins + " of " + tier.wins + " wins)."); }
    },
    resultTitle: function (g) { return g.suddenOut ? ": one miss and it's over!" : ": time's up!"; },
    quitHint: function (g) {
      return g.league && g.answered && !g.clean ? "Leaving a league match counts as finishing 4th, so it costs a win." : "This run won't count toward your best score or rating. Questions you already got right stay completed.";
    },
    ended: function (g) {
      if (g.clean) return;
      if (g.league && g.bots.length) bzSettleLeague(g);
    }
  };

