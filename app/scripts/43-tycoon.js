  /* ============================== Tycoon ==============================
     Days of orders (each a question). Mid-day power-ups apply to the NEXT
     order, so a bet is placed before the question is seen. Between days:
     upgrades (per warehouse), staff, warehouses, contracts. */

  var TY_LINES = [
    { id: "general", name: "General goods", key: null, value: 1, penalty: 1, weight: 4, items: TYCOON_ITEMS },
    { id: "electronics", name: "Electronics", key: "electronics", value: 1.5, penalty: 1.3, weight: 2,
      items: ["boxes of laptops", "pallets of monitors", "cases of headphones", "cartons of routers", "crates of tablets"] },
    { id: "furniture", name: "Furniture", key: "furniture", value: 2, penalty: 1.2, weight: 2,
      items: ["sets of office chairs", "flat-packed desks", "sofas", "dining tables", "bookshelves"] },
    { id: "hazmat", name: "Hazardous goods", key: "hazmat", value: 3, penalty: 2, weight: 1.5,
      items: ["drums of solvent", "cylinders of propane", "cases of lithium batteries", "totes of pool chemicals"] }
  ];
  var TY_WAREHOUSES = [
    { id: "main", name: "Main warehouse", price: 0, key: null, value: 1, overhead: 1 },
    { id: "wh2", name: "Riverside", price: 8000, key: "wh2", value: 1.6, overhead: 1.5 },
    { id: "wh3", name: "Summit Hub", price: 30000, key: "wh3", value: 2.5, overhead: 2.2 }
  ];
  var TY_STAFF = [
    { id: "picker", name: "Picker", key: "picker", wage: 40, desc: "+2 s thinking time on every order." },
    { id: "driver", name: "Driver", key: "driver", wage: 60, desc: "Late penalties are halved." },
    { id: "manager", name: "Manager", key: "manager", wage: 90, desc: "+10% revenue and +25% contract bonuses." }
  ];
  var TY_EVENTS = [
    { id: "delay", name: "Supply delay", desc: "The day is 15 seconds shorter, but every order is worth 20% more.", time: -15000, value: 1.2 },
    { id: "rush", name: "Holiday rush", desc: "The day runs 20 seconds longer, with 1 second less thinking time.", time: 20000, think: -1000 },
    { id: "inspection", name: "Surprise inspection", desc: "Penalties doubled today. A day with no returns or late orders earns $150.", penalty: 2, cleanBonus: 150 },
    { id: "bigclient", name: "Big client", desc: "One order today is worth 4×.", big: 4 },
    { id: "heat", name: "Heat wave", desc: "Overhead is $50 higher tonight.", overhead: 50 }
  ];
  var TY_POWERUPS = [
    { id: "crate2", name: "×2 crate", mult: 2 },
    { id: "crate5", name: "×5 crate", mult: 5 },
    { id: "crate10", name: "×10 crate", mult: 10 },
    { id: "crate25", name: "×25 crate", mult: 25 },
    { id: "crate50", name: "×50 crate", mult: 50 },
    { id: "overtime", name: "Overtime", desc: "+5 s thinking time" },
    { id: "inspector", name: "Inspector", desc: "Removes two wrong answers" },
    { id: "guard", name: "Streak guard", desc: "A miss won't reset your combo" },
    { id: "insurance", name: "Insurance", desc: "A miss costs nothing (covers the multiplier stacked when you buy it)" },
    { id: "express", name: "Express skip", desc: "Skip the current order, no penalty" }
  ];
  var TY_MILESTONES = [[1000, 100], [5000, 200], [10000, 300], [25000, 500], [100000, 1000], [1000000, 1500], [10000000, 2000]];

  /* Multiplier crates appear as the warehouse ages, and each can be bought
     once per week (days 1-7, 8-14, ...). They still stack by multiplying. */
  var TY_CRATE_DAY = { crate2: 5, crate5: 7, crate10: 10, crate25: 15, crate50: 20 };
  function tyWeek(day) { return Math.floor((day - 1) / 7); }
  function tyCrateBought(p, id) { return !!(p.crateWeek && p.crateWeek.week === tyWeek(p.day) && p.crateWeek.bought[id]); }
  function freshBoost() { return { mult: 1, crates: 0, crateIds: {}, overtime: false, inspector: false, guard: false, insurance: 0 }; }
  function tyWarehouse(p) { for (var i = 0; i < TY_WAREHOUSES.length; i++) if (TY_WAREHOUSES[i].id === p.wh) return TY_WAREHOUSES[i]; return TY_WAREHOUSES[0]; }
  function tyStaffWages(p) { return TY_STAFF.reduce(function (s, st) { return s + (p.staff[st.id] ? st.wage : 0); }, 0); }
  function tyBaseValue(p, day) {
    return Math.round((40 + 8 * day) * (1 + 0.2 * p.upgrades.marketing) * tyWarehouse(p).value);
  }
  function tyOvernight(p, day, ev) {
    return Math.round(tycoonOverhead(day) * tyWarehouse(p).overhead) + tyStaffWages(p) + (ev && ev.overhead || 0);
  }
  /* What an order is expected to pay right now: base value with trucks,
     the current streak bonus, the manager and today's modifier, plus a
     premium for pricier product lines and events. Crates are priced off
     this, so a big streak or a fleet of trucks makes them dearer too. */
  function tyExpectedValue(p) {
    var g = game;
    // Crates bought while a question is open apply to the order after it,
    // which pays at a streak two answers longer than now.
    var open = g.current && !g.locked && !byId("game-question-pane").classList.contains("hidden");
    return tyBaseValue(p, p.day) * tyTrucks(p) * tycoonMultiplier(g.combo + (open ? 2 : 1)) * (p.staff.manager ? 1.1 : 1) * (g.rewardMult || 1) * 1.4;
  }
  function tyPowerupPrice(id, p, pending) {
    var pu = TY_POWERUPS.filter(function (x) { return x.id === id; })[0];
    // A crate costs half of the extra revenue it adds on top of what's already stacked.
    if (pu.mult) return Math.round(0.5 * (pu.mult - 1) * pending.mult * tyExpectedValue(p));
    var v = tyBaseValue(p, p.day) * tyTrucks(p);
    if (id === "insurance") return Math.max(Math.round(0.2 * v), Math.round(0.6 * 0.3 * tyExpectedValue(p) * pending.mult));
    return Math.round(v * ({ overtime: 0.4, inspector: 0.6, guard: 0.5, express: 0.3 })[id]);
  }
  /* The return/late penalty grows with everything that grows the revenue. */
  function tyPenaltyScale(p, boost, combo) {
    var qc = boost.mult > 1 ? 1 : 1 - 0.1 * p.upgrades.qc; // QC doesn't shrink a crate's stake
    return tyTrucks(p) * tycoonMultiplier(combo) * boost.mult * qc * (game.ty.event && game.ty.event.penalty || 1);
  }

  /* Timer hooks used by gameThinkingMs / questionTimeLimit. */
  function tycoonThinkAdjust() {
    var g = game;
    var a = g.ty && g.ty.active || freshBoost();
    var think = -1000 * a.crates + (g.ty && g.ty.event && g.ty.event.think || 0);
    var bonus = (a.overtime ? 5000 : 0) + (g.profile.staff && g.profile.staff.picker ? 2000 : 0);
    return { think: think, bonus: bonus, minThink: a.crates ? 1000 : MIN_THINK_MS };
  }
  function tycoonReadingCut() {
    var a = game.ty && game.ty.active;
    if (!a || a.crates <= 3) return 1;
    return Math.max(0.4, 1 - 0.05 * (a.crates - 3));
  }

  function startTycoonDay(first) {
    var g = game;
    var p = g.profile;
    g.ty.pending = g.ty.pending || freshBoost();
    g.ty.active = freshBoost();
    // Random event (from day 2).
    g.ty.event = p.day >= 2 && Math.random() < 0.4 ? TY_EVENTS[Math.floor(Math.random() * TY_EVENTS.length)] : null;
    g.ty.dayTotal = Math.max(30000, tyDayMs(p) + (g.ty.event && g.ty.event.time || 0));
    g.ty.dayLeft = g.ty.dayTotal;
    g.ty.bigUsed = false;
    g.ty.dayRevenue = 0;
    g.ty.dayPenalties = 0;
    g.ty.dayShipped = 0;
    g.ty.dayReturned = 0;
    g.ty.dayLate = 0;
    g.ty.dayAnswered = 0;
    g.ty.dayCorrect = 0;
    g.ty.dayContract = null;
    g.ty.order = null;
    g.ty.dayOpen = true;
    if (g.ty.event) notify("Today: " + g.ty.event.name + ". " + g.ty.event.desc);
    if (!first) {
      showScreen("game");
      renderArena(true);
      nextGameQuestion();
      renderGameHud();
      if (g.botsOn) g.bots.forEach(function (b) { b.dayOrders = Infinity; b.next = g.botClock + botThink(b); });
      renderBoard();
      g.lastFrame = performance.now();
    }
  }

  function newOrder() {
    var g = game;
    var p = g.profile;
    var lines = TY_LINES.filter(function (l) { return !l.key || isUnlocked("tycoon", l.key); });
    var total = lines.reduce(function (s, l) { return s + l.weight; }, 0);
    var r = Math.random() * total, line = lines[0];
    for (var i = 0; i < lines.length; i++) { r -= lines[i].weight; if (r <= 0) { line = lines[i]; break; } }
    // The big client turns up once, somewhere in the day.
    var big = 1;
    if (g.ty.event && g.ty.event.big && !g.ty.bigUsed && (Math.random() < 0.25 || g.ty.dayLeft < g.ty.dayTotal * 0.35)) { big = g.ty.event.big; g.ty.bigUsed = true; }
    var evValue = g.ty.event && g.ty.event.value || 1;
    g.ty.active = g.ty.pending || freshBoost();
    g.ty.pending = freshBoost();
    g.ty.order = {
      customer: TYCOON_CUSTOMERS[Math.floor(Math.random() * TYCOON_CUSTOMERS.length)],
      item: line.items[Math.floor(Math.random() * line.items.length)],
      line: line, big: big,
      value: Math.round(tyBaseValue(p, p.day) * line.value * evValue * big * (0.85 + Math.random() * 0.3))
    };
  }

  /* Share of a miss still paid: insurance covers the multiplier it was bought at. */
  function tyInsuredShare(boost) { return boost.insurance ? Math.max(0, 1 - boost.insurance / boost.mult) : 1; }

  function tyStakes(order, boost) {
    var p = game.profile;
    // What a correct answer would pay right now (the combo grows by one first).
    var win = Math.round(order.value * tycoonMultiplier(game.combo + 1) * boost.mult * tyTrucks(p) * (p.staff.manager ? 1.1 : 1) * game.rewardMult);
    var lose = Math.round(tyInsuredShare(boost) * order.value * 0.3 * order.line.penalty * tyPenaltyScale(p, boost, game.combo));
    return { win: win, lose: lose };
  }

  function renderTycoonArena() {
    var g = game;
    var p = g.profile;
    if (!g.ty.order) newOrder();
    var o = g.ty.order;
    var arena = byId("game-arena");
    arena.innerHTML =
      '<p class="arena-name"><span id="ty-wh"></span> · Day <span id="ty-day"></span></p><p class="arena-sub" id="ty-sub"></p>' +
      '<div class="ty-order"><span class="arena-caption" id="ty-line"></span><strong id="ty-customer"></strong>' +
      '<span id="ty-item"></span><span class="ty-value" id="ty-value"></span><span class="ty-stakes" id="ty-stakes"></span></div>' +
      '<div class="ty-clock"><span class="arena-caption">Day ends in</span><strong id="ty-clock"></strong><div class="ty-clock-track"><div id="ty-clock-bar"></div></div></div>' +
      '<div class="ty-pu"><p class="board-title">Power-ups for the next order</p><div id="ty-pu-list" class="ty-pu-list"></div></div>';
    byId("ty-wh").textContent = tyWarehouse(p).name;
    byId("ty-day").textContent = String(p.day);
    var sub = [];
    if (g.clean) sub.push("Clean run");
    if (g.ty.event) sub.push(g.ty.event.name);
    if (p.contract) sub.push("Contract: " + tyContractShipped(g, p.contract) + "/" + p.contract.target + " shipped, " + p.contract.daysLeft + (p.contract.daysLeft === 1 ? " day" : " days") + " left");
    sub.push("Overhead tonight: " + fmtMoney(tyOvernight(p, p.day, g.ty.event)));
    byId("ty-sub").textContent = sub.join(" · ");
    byId("ty-line").textContent = o.line.name + (o.big > 1 ? " · BIG CLIENT ×" + o.big : "");
    byId("ty-customer").textContent = o.customer;
    byId("ty-item").textContent = o.item;
    byId("ty-value").textContent = fmtMoney(o.value);
    var a = g.ty.active;
    var st = tyStakes(o, a);
    byId("ty-stakes").textContent = (a.mult > 1 ? "×" + fmtScore(a.mult) + " active: " : "") + "win " + fmtMoney(st.win) + " · lose " + fmtMoney(st.lose) +
      (a.insurance ? (a.insurance >= a.mult ? " (insured)" : " (partly insured)") : "") + (a.guard ? " · streak guarded" : "");
    tyRenderClock();
    renderTycoonPowerups();
  }

  function tyRenderClock() {
    var g = game, el = byId("ty-clock");
    if (!el || !g.ty) return;
    var txt = g.ty.dayLeft > 0 ? fmtClock(g.ty.dayLeft) : "Last order!";
    if (el.textContent !== txt) el.textContent = txt;
    byId("ty-clock-bar").style.width = (100 * g.ty.dayLeft / g.ty.dayTotal) + "%";
    var hud = byId("ty-hud-clock");
    if (hud) { var t2 = g.ty.dayLeft > 0 ? fmtClock(g.ty.dayLeft) : "0:00"; if (hud.textContent !== t2) hud.textContent = t2; }
  }

  function renderTycoonPowerups() {
    var g = game;
    var p = g.profile;
    var list = byId("ty-pu-list");
    if (!list) return;
    list.textContent = "";
    var pend = g.ty.pending;
    TY_POWERUPS.forEach(function (pu) {
      if (pu.mult) {
        if (p.day < TY_CRATE_DAY[pu.id]) return;
      } else if (!isUnlocked("tycoon", pu.id)) return;
      if (pu.id === "inspector" && g.types.indexOf("mc") === -1) return; // nothing to remove on True/False
      var price = tyPowerupPrice(pu.id, p, pend);
      var owned = (!pu.mult && pu.id !== "express" && pend[pu.id]) || (pu.mult && tyCrateBought(p, pu.id));
      // Highlighted from when it's bought for the next order until that
      // order is answered (it's "in effect" while that order is up).
      var active = pu.mult ? !!(pend.crateIds && pend.crateIds[pu.id]) : owned;
      var now = g.ty.active || {};
      var inEffect = pu.id !== "express" && !active && (pu.mult ? !!(now.crateIds && now.crateIds[pu.id]) : !!now[pu.id]);
      var btn = document.createElement("button");
      btn.type = "button";
      if (active || inEffect) btn.classList.add("ty-pu-active");
      btn.textContent = pu.name + " " + (active ? "✓" : inEffect ? (pu.mult ? "in effect" : "in effect · " + fmtMoney(price)) : pu.mult && owned ? "used this week" : fmtMoney(price));
      btn.title = pu.desc || "Multiplies the next order's revenue and its penalty";
      var midQuestion = !g.locked && g.current && !byId("game-question-pane").classList.contains("hidden");
      var lastOrder = pu.id !== "express" && g.ty.dayLeft < 10000;
      btn.disabled = owned || p.money < price || (pu.id === "express" && !midQuestion) || g.paused || lastOrder;
      if (lastOrder) btn.title = "Power-ups apply to the next order, and the day is about to end.";
      if (active) btn.title = "Active for the next order.";
      else if (inEffect) btn.title = pu.mult ? "Multiplying this order." : "Working on this order. Buying it again sets it up for the next one too.";
      else if (pu.mult && owned) btn.title = "One of each crate per week. More next week (day " + (tyWeek(p.day) * 7 + 8) + ").";
      btn.addEventListener("click", function () { buyTycoonPowerup(pu.id); });
      list.appendChild(btn);
    });
  }

  function buyTycoonPowerup(id) {
    var g = game;
    if (!g || g.over || g.id !== "tycoon" || g.paused || !purchaseAllowed()) return;
    var p = g.profile;
    var pend = g.ty.pending;
    var price = tyPowerupPrice(id, p, pend);
    if (p.money < price) return;
    var pu = TY_POWERUPS.filter(function (x) { return x.id === id; })[0];
    if (id !== "express" && g.ty.dayLeft < 10000) return;
    if (pu.mult && (p.day < TY_CRATE_DAY[id] || tyCrateBought(p, id))) return;
    if (id === "inspector" && g.types.indexOf("mc") === -1) return;
    if (id === "express") {
      if (g.locked || !g.current || byId("game-question-pane").classList.contains("hidden")) return;
      p.money -= price;
      g.locked = true;
      byId("game-choices").classList.add("locked");
      var fb = byId("game-feedback");
      fb.classList.remove("wrong");
      fb.classList.add("right");
      fb.textContent = "Skipped with Express. No revenue, no penalty.";
      renderGameHud();
      gameAfter(900, function () { afterGameFeedback(false); });
    } else {
      if (!pu.mult && pend[id]) return;
      p.money -= price;
      if (pu.mult) {
        pend.mult *= pu.mult; pend.crates++;
        pend.crateIds = pend.crateIds || {}; pend.crateIds[pu.id] = true;
        if (!p.crateWeek || p.crateWeek.week !== tyWeek(p.day)) p.crateWeek = { week: tyWeek(p.day), bought: {} };
        p.crateWeek.bought[id] = true;
      }
      else pend[id] = id === "insurance" ? pend.mult : true;
    }
    if (!g.clean) persistCompleted();
    renderTycoonPowerups();
    renderGameHud();
  }

  function tycoonMultiplier(combo) {
    var base = comboMultiplier(combo);
    return 1 + (base - 1) * (1 + 0.25 * game.profile.upgrades.forklifts);
  }

  /* Today's contract progress, kept apart until the day closes. */
  function tyDayContract(g) {
    var c = g.profile.contract;
    if (!g.ty.dayContract || g.ty.dayContract.contract !== c) g.ty.dayContract = { contract: c, shipped: 0, answered: 0, correct: 0 };
    return g.ty.dayContract;
  }
  function tyContractShipped(g, c) {
    var dc = g.ty && g.ty.dayContract;
    return c.shipped + (dc && dc.contract === c ? dc.shipped : 0);
  }

  function endTycoonDay() {
    var g = game;
    var p = g.profile;
    var ev = g.ty.event;
    var overhead = tyOvernight(p, p.day, ev);
    var bonus = 0, notes = [];
    if (ev && ev.cleanBonus && g.ty.dayReturned === 0 && g.ty.dayLate === 0) { bonus += ev.cleanBonus; notes.push("Inspection passed: +" + fmtMoney(ev.cleanBonus)); }
    // Contract progress.
    var c = p.contract;
    if (c) {
      var dc = g.ty.dayContract;
      if (dc && dc.contract === c) { c.shipped += dc.shipped; c.answered += dc.answered; c.correct += dc.correct; }
      g.ty.dayContract = null;
      c.daysLeft--;
      var acc = c.answered ? 100 * c.correct / c.answered : 0;
      if (c.shipped >= c.target && acc >= c.minAcc) {
        var cb = Math.round(c.bonus * (p.staff.manager ? 1.25 : 1));
        bonus += cb;
        notes.push("Contract with " + c.customer + " completed: +" + fmtMoney(cb));
        p.contract = null;
        p.contractsDone = (p.contractsDone || 0) + 1;
      } else if (c.daysLeft <= 0) {
        notes.push("Contract with " + c.customer + " expired (" + c.shipped + "/" + c.target + " shipped" + (c.answered ? ", " + Math.round(acc) + "% accuracy" : "") + ").");
        p.contract = null;
      }
    }
    var profit = g.ty.dayRevenue - g.ty.dayPenalties - overhead + bonus;
    g.ty.dayOpen = false;
    p.money += profit;
    p.totalProfit += profit;
    g.ty.sessionProfit += profit;
    g.ty.daysRun++;
    g.score = g.ty.sessionProfit;
    // Rivals pay the base overnight cost: they don't have your warehouse or staff.
    var rivalOverhead = tycoonOverhead(p.day);
    if (g.botsOn) g.bots.forEach(function (b) {
      var cost = b.rival ? rivalOverhead : overhead;
      b.score -= cost;
      b.dayProfit -= cost;
      // Rivals bank the day's profit and spend it on their own upgrades.
      if (b.rival && !g.clean) { b.rival.wallet = Math.max(0, b.rival.wallet + b.dayProfit); rivalShopTycoon(b.rival); }
      b.dayProfit = 0;
    });
    var finishedDay = p.day;
    if (g.ty.dayReturned === 0 && g.ty.dayLate === 0) gameEvent("cleanday");
    p.day++;
    // Money milestones.
    p.milestones = p.milestones || {};
    TY_MILESTONES.forEach(function (m) {
      if (p.money >= m[0] && !p.milestones[m[0]]) {
        p.milestones[m[0]] = true;
        notes.push("Milestone: " + fmtMoney(m[0]) + " in the bank (+" + m[1] + " XP)");
        addXp(m[1], true);
      }
    });
    notes.forEach(function (n) { notify(n); });
    if (!g.clean) { checkAchievements("tycoon"); persistCompleted(); }
    g.locked = true;
    g.current = null;
    g.ty.offer = null;
    renderTycoonDay(finishedDay, overhead, profit, bonus);
    showScreen("tycoon-day");
  }

  function renderTycoonDay(day, overhead, profit, bonus) {
    var g = game;
    var p = g.profile;
    byId("ty-day-title").textContent = tyWarehouse(p).name + ": day " + day + " closed";
    var rows = [
      ["Orders shipped", g.ty.dayShipped + " of " + g.ty.dayAnswered],
      ["Revenue", fmtMoney(g.ty.dayRevenue)],
      ["Returns & late", g.ty.dayPenalties ? "-" + fmtMoney(g.ty.dayPenalties) : "$0"],
      ["Overhead & wages", "-" + fmtMoney(overhead)],
      ["Bonuses", fmtMoney(bonus || 0)],
      ["Profit", fmtMoney(profit)],
      ["Bank", fmtMoney(p.money)]
    ];
    var box = byId("ty-day-stats");
    box.textContent = "";
    rows.forEach(function (r) {
      var el = document.createElement("div");
      el.className = "stat-box";
      var l = document.createElement("span");
      l.className = "stat-label";
      l.textContent = r[0];
      var v = document.createElement("strong");
      v.textContent = r[1];
      if (r[0] === "Profit") v.className = profit >= 0 ? "pos" : "neg";
      if (r[0] === "Bank") v.id = "ty-bank-value";
      el.appendChild(l);
      el.appendChild(v);
      box.appendChild(el);
    });
    renderTycoonShop();
    byId("ty-next-btn").textContent = "Start day " + p.day;
    var board = byId("ty-day-board");
    board.classList.toggle("hidden", !g.botsOn);
    if (g.botsOn) renderBoard(board, "Session profit");
  }

  function tyRefreshBank() {
    var el = byId("ty-bank-value");
    if (el) el.textContent = fmtMoney(game.profile.money);
  }

  function renderTycoonShop() {
    var g = game;
    var p = g.profile;
    var list = byId("ty-shop");
    list.textContent = "";
    var save = function () { if (!g.clean) persistCompleted(); tyRefreshBank(); renderTycoonShop(); };
    var section = function (title) {
      var h = document.createElement("h3");
      h.className = "shop-section";
      h.textContent = title;
      list.appendChild(h);
    };
    section("Upgrades · " + tyWarehouse(p).name);
    TYCOON_UPGRADES.forEach(function (up) {
      var level = p.upgrades[up.id];
      var price = Math.round(tycoonUpgradePrice(up, level) * tyWarehouse(p).value);
      var meta = "Level " + level + " / " + TY_UP_MAX + (up.id === "trucks" ? " · now ×" + TY_TRUCKS[level] + (level < TY_UP_MAX ? ", next ×" + TY_TRUCKS[level + 1] : "") : "");
      list.appendChild(shopCard(up.name, up.desc, meta,
        level >= TY_UP_MAX ? "Maxed" : "Buy " + fmtMoney(price), level < TY_UP_MAX && p.money >= price,
        function () {
          if (!purchaseAllowed() || p.money < price || p.upgrades[up.id] >= TY_UP_MAX) return;
          p.upgrades[up.id]++;
          p.money -= price;
          notify(up.name + " upgraded to level " + p.upgrades[up.id] + ".");
          save();
        }));
    });

    section("Staff (wages are paid each night)");
    TY_STAFF.forEach(function (st) {
      var open = isUnlocked("tycoon", st.key);
      var hired = !!p.staff[st.id];
      list.appendChild(shopCard(st.name, st.desc, open ? fmtMoney(st.wage) + " a day" : "Unlocks at level " + unlockLevelOf("tycoon", st.key),
        !open ? "Locked" : hired ? "Let go" : "Hire", open, function () {
          if (!purchaseAllowed()) return;
          p.staff[st.id] = !hired;
          notify(hired ? st.name + " let go." : st.name + " hired.");
          save();
        }, hired ? "equipped" : ""));
    });

    section("Warehouses");
    TY_WAREHOUSES.forEach(function (w) {
      var owned = w.id === "main" || !!(p.warehouses[w.id] && p.warehouses[w.id].owned);
      var open = !w.key || isUnlocked("tycoon", w.key);
      var here = p.wh === w.id;
      var desc = "Orders worth ×" + w.value + ", overhead ×" + w.overhead + ". Each warehouse has its own upgrades.";
      var label = here ? "Running" : owned ? "Run here next" : !open ? "Locked" : "Buy " + fmtMoney(w.price);
      list.appendChild(shopCard(w.name, desc, owned ? "Owned" : open ? fmtMoney(w.price) : "Unlocks at level " + unlockLevelOf("tycoon", w.key),
        label, !here && (owned || (open && p.money >= w.price)), function () {
          if (!purchaseAllowed()) return;
          if (!owned) {
            if (p.money < w.price) return;
            p.money -= w.price;
            p.warehouses[w.id] = { owned: true, upgrades: tyFreshUps() };
            notify("Bought " + w.name + "!");
          }
          p.wh = w.id;
          p.upgrades = p.warehouses[w.id].upgrades;
          save();
          if (!g.clean) checkAchievements("tycoon");
        }, here ? "equipped" : ""));
    });

    if (isUnlocked("tycoon", "contracts")) {
      section("Contracts");
      if (p.contract) {
        var c = p.contract;
        list.appendChild(shopCard(c.customer, "Ship " + c.target + " orders within " + c.days + " days with at least " + c.minAcc + "% accuracy.",
          tyContractShipped(g, c) + "/" + c.target + " shipped · " + c.daysLeft + " days left · bonus " + fmtMoney(c.bonus), "In progress", false, function () {}, "equipped"));
      } else {
        if (!g.ty.offer) {
          var target = 8 + Math.floor(Math.random() * 9);
          var days = 2 + Math.floor(Math.random() * 2);
          g.ty.offer = { customer: TYCOON_CUSTOMERS[Math.floor(Math.random() * TYCOON_CUSTOMERS.length)], target: target, days: days,
            daysLeft: days, minAcc: 80, bonus: Math.round(target * tyBaseValue(p, p.day) * 0.5), shipped: 0, answered: 0, correct: 0 };
        }
        var o = g.ty.offer;
        list.appendChild(shopCard(o.customer, "Ship " + o.target + " orders within " + o.days + " days with at least " + o.minAcc + "% accuracy.",
          "Bonus " + fmtMoney(o.bonus) + (p.staff.manager ? " (+25% with your manager)" : ""), "Accept", true, function () {
            if (!purchaseAllowed()) return;
            p.contract = o;
            g.ty.offer = null;
            notify("Contract accepted with " + o.customer + ".");
            save();
          }));
      }
    }
  }

  function shopCard(title, desc, meta, actionLabel, enabled, onBuy, extraClass) {
    var card = document.createElement("div");
    card.className = "shop-card" + (extraClass ? " " + extraClass : "");
    var t = document.createElement("strong");
    t.textContent = title;
    var d = document.createElement("p");
    d.textContent = desc;
    var m = document.createElement("span");
    m.className = "shop-meta";
    m.textContent = meta;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = actionLabel;
    btn.disabled = !enabled;
    if (enabled) btn.classList.add("primary");
    btn.addEventListener("click", onBuy);
    card.appendChild(t);
    card.appendChild(d);
    card.appendChild(m);
    card.appendChild(btn);
    return card;
  }

