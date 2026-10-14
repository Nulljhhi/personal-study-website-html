  /* ============================== Bots ==============================
     Three rivals are set around the player's rating (one stronger, one
     even, one weaker). A rating maps to accuracy and thinking time; each
     bot "answers" on the game clock under the same rules and scoring as
     the player. Ratings move Elo-style after each finished run. */

  var BOT_NAMES = ["Riley", "Sam", "Jordan", "Casey", "Morgan", "Avery", "Quinn", "Taylor", "Rowan", "Jamie"];
  var BOT_COMPANY = [" Logistics", " Supply Co.", " Freight", " Distribution"];

  function botProfile(rating) {
    return {
      acc: clamp(0.7 + (rating - 1000) / 1000, 0.35, 0.97),
      think: clamp(4000 - (rating - 1000) * 6, 1200, 8000),
      readFactor: clamp(1.1 - (rating - 1000) / 1000, 0.6, 1.4)
    };
  }


  /* ================================ Rivals ================================
     The three bots in Boss Battle, Survival, Blitz, Fishing and Tycoon are
     persistent rivals, saved per bank and per game. Each keeps its own
     name, level (XP from its own answers), gear and bonuses, earned and
     bought the same way yours are:
       Boss Battle  campaign gear, unlocked by how far the rival has fought
       Survival     a perk, unlocked by the rival's own best run
       Fishing      its own rod and stat upgrades, bought with its catches
       Tycoon       its own warehouse upgrades, bought with its profit
       every game   its own run modifier from the ones its level unlocks,
                    and power-ups earned from its own streaks
     Your gear and modifier never affect the bots, and theirs never affect
     you. Clean runs don't change the rivals either. */

  var RIVAL_GAMES = ["boss", "survival", "blitz", "fishing", "tycoon"];
  var RIVAL_SLOTS = [60, 0, -60]; // a bit better, even, a bit worse than you

  function freshRival(name) {
    return { name: name, xp: 0, wallet: 0, best: 0, reach: 0, runs: 0, wins: 0,
      rod: "bamboo", stats: { reel: 0, bait: 0, line: 0, luck: 0, cast: 0 }, ups: tyFreshUps() };
  }

  function rivalsFor(gameId) {
    var gd = state.gameData;
    gd.rivals = gd.rivals || {};
    var list = gd.rivals[gameId];
    if (!Array.isArray(list) || list.length !== RIVAL_SLOTS.length) {
      var names = seededShuffle(BOT_NAMES, (Date.now() >>> 0) ^ gameId.length);
      list = gd.rivals[gameId] = RIVAL_SLOTS.map(function (_, i) { return freshRival(names[i]); });
    }
    return list;
  }

  function parseRivals(src) {
    var out = {};
    if (!src || typeof src !== "object") return out;
    var num = function (v, d, lo, hi) { return typeof v === "number" && isFinite(v) ? clamp(Math.floor(v), lo, hi) : d; };
    RIVAL_GAMES.forEach(function (gid) {
      var list = src[gid];
      if (!Array.isArray(list) || list.length !== RIVAL_SLOTS.length) return;
      var ok = list.every(function (r) { return r && typeof r === "object" && typeof r.name === "string" && BOT_NAMES.indexOf(r.name) !== -1; });
      if (!ok) return;
      out[gid] = list.map(function (r) {
        var x = freshRival(r.name);
        x.xp = num(r.xp, 0, 0, 1e9); x.wallet = num(r.wallet, 0, 0, 1e15); x.best = num(r.best, 0, 0, 1e6);
        x.reach = num(r.reach, 0, 0, 25); x.runs = num(r.runs, 0, 0, 1e9); x.wins = num(r.wins, 0, 0, 1e9);
        if (FISH_RODS.some(function (rod) { return rod.id === r.rod; })) x.rod = r.rod;
        if (r.stats && typeof r.stats === "object") FISH_STATS.forEach(function (st) { x.stats[st.id] = num(r.stats[st.id], 0, 0, STAT_MAX); });
        if (r.ups && typeof r.ups === "object") TYCOON_UPGRADES.forEach(function (u) { x.ups[u.id] = num(r.ups[u.id], 0, 0, TY_UP_MAX); });
        return x;
      });
    });
    return out;
  }

  function rivalLevel(r) { return levelForXp(r.xp); }

  /* The rival's best gear in each slot, from what its campaign reach has unlocked. */
  function rivalGear(r) {
    var best = {};
    CB_GEAR.forEach(function (gear) { if (gear.boss <= r.reach) best[gear.slot] = gear; });
    return best;
  }
  function rivalGearSum(r, key) {
    var gear = rivalGear(r), total = 0;
    Object.keys(gear).forEach(function (slot) { if (typeof gear[slot][key] === "number") total += gear[slot][key]; });
    return total;
  }
  function rivalGearFlag(r, key) {
    var gear = rivalGear(r);
    return Object.keys(gear).some(function (slot) { return gear[slot][key] === true; });
  }
  function rivalGearStart(r) {
    var gear = rivalGear(r), out = [];
    Object.keys(gear).forEach(function (slot) { (gear[slot].start || []).forEach(function (k) { out.push(k); }); });
    return out;
  }

  /* The newest perk the rival's best run has unlocked: like a player, it
     tries out what it just earned (Chill, then Tough at 25, Medic at 40...). */
  function rivalPerk(r) {
    var pick = SV_PERKS[0];
    SV_PERKS.forEach(function (perk) { if (r.best >= perk.need && perk.need >= pick.need) pick = perk; });
    return pick.id;
  }

  /* Like rollModifier, but from the rival's own level. */
  function rivalModifier(r, gameId) {
    var lvl = rivalLevel(r);
    var pool = MODIFIERS.filter(function (m) { return m.lvl <= lvl && (!m.games || m.games.indexOf(gameId) !== -1); });
    return pool.length && Math.random() < 0.6 ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  /* A short "Lv 6 · Frost Blade, Leaf Mail" line for the leaderboard. */
  function rivalSummary(b) {
    var r = b.rival, g = game, bits = [];
    if (!r) return "";
    bits.push("Lv " + rivalLevel(r));
    if (g.id === "boss" && g.campaign) {
      var gear = rivalGear(r);
      var names = ["weapon", "armor", "charm"].filter(function (k) { return gear[k]; }).map(function (k) { return gear[k].name; });
      if (names.length) bits.push(names.join(", "));
    } else if (g.id === "survival" && b.perk) bits.push(SV_PERKS.filter(function (x) { return x.id === b.perk; })[0].name);
    else if (g.id === "fishing") bits.push(rodById(r.rod).name);
    else if (g.id === "tycoon") bits.push(tyTrucks({ upgrades: r.ups }) > 1 ? "trucks ×" + tyTrucks({ upgrades: r.ups }) : "no extra trucks");
    if (b.mod) bits.push(b.mod.name);
    return bits.join(" · ");
  }

  /* Rival power-ups: earned from its own streaks (every 5, or 4 with a
     Lucky bonus), at most MAX_POWERUPS held, used the way a player would. */
  function botAwardPowerup(b) {
    var held = b.pu.fifty + b.pu.freeze + b.pu.heal;
    if (held >= MAX_POWERUPS) return;
    var pool = ["freeze", "fifty"];
    if (b.hearts < b.maxHearts) pool.push("heal", "heal");
    b.pu[pool[Math.floor(Math.random() * pool.length)]]++;
  }

  /* Fishing: a rival spends its coins like a player: the next rod when it
     can afford it, otherwise the cheapest stat upgrade, until it can't. */
  function rivalShopFishing(r) {
    for (var guard = 0; guard < 50; guard++) {
      var idx = FISH_RODS.findIndex(function (rod) { return rod.id === r.rod; });
      var next = FISH_RODS[idx + 1];
      if (next && r.wallet >= next.price) { r.wallet -= next.price; r.rod = next.id; continue; }
      var cheapest = null, price = Infinity;
      FISH_STATS.forEach(function (st) {
        var lvl = r.stats[st.id];
        if (lvl >= STAT_MAX) return;
        var cost = statPrice(st.base, lvl);
        if (cost < price) { price = cost; cheapest = st; }
      });
      // Save up for the next rod when it's within reach.
      if (next && r.wallet + price > next.price * 0.8 && r.wallet < next.price) break;
      if (!cheapest || r.wallet < price) break;
      r.wallet -= price; r.stats[cheapest.id]++;
    }
  }

  /* Tycoon: after each day a rival banks its profit and buys its cheapest
     affordable upgrade (day length is shared, so it skips Loading docks). */
  function rivalShopTycoon(r) {
    for (var guard = 0; guard < 50; guard++) {
      var pick = null, price = Infinity;
      TYCOON_UPGRADES.forEach(function (u) {
        if (u.id === "docks" || r.ups[u.id] >= TY_UP_MAX) return;
        var cost = tycoonUpgradePrice(u, r.ups[u.id]);
        if (cost < price) { price = cost; pick = u; }
      });
      if (!pick || r.wallet < price) break;
      r.wallet -= price; r.ups[pick.id]++;
    }
  }

  /* After a finished (non-clean) run: rivals keep their XP, records and
     earnings, and shop with what they earned. */
  function settleRivals(g) {
    if (!g.botsOn || g.clean || !g.bots.length || !g.bots[0].rival) return;
    var mine = g.score;
    g.bots.forEach(function (b) {
      var r = b.rival;
      if (!r) return;
      var xp = 25 + 10 * b.correct;
      if (b.mod && b.mod.xp) xp *= b.mod.xp;
      r.xp += Math.round(xp);
      r.runs++;
      if (b.score > mine) r.wins++;
      if (g.id === "survival") r.best = Math.max(r.best, b.correct);
      if (g.id === "boss" && g.campaign && b.won) r.reach = clamp(Math.max(r.reach, g.boss.index + 1), 0, 25);
      if (g.id === "fishing") { r.wallet += Math.max(0, Math.round(b.score)); rivalShopFishing(r); }
    });
  }

  function createBots() {
    var g = game;
    // League matches use the league's level; everything else plays at
    // your rating (a neutral guess until your first run, then live re-tuning).
    var base = g.leagueBase || 0;
    var you = g.leagueBase ? null : liveSkill(g); // what we know of how you play
    var rivals = RIVAL_GAMES.indexOf(g.id) !== -1
      // A clean run races copies, so nothing that happens sticks.
      ? rivalsFor(g.id).map(function (r) { return g.clean ? JSON.parse(JSON.stringify(r)) : r; })
      : null;
    var names = seededShuffle(BOT_NAMES, (Date.now() >>> 0));
    RIVAL_SLOTS.forEach(function (offset, i) {
      var jitter = Math.round((Math.random() - 0.5) * 40);
      var rating = base + offset + jitter;
      var prof = botProfile(rating);
      var r = rivals ? rivals[i] : null;
      var name = (r ? r.name : names[i]) + (g.id === "tycoon" ? BOT_COMPANY[i % BOT_COMPANY.length] : "");
      var b = {
        name: name, rating: rating, acc: prof.acc, thinkMean: prof.think, readFactor: prof.readFactor,
        score: 0, combo: 0, correct: 0, answered: 0, out: false,
        hearts: MAX_HEARTS, maxHearts: MAX_HEARTS, bossIndex: 0, bossHp: bossMaxHp(0), bosses: 0,
        clockLeft: (g.blitzTotal || BLITZ_SECONDS) * 1000, used: 0, catches: 0,
        dayOrders: g.id === "tycoon" ? Infinity : 0, next: 0, dayProfit: 0,
        rival: r, mod: null, rewardMult: 1, thinkBonus: 0, pu: { fifty: 0, freeze: 0, heal: 0 },
        powerupEvery: 5, perk: null, forgiveLeft: 0, secondWind: false, jitter: jitter
      };
      // League rivals play at the tier's level; everyone else copies you.
      applyBotSkill(b, g.leagueBase ? { acc: skillAcc(rating), pace: skillPace(rating) } : botSkillFor(you, RIVAL_STEPS[i]));
      if (r) {
        b.mod = rivalModifier(r, g.id);
        if (b.mod) {
          b.rewardMult = b.mod.reward || 1;
          b.thinkBonus += b.mod.think || 0;
          if (b.mod.powerupEvery) b.powerupEvery = b.mod.powerupEvery;
          if (b.mod.forceHard) b.acc *= 0.9; // hard wrong answers trip it up more
        }
        if (g.id === "boss" && g.campaign) {
          b.maxHearts += rivalGearSum(r, "hearts");
          b.thinkBonus += rivalGearSum(r, "think");
          b.dmgBonus = rivalGearSum(r, "dmg");
          b.forgive = rivalGearFlag(r, "forgive");
          rivalGearStart(r).forEach(function (k) { if (b.pu.fifty + b.pu.freeze + b.pu.heal < MAX_POWERUPS) b.pu[k]++; });
        }
        if (g.id === "survival") {
          b.perk = rivalPerk(r);
          if (b.perk === "tough") b.maxHearts = 4;
          if (b.perk === "chill") b.pu.freeze++;
          if (b.perk === "medic") b.pu.heal++;
          if (b.perk === "collector") b.pu.fifty++;
          if (b.perk === "lucky") b.powerupEvery = 4;
          if (b.perk === "scholar") b.thinkBonus += 1000;
          if (b.perk === "secondwind") b.secondWind = true;
        }
        if (g.id === "fishing") b.thinkBonus += rodById(r.rod).time + 1000 * r.stats.reel;
        if (g.id === "tycoon") b.thinkBonus += 1000 * r.ups.conveyor;
        b.hearts = b.maxHearts;
        b.forgiveLeft = b.forgive ? 1 : 0;
      }
      b.next = botThink(b);
      g.bots.push(b);
    });
  }

  /* Bots read the bank's average question, then think. Stronger bots read
     faster; everyone varies from answer to answer. */
  /* A bot takes its pace times the reading-plus-thinking time of an
     average question, give or take a quarter. */
  function botThink(b) {
    return b.pace * (readingMs(game.avgWords) + BASE_THINK_MS) * (0.75 + Math.random() * 0.5);
  }
  function botLimit(b, extra) {
    // Survival's Steady perk: the timer shrinks half as fast.
    var correct = b.perk === "steady" ? Math.floor(b.correct / 2) : b.correct;
    var who = { bot: true, bossIndex: b.bossIndex, correct: correct, rarity: extra && extra.rarity };
    return readingMs(game.avgWords) + gameThinkingMs(who) + (b.thinkBonus || 0);
  }
  function botMult(combo) { return combo >= 10 ? 3 : combo >= 5 ? 2 : combo >= 3 ? 1.5 : 1; }

  /* One answer by a bot, following the same rules as the player. */
  function botAct(b) {
    var g = game;
    var think = botThink(b);
    var right = Math.random() < b.acc;
    var limit, speed, pts;
    if (g.id === "boss" || g.id === "survival") {
      // Campaign: every rival fights its own copy of your boss, and the
      // first to bring it down is done (the race ends when yours does).
      // (Rivals have to get through the same shield layers, counted as extra health.)
      if (g.id === "boss" && g.campaign && !b.campaignHp) { b.campaignHp = true; b.bossHp = cbHp(g.boss.index) + bossShieldTotal(g.boss.index, true); }
      limit = botLimit(b);
      // Its own power-ups: 50/50 now and then, Freeze to beat the clock.
      if (b.pu.fifty && Math.random() < 0.3) { b.pu.fifty--; right = right || Math.random() < 0.5; }
      if (think > limit && b.pu.freeze) { b.pu.freeze--; think = limit * 0.9; }
      if (think > limit) right = false;
      b.answered++;
      if (right) {
        b.combo++; b.correct++;
        if (b.combo % b.powerupEvery === 0) botAwardPowerup(b);
        speed = Math.max(0, (limit - think) / limit);
        if (g.id === "boss") {
          pts = Math.round(20 * (1 + 0.5 * speed) * botMult(b.combo) * (1 + (b.dmgBonus || 0)));
          b.bossHp -= pts;
          if (b.bossHp <= 0 && g.campaign) {
            pts += 100 * (g.boss.index + 1); b.bosses++; b.won = true; b.out = true;
          } else if (b.bossHp <= 0) {
            pts += 100 * (b.bossIndex + 1); b.bosses++; b.bossIndex++; b.bossHp = bossMaxHp(b.bossIndex) + bossShieldTotal(b.bossIndex, false);
            b.forgiveLeft = b.forgive ? 1 : 0; // gear: first miss each fight is free
          }
        } else {
          pts = Math.round(10 * (1 + speed) * botMult(b.combo));
        }
        b.score += Math.round(pts * b.rewardMult);
      } else {
        b.combo = 0;
        if (b.forgiveLeft > 0) b.forgiveLeft--;
        else if (b.hearts === 1 && b.secondWind) b.secondWind = false;
        else b.hearts--;
        if (b.hearts === 1 && b.pu.heal) { b.pu.heal--; b.hearts++; }
        if (b.hearts <= 0) b.out = true;
      }
      b.next += Math.min(think, limit);
    } else if (g.id === "blitz") {
      b.used += think;
      if (b.used > b.clockLeft) { b.out = true; return; }
      b.answered++;
      if (right) {
        b.combo++; b.correct++;
        b.score += Math.round(10 * (1 + 0.5 * Math.max(0, 1 - think / (readingMs(g.avgWords) + BASE_THINK_MS + b.thinkBonus))) * botMult(b.combo) * b.rewardMult);
      } else {
        b.combo = 0;
        b.clockLeft -= BLITZ_PENALTY_MS;
        if (b.used >= b.clockLeft) b.out = true;
      }
      b.next += think;
    } else if (g.id === "fishing") {
      // Same water as you, its own rod and upgrades.
      var loc = locationById(g.profile.location);
      var st = b.rival ? b.rival.stats : { reel: 0, bait: 0, line: 0, luck: 0, cast: 0 };
      var rod = b.rival ? b.rival.rod : "bamboo";
      var wait = (1500 + Math.random() * 3500) * (1 - 0.1 * st.cast);
      var common = 70 - 4.5 * st.bait, rareW = 25 + 3 * st.bait, legW = 5 + 1.5 * st.bait;
      var roll = Math.random() * (common + rareW + legW);
      var rarity = roll < common ? "common" : roll < common + rareW ? "rare" : "legendary";
      limit = botLimit(b, { rarity: rarity });
      if (think > limit) right = false;
      // Line strength or the Pro Rod can keep a fish after a wrong answer.
      if (!right && think <= limit && (rod === "pro" || Math.random() < 0.1 * st.line)) right = Math.random() < b.acc;
      b.answered++;
      if (right) {
        b.combo++; b.correct++;
        var count = rod === "fiberglass" && Math.random() < 0.1 ? 2 : 1;
        b.catches += count;
        var luck = 1 + 0.08 * st.luck + (rod === "carbon" ? 0.1 : 0);
        b.score += Math.round(FISH_BASE_VALUE[rarity] * loc.mult * botMult(b.combo) * luck * b.rewardMult) * count;
      } else b.combo = 0;
      b.next += wait + Math.min(think, limit) + GAME_FEEDBACK_MS;
    } else if (g.id === "tycoon") {
      if (b.dayOrders <= 0) return;
      // Same day and market as you, its own upgrades (no extra warehouses).
      var ups = b.rival ? b.rival.ups : g.profile.upgrades;
      var value = Math.round((40 + 8 * g.profile.day) * (1 + 0.2 * ups.marketing));
      limit = botLimit(b);
      if (think > limit) right = false;
      var qc = 1 - 0.1 * ups.qc;
      b.answered++;
      b.dayOrders--;
      var delta;
      if (right) {
        b.combo++; b.correct++;
        delta = Math.round(value * tyTrucks({ upgrades: ups }) * (1 + (botMult(b.combo) - 1) * (1 + 0.25 * ups.forklifts)) * b.rewardMult);
      } else {
        b.combo = 0;
        delta = -Math.round(value * (think > limit ? 0.15 : 0.3) * qc);
      }
      b.score += delta;
      b.dayProfit += delta;
      b.next += Math.min(think, limit);
    }
  }

  function runBots() {
    var g = game;
    if (!g.botsOn) return;
    var changed = false;
    g.bots.forEach(function (b) {
      var guard = 0;
      while (!b.out && b.next <= g.botClock && guard++ < 20) {
        if (g.id === "tycoon" && (b.dayOrders <= 0 || !g.ty.dayOpen)) break;
        botAct(b);
        changed = true;
      }
    });
    if (changed) renderBoard();
  }

  /* When the player's run ends, bots still in play finish theirs. */
  function finishBots() {
    var g = game;
    g.bots.forEach(function (b) {
      var guard = 0;
      if (g.id === "boss" && g.campaign) {
        // Same fight, same clock: rivals stop when your fight ends.
        while (!b.out && b.next <= g.botClock && guard++ < 2000) botAct(b);
      } else if (g.id === "boss" || g.id === "survival") {
        while (!b.out && guard++ < 2000) botAct(b);
      } else if (g.id === "blitz") {
        while (!b.out && guard++ < 2000) botAct(b);
      } else if (g.id === "fishing") {
        while (b.next <= g.botClock && guard++ < 2000) botAct(b);
      }
    });
  }

  function renderBoard(target, label) {
    if (!target && renderDefer) { renderDefer.board = true; return; }
    var g = game;
    var box = target || byId("game-board");
    box.classList.toggle("hidden", !g.botsOn);
    // The live board is a bar along the bottom-left of the screen.
    if (box.id === "game-board") document.body.classList.toggle("board-on", !!g.botsOn && !g.over);
    if (!g.botsOn) return;
    // The full "level · gear · modifier" line shows on the day/final
    // boards; the live board keeps one line per row (hover for details).
    var rows = g.bots.map(function (b) { return { name: b.name, score: b.score, out: b.out, won: b.won, you: false, summary: rivalSummary(b), sub: !!label }; });
    rows.push({ name: g.id === "tycoon" ? "You" : "You", score: g.id === "tycoon" ? g.ty.sessionProfit + (g.ty.dayOpen ? g.ty.dayRevenue - g.ty.dayPenalties : 0) : g.score, out: false, you: true });
    rows.sort(function (a, b) { return b.score - a.score; });
    // Rebuild only when something visible changed.
    var sig = (label || "") + "|" + rows.map(function (r) { return r.name + ":" + r.score + ":" + (r.out ? 1 : 0) + ":" + (r.summary || ""); }).join(",") + "|" + g.token;
    if (box._sig === sig && box.childElementCount) return;
    box._sig = sig;
    box.textContent = "";
    var h = document.createElement("p");
    h.className = "board-title";
    h.textContent = label || (g.id === "tycoon" ? "Profit race" : "Live standings");
    box.appendChild(h);
    rows.forEach(function (r, i) {
      var row = document.createElement("div");
      row.className = "board-row" + (r.you ? " you" : "") + (r.out ? " out" : "");
      var place = document.createElement("span");
      place.className = "board-place";
      place.textContent = String(i + 1);
      var name = document.createElement("span");
      name.className = "board-name";
      name.textContent = r.name + (r.won ? " (won)" : r.out && g.id !== "tycoon" && g.id !== "fishing" ? " (out)" : "");
      if (r.summary) {
        name.title = r.summary;
        var sub = document.createElement("small");
        sub.className = r.sub ? "board-sub" : "board-lvl";
        sub.textContent = r.sub ? r.summary : r.summary.split(" · ")[0];
        name.appendChild(sub);
      }
      var score = document.createElement("span");
      score.className = "board-score";
      score.textContent = g.id === "tycoon" ? fmtMoney(r.score) : fmtScore(r.score);
      row.appendChild(place);
      row.appendChild(name);
      row.appendChild(score);
      box.appendChild(row);
    });
  }

  function settleBots() {
    var g = game;
    finishBots();
    var mine = g.score;
    var place = 1 + g.bots.filter(function (b) { return b.score > mine; }).length;
    var r = g.skillSettled || (g.skillSettled = settleSkill(g));
    return { place: place, before: r.before, after: r.after, changed: r.changed, acc: r.acc, pace: r.pace };
  }

