  /* ============================== Fishing shop ============================== */

  /* A rebuilt shop puts a fresh "buy next level" button under the cursor,
     so ignore purchase clicks for a moment after each purchase. */
  var lastPurchaseAt = -Infinity;
  function purchaseAllowed() {
    var now = performance.now();
    if (now - lastPurchaseAt < 450) return false;
    lastPurchaseAt = now;
    return true;
  }

  var shopTab = "rods";
  var shopProfile = null;
  var shopFromGame = false;

  function openFishingShop(fromGame) {
    shopFromGame = !!fromGame;
    shopProfile = fromGame && game ? game.profile : state.gameData.fishing;
    if (fromGame && game && !game.over) setGamePausedQuiet(true);
    renderFishingShop();
    byId("fish-shop-modal").classList.remove("hidden");
    byId("fish-shop-close-btn").focus();
  }

  function closeFishingShop() {
    byId("fish-shop-modal").classList.add("hidden");
    if (shopFromGame && game && !game.over) {
      setGamePausedQuiet(false);
      if (game.fish.phase === "idle") renderFishingArena();
      renderGameHud();
    } else {
      updateGameSetup();
    }
  }

  function saveShop() {
    if (!(shopFromGame && game && game.clean)) persistCompleted();
  }

  function renderFishingShop() {
    var p = shopProfile;
    byId("fish-shop-coins").textContent = fmtScore(p.coins) + " coins" + (shopFromGame && game && game.clean ? " (clean run)" : "");
    document.querySelectorAll("#fish-shop-tabs button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === shopTab);
      b.setAttribute("aria-selected", String(b.dataset.tab === shopTab));
    });
    var list = byId("fish-shop-list");
    list.textContent = "";
    var midCatch = shopFromGame && game && game.fish && game.fish.phase !== "idle";
    if (shopTab === "rods") {
      FISH_RODS.forEach(function (rod) {
        var owned = !!p.rods[rod.id];
        var equipped = p.rod === rod.id;
        var label = equipped ? "Equipped" : owned ? "Equip" : "Buy " + fmtScore(rod.price);
        var ok = equipped ? false : owned ? !midCatch : p.coins >= rod.price;
        if (!owned && midCatch) label = "Buy " + fmtScore(rod.price) + " (equip after this fish)";
        list.appendChild(shopCard(rod.name, rod.perk + (rod.time ? " +" + rod.time / 1000 + "s before fish escape." : ""),
          owned ? "Owned" : fmtScore(rod.price) + " coins", label, ok, function () {
            if (!purchaseAllowed()) return;
            if (!owned) { p.coins -= rod.price; p.rods[rod.id] = true; notify("Bought the " + rod.name + "."); }
            if (!midCatch) p.rod = rod.id; // never switch rods while a fish is on the line
            saveShop();
            renderFishingShop();
          }, equipped ? "equipped" : ""));
      });
    } else if (shopTab === "stats") {
      FISH_STATS.forEach(function (st) {
        var level = p.stats[st.id];
        var price = statPrice(st.base, level);
        list.appendChild(shopCard(st.name, st.desc, "Level " + level + " / " + STAT_MAX,
          level >= STAT_MAX ? "Maxed" : "Upgrade " + fmtScore(price), level < STAT_MAX && p.coins >= price, function () {
            if (!purchaseAllowed() || p.coins < price || p.stats[st.id] >= STAT_MAX) return;
            p.coins -= price;
            p.stats[st.id]++;
            notify(st.name + " upgraded to level " + p.stats[st.id] + ".");
            saveShop();
            renderFishingShop();
          }));
      });
    } else if (shopTab === "locations") {
      FISH_LOCATIONS.forEach(function (loc) {
        var owned = !!p.locations[loc.id];
        var here = p.location === loc.id;
        var label = here ? "Fishing here" : owned ? "Go here" : "Unlock " + fmtScore(loc.price);
        var ok = here ? false : owned ? !midCatch : p.coins >= loc.price;
        if (!owned && midCatch) label = "Unlock " + fmtScore(loc.price) + " (go after this fish)";
        var values = FISH_BASE_VALUE.common * loc.mult + "–" + FISH_BASE_VALUE.legendary * loc.mult;
        list.appendChild(shopCard(loc.name, "Fish worth " + values + " coins each (×" + loc.mult + ").",
          owned ? "Unlocked" : fmtScore(loc.price) + " coins", label, ok, function () {
            if (!purchaseAllowed()) return;
            if (!owned) { p.coins -= loc.price; p.locations[loc.id] = true; notify("Unlocked the " + loc.name + "."); }
            if (!midCatch) p.location = loc.id; // never move while a fish is on the line
            saveShop();
            renderFishingShop();
          }, here ? "equipped" : ""));
      });
    } else if (shopTab === "bounty") {
      var head = document.createElement("p");
      head.className = "camp-codex-head";
      head.textContent = "Today's bounty board. New requests every day.";
      list.appendChild(head);
      fishBounties(p).forEach(function (b) {
        var f = fishSpeciesByKey(b.key);
        list.appendChild(shopCard((b.done ? "✓ " : "") + f.sp[1], "Catch " + b.n + " at the " + f.loc.name + (f.sp[4] ? " (" + fishCondText(f.sp[4]) + ")" : "") + ".",
          b.got + " / " + b.n + " caught", b.done ? "Paid " + fmtScore(b.reward) : "Reward " + fmtScore(b.reward), false, function () {}, b.done ? "equipped" : ""));
      });
    } else if (shopTab === "aquarium") {
      var tank = document.createElement("div");
      tank.className = "fish-tank";
      var shown = [];
      FISH_LOCATIONS.forEach(function (loc) { loc.species.forEach(function (sp) { if (p.caught[loc.id + ":" + sp[0]]) shown.push(sp); }); });
      var order = { legendary: 0, rare: 1, common: 2 };
      shown.sort(function (a, b) { return order[a[2]] - order[b[2]]; });
      if (!shown.length) tank.innerHTML = '<p class="fish-tank-empty">Your aquarium is empty. Every species you catch swims here.</p>';
      shown.slice(0, 18).forEach(function (sp, i) {
        var f = document.createElement("div");
        f.className = "tank-fish";
        f.style.top = (8 + (i * 37) % 78) + "%";
        f.style.animationDuration = (9 + (i * 7) % 9) + "s";
        f.style.animationDelay = (-i * 1.3) + "s";
        f.title = sp[1];
        f.innerHTML = fishSvg(sp[3], sp[2], sp[2] === "legendary" ? 110 : sp[2] === "rare" ? 90 : 70);
        tank.appendChild(f);
      });
      list.appendChild(tank);
      var cap = document.createElement("p");
      cap.className = "camp-codex-head";
      cap.textContent = shown.length + " species in your aquarium" + (shown.length > 18 ? " (showing the 18 rarest)" : "") + ".";
      list.appendChild(cap);
    } else {
      FISH_LOCATIONS.forEach(function (loc) {
        var section = document.createElement("div");
        section.className = "fish-log-section";
        var h = document.createElement("h3");
        h.textContent = loc.name + (p.locations[loc.id] ? "" : " (locked)");
        section.appendChild(h);
        var row = document.createElement("div");
        row.className = "fish-log-row";
        loc.species.forEach(function (sp) {
          var n = p.caught[loc.id + ":" + sp[0]] || 0;
          var cell = document.createElement("div");
          cell.className = "fish-log-cell " + sp[2] + (n ? "" : " unknown");
          cell.innerHTML = fishSvg(n ? sp[3] : 0, n ? sp[2] : "common", 110);
          var name = document.createElement("span");
          name.textContent = n ? sp[1] + " ×" + n : "???" + (sp[4] ? " (" + fishCondText(sp[4]) + ")" : "");
          var r = document.createElement("span");
          r.className = "fish-log-rarity";
          r.textContent = sp[2] + " · " + speciesValue(loc, sp) + " coins";
          cell.appendChild(name);
          cell.appendChild(r);
          row.appendChild(cell);
        });
        section.appendChild(row);
        list.appendChild(section);
      });
    }
  }

