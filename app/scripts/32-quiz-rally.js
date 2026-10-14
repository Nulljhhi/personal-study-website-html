  /* ============================== Quiz Rally ==============================
     A real-time race against three rivals. The race clock runs while you
     answer: a correct answer boosts your car, streaks fill the nitro meter,
     and a miss spins you out. Rivals answer the same way, reading at your
     reading speed, so the race is fair for slow and fast readers alike. */

  var RL_LAP = 1000;           // metres per lap
  var RL_CUP_LAPS = [3, 3, 4, 4, 5];
  var RL_BOOST_MS = 3500;
  var RL_STRAIGHT_BONUS_MS = 2000;
  var RL_POINTS = [10, 6, 4, 3];
  var RL_PRIZES = [400, 250, 150, 80];

  var RL_THEMES = [
    { id: "city", name: "City", ground: "#9aa5b1", road: "#3d434b", line: "#f8f9fa", amp: 0.1 },
    { id: "desert", name: "Desert", ground: "#e9c46a", road: "#6b5a45", line: "#fff3d6", amp: 0.08 },
    { id: "mountain", name: "Mountain", ground: "#6a994e", road: "#4a4e52", line: "#ffffff", amp: 0.17 },
    { id: "coast", name: "Coast", ground: "#7ec8e3", road: "#5c5f66", line: "#ffffff", amp: 0.12 },
    { id: "night", name: "Night", ground: "#1d2b45", road: "#2b2d42", line: "#ffd166", amp: 0.13 }
  ];
  var RL_TRACK_NAMES = [
    "Downtown Loop", "Harbor Bridge", "Neon Avenue", "Old Town Circuit",
    "Dune Sprint", "Canyon Rim", "Oasis Ring", "Mirage Flats",
    "Pine Pass", "Summit Switchbacks", "Glacier Gap", "Eagle Ridge",
    "Seaside Strip", "Lighthouse Point", "Coral Bay", "Cliff Road",
    "Midnight Run", "Moonlight Mile", "Starlight Speedway", "Blackout Boulevard"
  ];
  var RL_CUPS = [
    { id: "rookie", name: "Rookie Cup", rating: 880, car: "hatch", tune: 0, weather: ["clear"],
      rival: { name: "Dash Dawson", style: "starter", desc: "a fast starter who fades" } },
    { id: "club", name: "Club Cup", rating: 1000, car: "coupe", tune: 1, weather: ["clear", "clear", "rain"],
      rival: { name: "Marta Vale", style: "finisher", desc: "a strong finisher on the last lap" } },
    { id: "pro", name: "Pro Cup", rating: 1060, car: "wagon", tune: 2, weather: ["clear", "rain", "fog"],
      rival: { name: "Kenji Ardo", style: "nitro", desc: "fires nitro early and often" } },
    { id: "elite", name: "Elite Cup", rating: 1110, car: "gt", tune: 3, weather: ["clear", "rain", "fog", "night"],
      rival: { name: "Sofia Brandt", style: "steady", desc: "rarely makes a mistake" } },
    { id: "legends", name: "Legends Cup", rating: 1170, car: "hyper", tune: 4, weather: ["rain", "fog", "night", "night"],
      rival: { name: "The Professor", style: "all", desc: "fast off the line, strong at the end" } }
  ];
  var RL_BOT_NAMES = ["Rory", "Jules", "Priya", "Mateo", "Ines", "Tobias", "Ava", "Noor", "Felix", "Hana", "Leo", "Zara"];
  var RL_WEATHER = {
    clear: { name: "Clear", desc: "" },
    rain: { name: "Rain", desc: "Spin-outs last 50% longer." },
    fog: { name: "Fog", desc: "You can only see cars close to you." },
    night: { name: "Night", desc: "Headlights only." }
  };
  var RL_CARS = [
    { id: "hatch", name: "Hatchback", key: "hatch", price: 0, top: 18, accel: 6, cap: 6, spin: 1800, color: "#e63946" },
    { id: "coupe", name: "Coupe", key: "car2", price: 1500, top: 19.5, accel: 6.5, cap: 6, spin: 1700, color: "#457b9d" },
    { id: "wagon", name: "Rally Wagon", key: "car3", price: 3000, top: 19.5, accel: 8.5, cap: 5, spin: 1300, color: "#2a9d8f" },
    { id: "roadster", name: "Roadster", key: "car4", price: 5000, top: 21.5, accel: 7, cap: 6, spin: 1700, color: "#f4a261" },
    { id: "gt", name: "GT", key: "car5", price: 8000, top: 23, accel: 7.5, cap: 5, spin: 1600, color: "#8338ec" },
    { id: "rallypro", name: "Rally Pro", key: "car6", price: 12000, top: 23, accel: 9.5, cap: 4, spin: 1100, color: "#06d6a0" },
    { id: "hyper", name: "Hypercar", key: "car7", price: 20000, top: 26, accel: 9, cap: 5, spin: 1500, color: "#ffbe0b" },
    { id: "proto", name: "Prototype", key: "car8", price: 35000, top: 28, accel: 10, cap: 4, spin: 1200, color: "#ff006e" }
  ];
  var RL_PARTS = [
    { id: "engine", name: "Engine", desc: "+4% top speed per level." },
    { id: "tires", name: "Tires", desc: "+10% acceleration and better cornering per level." },
    { id: "nitro", name: "Nitro", desc: "+12% nitro burn time per level." },
    { id: "chassis", name: "Chassis", desc: "Spin-outs 10% shorter per level." }
  ];
  var RL_MEDALS = ["bronze", "silver", "gold"];
  var RL_MEDAL_REWARD = { bronze: 150, silver: 300, gold: 600 };

  function rlCar(id) { for (var i = 0; i < RL_CARS.length; i++) if (RL_CARS[i].id === id) return RL_CARS[i]; return RL_CARS[0]; }
  function rlFreshTune() { return { engine: 0, tires: 0, nitro: 0, chassis: 0 }; }
  function rlSpec(carId, tune) {
    var c = rlCar(carId);
    tune = tune || rlFreshTune();
    return {
      top: c.top * (1 + 0.04 * tune.engine), accel: c.accel * (1 + 0.1 * tune.tires), cap: c.cap,
      spin: c.spin * (1 - 0.1 * tune.chassis), nitroMs: 3500 * (1 + 0.12 * tune.nitro), corner: 0.76 + 0.03 * tune.tires
    };
  }
  function rlMaxTune(level) { return level >= 14 ? 5 : level >= 8 ? 4 : 3; }
  function rlTunePrice(carId, part, lvl) {
    var c = rlCar(carId);
    return Math.round(Math.max(600, c.price * 0.15) * Math.pow(1.6, lvl) * (part === "engine" ? 1.2 : 1));
  }

  /* -------------------------------- Tracks -------------------------------- */

  var rlTrackCache = {};
  /* A smooth closed loop from a seed; corners are the tightest 30% of it
     and hairpins the tightest 8%. */
  function rlTrack(index) {
    if (rlTrackCache[index]) return rlTrackCache[index];
    var theme = RL_THEMES[Math.floor(index / 4)];
    var rnd = mulberry32((9173 + index * 7919) >>> 0);
    var harm = [];
    for (var h = 2; h <= 5; h++) harm.push({ h: h, a: theme.amp * (0.5 + rnd()) * (1.6 / h), p: rnd() * Math.PI * 2 });
    var N = 240, pts = [];
    for (var k = 0; k < N; k++) {
      var th = 2 * Math.PI * k / N, r = 1;
      harm.forEach(function (x) { r += x.a * Math.sin(x.h * th + x.p); });
      pts.push([50 + 41 * r * Math.cos(th), 30 + 22 * r * Math.sin(th)]);
    }
    pts.reverse(); // drive clockwise on screen
    var cum = [0];
    for (var i = 1; i <= N; i++) { var a = pts[i - 1], b = pts[i % N]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    var len = cum[N];
    var heading = function (j) { var a2 = pts[(j + N) % N], b2 = pts[(j + 1 + N) % N]; return Math.atan2(b2[1] - a2[1], b2[0] - a2[0]); };
    var curv = [];
    for (var j = 0; j < N; j++) {
      var d = heading(j + 3) - heading(j - 3);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      curv.push(Math.abs(d));
    }
    var sorted = curv.slice().sort(function (x, y) { return x - y; });
    var c1 = sorted[Math.floor(N * 0.7)], c2 = sorted[Math.floor(N * 0.92)];
    var kind = curv.map(function (c) { return c >= c2 ? 2 : c >= c1 ? 1 : 0; });
    rlTrackCache[index] = { index: index, name: RL_TRACK_NAMES[index], theme: theme, pts: pts, cum: cum, len: len, kind: kind, N: N };
    return rlTrackCache[index];
  }
  function rlCupTracks(cup) { return [cup, cup + 5, cup + 10, cup + 15]; }
  function rlLocate(track, d) {
    var m = ((d % RL_LAP) + RL_LAP) % RL_LAP;
    var u = m / RL_LAP * track.len;
    var lo = 0, hi = track.N;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (track.cum[mid] <= u) lo = mid; else hi = mid; }
    var a = track.pts[lo], b = track.pts[(lo + 1) % track.N];
    var t = (u - track.cum[lo]) / (track.cum[lo + 1] - track.cum[lo] || 1);
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, ang: Math.atan2(b[1] - a[1], b[0] - a[0]), kind: track.kind[lo] };
  }

  /* ------------------------------- Physics ------------------------------- */

  function rlNewCar(name, carId, tune, isYou) {
    return { name: name, carId: carId, spec: rlSpec(carId, tune), you: !!isYou, d: 0, v: 0, boost: 0, nitro: 0, spin: 0, meter: 0,
      finished: false, time: 0, correct: 0, answered: 0, combo: 0, nextAt: 0, pending: null };
  }

  /* Advance one car by dt ms. */
  function rlDrive(car, track, dt, weather) {
    if (car.finished) return;
    var s = car.spec;
    var kind = rlLocate(track, car.d).kind;
    var target;
    if (car.spin > 0) target = 0;
    else if (car.nitro > 0) target = s.top * 1.3;
    else if (car.boost > 0) target = s.top;
    else target = s.top * 0.45;
    if (kind > 0 && car.nitro <= 0) target = Math.min(target, s.top * (kind === 2 ? s.corner - 0.12 : s.corner));
    var sec = dt / 1000;
    if (car.v < target) car.v = Math.min(target, car.v + s.accel * sec);
    else car.v = Math.max(target, car.v - 9 * sec);
    car.d += car.v * sec;
    car.boost = Math.max(0, car.boost - dt);
    car.nitro = Math.max(0, car.nitro - dt);
    car.spin = Math.max(0, car.spin - dt);
    void weather;
  }

  /* A boost lasts about as long as answering the next question takes, so a
     run of correct answers keeps the car at top speed. */
  function rlBoostMs(avgWords) { return RL_BOOST_MS + 0.75 * (readingMs(avgWords) + BASE_THINK_MS); }
  function rlOnCorrect(car, track, speedFrac, combo, avgWords) {
    var kind = rlLocate(track, car.d).kind;
    car.boost = rlBoostMs(avgWords) + (kind === 0 ? RL_STRAIGHT_BONUS_MS * speedFrac : 0);
    car.meter = Math.min(car.spec.cap, car.meter + 1 + (combo >= 5 ? 1 : 0));
    car.correct++;
    car.answered++;
    car.combo++;
    return kind;
  }
  function rlOnMiss(car, weather) {
    car.spin = car.spec.spin * (weather === "rain" ? 1.5 : 1);
    car.boost = 0;
    car.v *= 0.3;
    car.answered++;
    car.combo = 0;
  }
  function rlFireNitro(car) {
    if (car.meter < car.spec.cap || car.finished || car.nitro > 0) return false;
    car.meter = 0;
    car.nitro = car.spec.nitroMs;
    return true;
  }

  /* A bot answers like the player: it reads the bank's average question at
     the player's reading speed, then thinks. */
  function rlBotSchedule(b, race, rnd) {
    var lap = Math.min(race.laps, Math.floor(b.d / RL_LAP) + 1);
    var acc = b.acc;
    var st = b.style;
    if (st === "starter" || st === "all") acc += lap === 1 ? 0.1 : st === "all" ? 0 : -0.03;
    if (st === "finisher" || st === "all") acc += lap === race.laps ? 0.12 : st === "all" ? 0 : -0.03;
    if (st === "steady") acc += 0.02;
    acc = clamp(acc, 0.3, 0.99);
    var kind = rlLocate(race.track, b.d).kind;
    var limit = readingMs(race.avgWords) + BASE_THINK_MS - (kind === 2 ? 1500 : kind === 1 ? 1000 : 0);
    var think = b.pace
      ? b.pace * (readingMs(race.avgWords) + BASE_THINK_MS) * (0.75 + rnd() * 0.5)   // rated rivals
      : (readingMs(race.avgWords) * b.readFactor + b.thinkMean) * (0.55 + rnd() * 0.55); // medal ghosts
    var right = rnd() < acc && think <= limit;
    var at = Math.min(think, limit);
    b.pending = { at: race.clock + at, right: right, speed: Math.max(0, (limit - think) / limit) };
  }
  function rlBotAct(b, race, rnd) {
    if (b.finished) return;
    if (!b.pending) rlBotSchedule(b, race, rnd);
    if (race.clock < b.pending.at) return;
    if (b.pending.right) rlOnCorrect(b, race.track, b.pending.speed, b.combo, race.avgWords);
    else rlOnMiss(b, race.weather);
    var resolved = b.pending.at;
    b.pending = null;
    rlBotSchedule(b, race, rnd);
    b.pending.at += resolved - race.clock + GAME_FEEDBACK_MS;
    var onStraight = rlLocate(race.track, b.d).kind === 0;
    if (b.meter >= b.spec.cap && (onStraight || b.style === "nitro" || b.style === "all")) rlFireNitro(b);
  }

  function rlAdvance(race, dt, rnd) {
    race.clock += dt;
    race.cars.forEach(function (c) {
      if (c.finished) return;
      if (!c.you) rlBotAct(c, race, rnd);
      rlDrive(c, race.track, dt, race.weather);
      if (c.d >= RL_LAP * race.laps) { c.finished = true; c.time = race.clock; c.d = RL_LAP * race.laps; }
    });
  }

  /* Finish the bots that are still racing (fast-forward). */
  function rlFinishBots(race) {
    var guard = 0;
    while (race.cars.some(function (c) { return !c.finished && !c.you; }) && guard++ < 20000) rlAdvance(race, 50, Math.random);
  }

  function rlOrder(race) {
    return race.cars.slice().sort(function (a, b) {
      if (a.finished && b.finished) return a.time - b.time;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.d - a.d;
    });
  }

  /* Medal times for a track: a simulated driver in your own car who reads
     at your reading speed, answering 95% (gold), 85% (silver) or 70%
     (bronze) correctly. Averaged over a few seeded runs. */
  /* Medal times take nine simulated ghost laps; cache them by everything
     the simulation depends on (bump RL_SIM_VERSION when physics change). */
  var RL_SIM_VERSION = 1;
  var rlMedalCache = new Map();
  function rlMedalTimes(trackIndex, carId, tune, avgWords) {
    var key = [RL_SIM_VERSION, trackIndex, carId, JSON.stringify(tune || {}), Math.round((avgWords || 0) * 10), readingWpm()].join("|");
    var hit = rlMedalCache.get(key);
    if (hit) return Object.assign({}, hit);
    var result = rlMedalTimesUncached(trackIndex, carId, tune, avgWords);
    if (rlMedalCache.size > 200) rlMedalCache.clear();
    rlMedalCache.set(key, result);
    return Object.assign({}, result);
  }
  function rlMedalTimesUncached(trackIndex, carId, tune, avgWords) {
    var times = [0.95, 0.85, 0.7].map(function (acc, i) {
      var total = 0;
      for (var run = 0; run < 3; run++) {
        var rnd = mulberry32((trackIndex * 131 + i * 977 + run * 31 + 5) >>> 0);
        var ghost = rlNewCar("ghost", carId, tune, false);
        ghost.acc = acc; ghost.thinkMean = 3600; ghost.readFactor = 1; ghost.style = null;
        var race = { track: rlTrack(trackIndex), cars: [ghost], clock: 0, weather: "clear", avgWords: avgWords, laps: 3 };
        var guard = 0;
        while (!ghost.finished && guard++ < 24000) rlAdvance(race, 50, rnd);
        total += ghost.time;
      }
      return total / 3;
    }).sort(function (x, y) { return x - y; });
    return { gold: Math.ceil(times[0] / 100) * 100, silver: Math.ceil(Math.max(times[1], times[0] * 1.04) / 100) * 100,
      bronze: Math.ceil(Math.max(times[2], times[1] * 1.04) / 100) * 100 };
  }

  function fmtRaceTime(ms) {
    // Round to tenths first, so 59.96 s shows as 1:00.0 rather than 0:60.0.
    var tenths = Math.round(Math.max(0, ms) / 100);
    var m = Math.floor(tenths / 600);
    var rest = (tenths - m * 600) / 10;
    return m + ":" + (rest < 10 ? "0" : "") + rest.toFixed(1);
  }
  function ordinal(n) { return ["1st", "2nd", "3rd", "4th"][n - 1] || n + "th"; }

  /* ------------------------------- Profile ------------------------------- */

  function freshRallyProfile() {
    return { credits: 0, car: "hatch", cars: { hatch: rlFreshTune() }, cupBest: {}, cupsWon: {}, rivals: {}, medals: {}, trialBest: {},
      cupRun: null, lastMode: "rookie", lastTrack: 0 };
  }
  function parseRallyProfile(src) {
    var p = freshRallyProfile();
    if (!src || typeof src !== "object") return p;
    var num = function (v, d) { return typeof v === "number" && isFinite(v) ? v : d; };
    p.credits = Math.max(0, Math.floor(num(src.credits, 0)));
    if (src.cars && typeof src.cars === "object") RL_CARS.forEach(function (c) {
      var t = src.cars[c.id];
      if (!t || typeof t !== "object") return;
      p.cars[c.id] = rlFreshTune();
      RL_PARTS.forEach(function (part) { p.cars[c.id][part.id] = clamp(Math.floor(num(t[part.id], 0)), 0, 5); });
    });
    if (hasOwn(p.cars, src.car)) p.car = src.car;
    RL_CUPS.forEach(function (c) {
      if (src.cupBest && num(src.cupBest[c.id], 0) >= 1) p.cupBest[c.id] = clamp(Math.floor(src.cupBest[c.id]), 1, 4);
      if (src.cupsWon && src.cupsWon[c.id] === true) p.cupsWon[c.id] = true;
      if (src.rivals && src.rivals[c.id] === true) p.rivals[c.id] = true;
    });
    for (var i = 0; i < 20; i++) {
      if (src.medals && RL_MEDALS.indexOf(src.medals[i]) !== -1) p.medals[i] = src.medals[i];
      if (src.trialBest && num(src.trialBest[i], 0) > 0) p.trialBest[i] = Math.round(src.trialBest[i]);
    }
    var r = src.cupRun;
    if (r && typeof r === "object" && typeof r.cup === "number" && RL_CUPS[r.cup] && Array.isArray(r.points) && r.points.length === 4 &&
        Array.isArray(r.names) && r.names.length === 3 && typeof r.race === "number" && r.race >= 1 && r.race < 4) {
      p.cupRun = { cup: r.cup, race: Math.floor(r.race), points: r.points.map(function (x) { return Math.max(0, Math.floor(num(x, 0))); }),
        names: r.names.map(function (x) { return String(x).slice(0, 30); }), best: Array.isArray(r.best) ? r.best.slice(0, 4).map(function (x) { return clamp(Math.floor(num(x, 4)), 1, 4); }) : [4, 4, 4, 4] };
    }
    if (typeof src.lastMode === "string") p.lastMode = src.lastMode.slice(0, 20);
    p.lastTrack = clamp(Math.floor(num(src.lastTrack, 0)), 0, 19);
    return p;
  }

  function rlCupLock(p, ci) {
    if (ci === 0) return "";
    if (ci < 4) return (p.cupBest[RL_CUPS[ci - 1].id] || 9) <= 2 ? "" : "Finish the " + RL_CUPS[ci - 1].name + " in the top two";
    var top2 = (p.cupBest.elite || 9) <= 2;
    var rivals = RL_CUPS.slice(0, 4).every(function (c) { return p.rivals[c.id]; });
    return top2 && rivals ? "" : !top2 ? "Finish the Elite Cup in the top two and beat every rival" : "Beat every cup's rival (finish a cup ahead of them)";
  }
  function rlTrackOpen(p, t) { return !rlCupLock(p, t % 5); }

  /* -------------------------------- Setup -------------------------------- */

  function rlFillSetup() {
    var p = state.gameData.rally;
    var mode = byId("rally-mode");
    mode.textContent = "";
    var add = function (value, label, disabled) {
      var o = document.createElement("option");
      o.value = value; o.textContent = label; o.disabled = !!disabled;
      mode.appendChild(o);
    };
    if (p.cupRun) add("resume", "Continue " + RL_CUPS[p.cupRun.cup].name + ", race " + (p.cupRun.race + 1) + " of 4");
    RL_CUPS.forEach(function (c, i) {
      var why = rlCupLock(p, i);
      add(c.id, c.name + (p.cupsWon[c.id] ? " 🏆" : p.cupBest[c.id] ? " (best: " + ordinal(p.cupBest[c.id]) + ")" : "") + (why ? " (locked)" : ""), !!why);
    });
    var trialsOpen = isUnlocked("rally", "trials");
    add("trial", "Time trial" + (trialsOpen ? "" : " (level " + unlockLevelOf("rally", "trials") + ")"), !trialsOpen);
    var want = p.cupRun ? "resume" : p.lastMode;
    if (!mode.querySelector('option[value="' + want + '"]:not([disabled])')) want = "rookie";
    mode.value = want;
    var track = byId("rally-track");
    track.textContent = "";
    for (var t = 0; t < 20; t++) {
      var o = document.createElement("option");
      o.value = String(t);
      var open = rlTrackOpen(p, t);
      o.textContent = RL_TRACK_NAMES[t] + " (" + RL_THEMES[Math.floor(t / 4)].name + ")" + (p.medals[t] ? " · " + p.medals[t] : "") + (open ? "" : " (locked)");
      o.disabled = !open;
      track.appendChild(o);
    }
    track.value = String(rlTrackOpen(p, p.lastTrack) ? p.lastTrack : 0);
    rlSyncSetup();
  }

  function rlSyncSetup() {
    var p = state.gameData.rally;
    var mode = byId("rally-mode").value;
    byId("rally-track-row").classList.toggle("hidden", mode !== "trial");
    var info = [];
    var car = rlCar(p.car);
    info.push("Your car: " + car.name + ".");
    if (mode === "trial") {
      info.push("Race alone for a bronze, silver or gold time. Medal times are set for your car and your reading speed.");
    } else {
      var ci = mode === "resume" && p.cupRun ? p.cupRun.cup : RL_CUPS.map(function (c) { return c.id; }).indexOf(mode);
      if (ci >= 0) {
        var cup = RL_CUPS[ci];
        info.push("4 races, points " + RL_POINTS.join("/") + ". Rival: " + cup.rival.name + ", " + cup.rival.desc + "." +
          (cup.weather.length > 1 ? " Weather can change from race to race." : ""));
        if (mode === "resume") info.push("Points so far: you " + p.cupRun.points[0] + ", best rival " + Math.max.apply(null, p.cupRun.points.slice(1)) + ".");
        else if (p.cupRun) info.push("Finishing a race here replaces your " + RL_CUPS[p.cupRun.cup].name + " in progress.");
      }
    }
    byId("rally-info").textContent = info.join(" ");
  }

  /* -------------------------------- Garage -------------------------------- */

  var garageTab = "cars";
  function openGarage() {
    renderGarage();
    byId("garage-modal").classList.remove("hidden");
    byId("garage-close-btn").focus();
  }
  function closeGarage() {
    byId("garage-modal").classList.add("hidden");
    rlFillSetup();
    updateGameSetup();
  }
  function renderGarage() {
    var p = state.gameData.rally;
    byId("garage-credits").textContent = fmtScore(p.credits) + " credits";
    document.querySelectorAll("#garage-tabs button").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === garageTab); b.setAttribute("aria-selected", b.dataset.tab === garageTab); });
    var list = byId("garage-list");
    list.textContent = "";
    var save = function () { persistCompleted(); renderGarage(); };
    var level = playerLevel("rally");
    if (garageTab === "cars") {
      RL_CARS.forEach(function (c) {
        var owned = !!p.cars[c.id];
        var open = isUnlocked("rally", c.key);
        var here = p.car === c.id;
        var spec = rlSpec(c.id, p.cars[c.id]);
        var desc = "Top speed " + Math.round(spec.top * 3.6 * 2.5) + " km/h · acceleration " + spec.accel.toFixed(1) + " · nitro after " + spec.cap + " answers · spin-out " + (spec.spin / 1000).toFixed(1) + " s";
        list.appendChild(shopCard(c.name, desc, owned ? "Owned" : open ? fmtScore(c.price) + " credits" : "Unlocks at level " + unlockLevelOf("rally", c.key),
          here ? "Driving" : owned ? "Drive" : !open ? "Locked" : "Buy " + fmtScore(c.price), !here && (owned || (open && p.credits >= c.price)), function () {
            if (!purchaseAllowed()) return;
            if (!owned) {
              if (p.credits < c.price || !open) return;
              p.credits -= c.price;
              p.cars[c.id] = rlFreshTune();
              notify("Bought the " + c.name + "!");
            }
            p.car = c.id;
            save();
          }, here ? "equipped" : ""));
      });
    } else if (garageTab === "tuning") {
      var car = rlCar(p.car), tune = p.cars[p.car];
      var max = rlMaxTune(level);
      RL_PARTS.forEach(function (part) {
        var lv = tune[part.id];
        var price = rlTunePrice(car.id, part.id, lv);
        var meta = car.name + " · level " + lv + " / " + max + (max < 5 && lv >= max ? " (level " + (max === 3 ? unlockLevelOf("rally", "tune4") : unlockLevelOf("rally", "tune5")) + " for more)" : "");
        list.appendChild(shopCard(part.name, part.desc, meta, lv >= 5 ? "Maxed" : lv >= max ? "Locked" : "Upgrade " + fmtScore(price),
          lv < max && p.credits >= price, function () {
            if (!purchaseAllowed() || tune[part.id] >= max || p.credits < price) return;
            p.credits -= price;
            tune[part.id]++;
            notify(car.name + ": " + part.name + " upgraded to level " + tune[part.id] + ".");
            save();
          }));
      });
    } else {
      RL_CUPS.forEach(function (c, i) {
        var best = p.cupBest[c.id];
        list.appendChild(shopCard(c.name, "Rival: " + c.rival.name + (p.rivals[c.id] ? " (beaten)" : ""),
          p.cupsWon[c.id] ? "Won" : best ? "Best: " + ordinal(best) : rlCupLock(p, i) ? "Locked" : "Not raced yet", p.cupsWon[c.id] ? "🏆" : "—", false, function () {}, p.cupsWon[c.id] ? "equipped" : ""));
      });
      var medals = { gold: 0, silver: 0, bronze: 0 };
      Object.keys(p.medals).forEach(function (k) { medals[p.medals[k]]++; });
      list.appendChild(shopCard("Time-trial medals", "Gold " + medals.gold + " · Silver " + medals.silver + " · Bronze " + medals.bronze + " (of 20 tracks)", "", "—", false, function () {}));
    }
  }

  /* --------------------------------- Race --------------------------------- */

  function rlRaceWeather(cupIndex, race) {
    var w = RL_CUPS[cupIndex].weather;
    var rnd = mulberry32((cupIndex * 4099 + race * 613 + 11) >>> 0);
    return w[Math.floor(rnd() * w.length)];
  }

  function rlSetupRace() {
    var g = game, R = g.rally, p = g.profile;
    var you = rlNewCar("You", p.car, p.cars[p.car], true);
    var cars = [you];
    if (R.mode === "cup") {
      var cup = RL_CUPS[R.cup];
      R.track = rlTrack(rlCupTracks(R.cup)[R.race]);
      R.weather = rlRaceWeather(R.cup, R.race);
      [[60, cup.rival.style], [0, null], [-60, null]].forEach(function (cfg, i) {
        var tune = rlFreshTune();
        RL_PARTS.forEach(function (part) { tune[part.id] = cup.tune; });
        var b = rlNewCar(R.names[i], cup.car, tune, false);
        // Halfway between the cup's level and yours, so every cup is a
        // close race but harder cups still have faster rivals.
        var mine = storedSkill("rally") || { acc: skillAcc(cup.rating), pace: skillPace(cup.rating) };
        var mid = { acc: (mine.acc + skillAcc(cup.rating)) / 2, pace: (mine.pace + skillPace(cup.rating)) / 2 };
        applyBotSkill(b, botSkillFor(mid, cfg[0] > 0 ? 1 : cfg[0] < 0 ? -1 : 0));
        b.style = cfg[1];
        b.rival = i === 0;
        cars.push(b);
      });
    } else {
      R.track = rlTrack(R.trackIndex);
      R.weather = "clear";
      R.medalTimes = rlMedalTimes(R.trackIndex, p.car, p.cars[p.car], g.avgWords);
    }
    // Stagger the grid a little.
    cars.forEach(function (c, i) { c.d = -i * 8; c.lane = i; });
    R.sim = { track: R.track, cars: cars, clock: 0, weather: R.weather, avgWords: g.avgWords, laps: R.mode === "cup" ? RL_CUP_LAPS[R.cup] : 3 };
    R.you = you;
    R.phase = "grid";
    R.countdown = 3000;
  }

  function rlEnterGrid() {
    var g = game, R = g.rally;
    g.current = null;
    g.locked = true;
    showQuestionPane(false);
    var label = R.mode === "cup" ? RL_CUPS[R.cup].name + ", race " + (R.race + 1) + " of 4" : "Time trial";
    byId("game-idle-title").textContent = label + ": " + R.track.name;
    var w = RL_WEATHER[R.weather];
    var text = R.sim.laps + " laps · " + R.track.theme.name + (R.weather !== "clear" ? " · " + w.name + ": " + w.desc : "");
    if (R.mode === "trial") text += " · Gold " + fmtRaceTime(R.medalTimes.gold) + ", silver " + fmtRaceTime(R.medalTimes.silver) + ", bronze " + fmtRaceTime(R.medalTimes.bronze);
    else text += " · Rival: " + RL_CUPS[R.cup].rival.name + ", " + RL_CUPS[R.cup].rival.desc;
    byId("game-idle-text").textContent = text + ". The race starts after a 3-second countdown.";
    var btn = byId("game-cast-btn");
    btn.textContent = "Start race";
    btn.classList.remove("hidden");
    btn.disabled = false;
    renderArena(true);
    renderGameHud();
    renderGameTimer();
  }

  function rlStartCountdown() {
    var g = game, R = g.rally;
    if (!R || R.phase !== "grid" || g.paused || g.over) return;
    R.phase = "countdown";
    R.countdown = 3000;
    byId("game-cast-btn").classList.add("hidden");
    byId("game-idle-title").textContent = "Get ready…";
    g.lastFrame = performance.now();
  }

  function rlTick(dt) {
    var g = game, R = g.rally;
    if (R.phase === "countdown") {
      R.countdown -= dt;
      var n = Math.ceil(R.countdown / 1000);
      var el = byId("rl-count");
      var label = R.countdown > 0 ? String(n) : "GO!";
      if (el) { if (el.textContent !== label) el.textContent = label; el.classList.remove("hidden"); }
      if (R.countdown <= 0) {
        R.phase = "race";
        setTimeout(function () { var c2 = byId("rl-count"); if (c2) c2.classList.add("hidden"); }, 600);
        g.locked = false;
        nextGameQuestion();
      }
      return true;
    }
    if (R.phase !== "race") return true;
    rlAdvance(R.sim, dt, Math.random);
    // Several steps can run in one frame; the cars are drawn once, after them.
    if (renderDefer) renderDefer.cars = true; else rlRenderCars();
    if (R.you.finished) { rlRenderCars(); rlRaceDone(); return true; }
    return false; // let the engine run the question timer
  }

  function rlRaceDone() {
    var g = game, R = g.rally, p = g.profile;
    R.phase = "done";
    g.locked = true;
    g.current = null;
    showQuestionPane(false);
    rlFinishBots(R.sim);
    var order = rlOrder(R.sim);
    var place = order.indexOf(R.you) + 1;
    var lines = [];
    var earned = 0;
    if (R.mode === "cup") {
      var cupMult = 1 + 0.6 * R.cup;
      earned = Math.round(RL_PRIZES[place - 1] * cupMult * g.rewardMult);
      order.forEach(function (c, i) { var idx = R.sim.cars.indexOf(c); R.points[idx] += RL_POINTS[i]; R.best[idx] = Math.min(R.best[idx], i + 1); });
      if (place <= 2) gameEvent("top2");
      if (place === 1) { gameEvent("racewin"); R.wins++; }
      lines.push("You finished " + ordinal(place) + " in " + fmtRaceTime(R.you.time) + ". +" + fmtScore(earned) + " credits.");
    } else {
      var t = R.you.time, medal = t <= R.medalTimes.gold ? "gold" : t <= R.medalTimes.silver ? "silver" : t <= R.medalTimes.bronze ? "bronze" : null;
      var prev = p.medals[R.trackIndex];
      var prevRank = prev ? RL_MEDALS.indexOf(prev) : -1, newRank = medal ? RL_MEDALS.indexOf(medal) : -1;
      for (var k = prevRank + 1; k <= newRank; k++) earned += RL_MEDAL_REWARD[RL_MEDALS[k]];
      if (newRank > prevRank) p.medals[R.trackIndex] = medal;
      if (medal) gameEvent("medal");
      p.trialBest[R.trackIndex] = Math.min(p.trialBest[R.trackIndex] || Infinity, Math.round(t));
      earned = Math.round(earned * g.rewardMult);
      R.medal = medal;
      lines.push("Your time: " + fmtRaceTime(t) + (medal ? ". " + medal[0].toUpperCase() + medal.slice(1) + " medal!" : ". No medal this time.") + (earned ? " +" + fmtScore(earned) + " credits." : ""));
    }
    p.credits += earned;
    R.earned += earned;
    R.places.push(place);
    var btn = byId("game-cast-btn");
    if (R.mode === "cup" && R.race < 3) {
      R.race++;
      p.cupRun = { cup: R.cup, race: R.race, points: R.points.slice(), names: R.names.slice(), best: R.best.slice() };
      lines.push("Standings: " + rlStandings(R).map(function (s) { return s.name + " " + s.points; }).join(" · ") + ".");
      byId("game-idle-title").textContent = "Race " + R.race + " of 4 done";
      btn.textContent = "Next race";
    } else {
      if (R.mode === "cup") rlCupDone(lines);
      byId("game-idle-title").textContent = R.mode === "cup" ? RL_CUPS[R.cup].name + " complete" : "Time trial done";
      btn.textContent = "See results";
      R.over = true;
    }
    persistCompleted();
    byId("game-idle-text").textContent = lines.join(" ");
    btn.classList.remove("hidden");
    btn.disabled = false;
    rlRenderBoard();
    renderGameHud();
  }

  function rlStandings(R) {
    return R.sim.cars.map(function (c, i) { return { name: c.name, points: R.points[i], best: R.best[i], you: c.you, rival: c.rival }; })
      .sort(function (a, b) { return b.points - a.points || a.best - b.best || (a.you ? -1 : 1); });
  }

  function rlCupDone(lines) {
    var g = game, R = g.rally, p = g.profile;
    var before = rlUnlockList(p);
    var st = rlStandings(R);
    var place = st.findIndex(function (s) { return s.you; }) + 1;
    var cup = RL_CUPS[R.cup];
    R.cupPlace = place;
    p.cupBest[cup.id] = Math.min(p.cupBest[cup.id] || 9, place);
    var rival = st.filter(function (s) { return s.rival; })[0];
    var you = st.filter(function (s) { return s.you; })[0];
    if (you.points > rival.points || (you.points === rival.points && st.indexOf(you) < st.indexOf(rival))) {
      if (!p.rivals[cup.id]) lines.push("You beat your rival, " + cup.rival.name + "!");
      p.rivals[cup.id] = true;
    }
    if (place === 1) {
      var bonus = Math.round(1000 * (R.cup + 1) * g.rewardMult);
      p.credits += bonus;
      R.earned += bonus;
      p.cupsWon[cup.id] = true;
      lines.push("Cup won! +" + fmtScore(bonus) + " credits.");
    }
    lines.push("Final standings: " + st.map(function (s, i) { return ordinal(i + 1) + " " + s.name + " (" + s.points + ")"; }).join(", ") + ".");
    p.cupRun = null;
    rlUnlockList(p).filter(function (x) { return before.indexOf(x) === -1; }).forEach(function (x) { notify("Unlocked: " + x + "!"); });
    checkAchievements("rally");
  }
  function rlUnlockList(p) {
    var out = [];
    RL_CUPS.forEach(function (c, i) { if (!rlCupLock(p, i)) out.push(c.name); });
    return out;
  }

  function rlIdleAction() {
    var g = game, R = g.rally;
    if (!R || g.paused || g.over) return;
    if (R.phase === "grid") { rlStartCountdown(); return; }
    if (R.phase !== "done") return;
    if (R.over) { endGame(false); return; }
    rlSetupRace();
    rlEnterGrid();
  }

  /* ------------------------------- Drawing ------------------------------- */

  function rlRenderArena() {
    var g = game, R = g.rally;
    var tr = R.track, th = tr.theme;
    var arena = byId("game-arena");
    arena.innerHTML = '<p class="arena-name" id="rl-name"></p><p class="arena-sub" id="rl-sub"></p>' +
      '<div class="rl-wrap"><div id="rl-count" class="rl-count hidden"></div></div>' +
      '<div class="rl-gauges"><div><span class="arena-caption">Speed</span><strong id="rl-speed">0</strong></div>' +
      '<div><span class="arena-caption">Lap</span><strong id="rl-lap">1 / ' + R.sim.laps + '</strong></div>' +
      '<div><span class="arena-caption">Position</span><strong id="rl-pos">—</strong></div>' +
      '<div class="rl-nitro"><span class="arena-caption">Nitro</span><div class="rl-meter"><div id="rl-meter-fill"></div></div>' +
      '<button type="button" id="rl-nitro-btn" disabled>Nitro (N)</button></div></div>' +
      '<div id="rl-board" class="game-board rl-board"></div>';
    byId("rl-name").textContent = tr.name;
    byId("rl-sub").textContent = (R.mode === "cup" ? RL_CUPS[R.cup].name + " · race " + (R.race + 1) + " of 4" : "Time trial") + " · " + RL_WEATHER[R.weather].name;
    var svg = svgEl("svg", { viewBox: "0 0 100 60", class: "rl-map rl-" + R.weather, role: "img", "aria-label": "Race track" });
    svg.appendChild(svgEl("rect", { width: 100, height: 60, fill: th.ground, rx: 2 }));
    var pts = tr.pts.map(function (p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }).join(" ");
    svg.appendChild(svgEl("polygon", { points: pts, fill: "none", stroke: "rgba(0,0,0,.25)", "stroke-width": 8.2, "stroke-linejoin": "round" }));
    svg.appendChild(svgEl("polygon", { points: pts, fill: "none", stroke: th.road, "stroke-width": 7, "stroke-linejoin": "round" }));
    // Corner kerbs
    for (var i = 0; i < tr.N; i++) {
      if (!tr.kind[i]) continue;
      var a = tr.pts[i], b = tr.pts[(i + 1) % tr.N];
      svg.appendChild(svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: tr.kind[i] === 2 ? "#e63946" : "#f4a261", "stroke-width": 7.6, opacity: 0.35 }));
    }
    svg.appendChild(svgEl("polygon", { points: pts, fill: "none", stroke: th.line, "stroke-width": 0.35, "stroke-dasharray": "1.6 1.6", opacity: 0.8 }));
    var s = rlLocate(tr, 0);
    var nx = -Math.sin(s.ang), ny = Math.cos(s.ang);
    svg.appendChild(svgEl("line", { x1: s.x - nx * 3, y1: s.y - ny * 3, x2: s.x + nx * 3, y2: s.y + ny * 3, stroke: "#fff", "stroke-width": 1.2, "stroke-dasharray": "0.6 0.6" }));
    var cars = svgEl("g", { id: "rl-cars" });
    R.sim.cars.forEach(function (c, idx) {
      var gEl = svgEl("g", { class: "rl-car" + (c.you ? " you" : "") });
      var body = svgEl("g", { class: "rl-body" }); // spins as one piece (body + windshield)
      gEl.appendChild(body);
      body.appendChild(svgEl("rect", { x: -1.5, y: -0.6, width: 3, height: 1.2, rx: 0.4, fill: c.you ? rlCar(c.carId).color : ["#adb5bd", "#6c757d", "#ced4da", "#495057"][idx % 4], stroke: c.you ? "#fff" : "#222", "stroke-width": c.you ? 0.45 : 0.25 }));
      body.appendChild(svgEl("rect", { x: 0.35, y: -0.45, width: 0.7, height: 0.9, rx: 0.2, fill: "rgba(255,255,255,.75)" }));
      cars.appendChild(gEl);
      c.el = gEl;
    });
    svg.appendChild(cars);
    // Fog / night visibility mask around your car.
    if (R.weather === "fog" || R.weather === "night") {
      var defs = svgEl("defs");
      var mask = svgEl("mask", { id: "rl-vis" });
      mask.appendChild(svgEl("rect", { width: 100, height: 60, fill: "#fff" }));
      var hole = svgEl("circle", { id: "rl-hole", r: R.weather === "fog" ? 17 : 11, fill: "#000" });
      mask.appendChild(hole);
      defs.appendChild(mask);
      svg.appendChild(defs);
      svg.appendChild(svgEl("rect", { width: 100, height: 60, fill: R.weather === "fog" ? "rgba(235,238,242,.86)" : "rgba(5,8,20,.88)", mask: "url(#rl-vis)" }));
    }
    if (R.weather === "rain") svg.appendChild(svgEl("rect", { width: 100, height: 60, class: "rl-rain" }));
    arena.querySelector(".rl-wrap").insertBefore(svg, byId("rl-count"));
    byId("rl-nitro-btn").addEventListener("click", function () { this.blur(); rlNitro(); });
    R.lastBoard = 0;
    rlRenderCars();
    rlRenderBoard();
  }

  function rlRenderCars() {
    var g = game, R = g.rally;
    var tr = R.track;
    R.sim.cars.forEach(function (c) {
      if (!c.el) return;
      var at = rlLocate(tr, Math.max(0, c.d));
      // Four lanes across the road, so cars side by side don't overlap.
      var off = (c.lane - 1.5) * 1.55;
      var x = at.x - Math.sin(at.ang) * off, y = at.y + Math.cos(at.ang) * off;
      c.el.setAttribute("transform", "translate(" + x.toFixed(2) + " " + y.toFixed(2) + ") rotate(" + (at.ang * 180 / Math.PI).toFixed(1) + ")");
      c.el.classList.toggle("spin", c.spin > 0);
      c.el.classList.toggle("nitro", c.nitro > 0);
      if (!c.you && (R.weather === "fog" || R.weather === "night")) {
        var gap = Math.abs(c.d - R.you.d);
        c.el.style.opacity = gap < (R.weather === "fog" ? 140 : 90) ? 1 : 0;
      }
      if (c.you) {
        var hole = byId("rl-hole");
        if (hole) { hole.setAttribute("cx", x.toFixed(2)); hole.setAttribute("cy", y.toFixed(2)); }
      }
    });
    var you = R.you;
    var sp = byId("rl-speed");
    if (sp) {
      var kmh = String(Math.round(you.v * 3.6 * 2.5));
      if (sp.textContent !== kmh) sp.textContent = kmh;
      var lap = Math.min(R.sim.laps, Math.floor(Math.max(0, you.d) / RL_LAP) + 1) + " / " + R.sim.laps;
      if (byId("rl-lap").textContent !== lap) byId("rl-lap").textContent = lap;
      var place = rlOrder(R.sim).indexOf(you) + 1;
      var pos = R.sim.cars.length > 1 ? ordinal(place) + " / " + R.sim.cars.length : "Solo";
      if (byId("rl-pos").textContent !== pos) byId("rl-pos").textContent = pos;
      var fill = byId("rl-meter-fill"), width = (100 * you.meter / you.spec.cap).toFixed(1) + "%";
      if (fill.__width !== width) { fill.__width = width; fill.style.width = width; }
      var nb = byId("rl-nitro-btn");
      var ready = you.meter >= you.spec.cap && you.nitro <= 0 && R.phase === "race";
      if (nb.disabled === ready) nb.disabled = !ready;
      nb.classList.toggle("primary", ready);
    }
    var now = R.sim.clock;
    if (now - R.lastBoard > 300) { R.lastBoard = now; rlRenderBoard(); }
  }

  function rlRenderBoard() {
    var g = game, R = g.rally;
    var box = byId("rl-board");
    if (!box) return;
    box.textContent = "";
    var title = document.createElement("p");
    title.className = "board-title";
    title.textContent = R.mode === "cup" ? "Race order · cup points" : "Time " + fmtRaceTime(R.sim.clock);
    box.appendChild(title);
    var order = rlOrder(R.sim);
    var lead = order[0];
    order.forEach(function (c, i) {
      var row = document.createElement("div");
      row.className = "board-row" + (c.you ? " you" : "");
      var rank = document.createElement("span");
      rank.textContent = String(i + 1);
      row.appendChild(rank);
      var name = document.createElement("span");
      name.className = "board-name";
      name.textContent = c.name + (c.rival ? " (rival)" : "");
      var sc = document.createElement("span");
      sc.className = "board-score";
      var idx = R.sim.cars.indexOf(c);
      var gap = c === lead ? (c.finished ? fmtRaceTime(c.time) : "Leader") : c.finished ? fmtRaceTime(c.time) : "-" + Math.round(lead.d - c.d) + " m";
      sc.textContent = gap + (R.mode === "cup" ? " · " + R.points[idx] + " pts" : "");
      row.appendChild(name);
      row.appendChild(sc);
      box.appendChild(row);
    });
  }

  function rlNitro() {
    var g = game, R = g && g.rally;
    if (!R || g.over || g.paused || g.minigame || R.phase !== "race") return;
    if (rlFireNitro(R.you)) { gameEvent("nitro"); floatText("NITRO!", "dmg-float crit"); }
  }

  /* -------------------------------- Hooks -------------------------------- */

  GAME_HOOKS.rally = {
    // A swerve on the track; harder cups make them more frequent and tougher.
    minigame: {
      level: function () {
        var R = game.rally;
        if (!R || R.phase !== "race") return 0;
        return R.mode === "cup" ? 1 + R.cup : 1;
      },
      result: function (won) {
        var R = game.rally;
        if (won) { R.you.boost = Math.max(R.you.boost, 900); return "Clean swerve: a short boost."; }
        rlOnMiss(R.you, R.weather);
        return "You clip the obstacle and spin out.";
      }
    },
    wide: true,
    noBots: true,
    setupPanel: "game-rally-options",
    shopLabel: "Garage",
    keys: " · N for nitro",
    openShop: function () { openGarage(); },
    setupOpened: function () { rlFillSetup(); },
    readSetup: function () { return { mode: byId("rally-mode").value, track: Number(byId("rally-track").value) || 0 }; },
    setupLines: function () {
      var p = state.gameData.rally;
      return [fmtScore(p.credits) + " credits · driving the " + rlCar(p.car).name + " · " + Object.keys(p.cupsWon).length + " of 5 cups won"];
    },
    tileLines: function () {
      var p = state.gameData.rally;
      var lines = [fmtScore(p.credits) + " credits · " + Object.keys(p.cupsWon).length + " of 5 cups won"];
      if (p.cupRun) lines.push("In progress: " + RL_CUPS[p.cupRun.cup].name + ", race " + (p.cupRun.race + 1));
      return lines;
    },
    begin: function (g, setup) {
      var p = g.profile = state.gameData.rally;
      var opt = setup.extra || {};
      var R = g.rally = { earned: 0, places: [], wins: 0, over: false };
      if (opt.mode === "resume" && p.cupRun) {
        R.mode = "cup"; R.cup = p.cupRun.cup; R.race = p.cupRun.race;
        R.points = p.cupRun.points.slice(); R.names = p.cupRun.names.slice(); R.best = p.cupRun.best.slice();
      } else if (opt.mode === "trial" && isUnlocked("rally", "trials")) {
        R.mode = "trial"; R.trackIndex = rlTrackOpen(p, opt.track) ? opt.track : 0;
        p.lastMode = "trial"; p.lastTrack = R.trackIndex;
      } else {
        var ci = Math.max(0, RL_CUPS.map(function (c) { return c.id; }).indexOf(opt.mode));
        if (rlCupLock(p, ci)) ci = 0;
        R.mode = "cup"; R.cup = ci; R.race = 0; R.points = [0, 0, 0, 0]; R.best = [4, 4, 4, 4];
        var others = seededShuffle(RL_BOT_NAMES, (Date.now() >>> 0)).slice(0, 2);
        R.names = [RL_CUPS[ci].rival.name].concat(others);
        p.lastMode = RL_CUPS[ci].id;
        R.replacesRun = !!p.cupRun; // the old cup is only replaced once this cup's first race is done
      }
      rlSetupRace();
    },
    start: function () { rlEnterGrid(); },
    renderArena: function () { rlRenderArena(); },
    idleAction: rlIdleAction,
    key: function (k, event) {
      var R = game.rally;
      if (event && event.target && event.target.tagName === "BUTTON" && event.target.id !== "game-cast-btn" && k !== "n") return false;
      if (k === "n") { rlNitro(); return true; }
      if (R && (R.phase === "grid" || R.phase === "done") && (k === " " || k === "enter")) { rlIdleAction(); return true; }
      return false;
    },
    tick: rlTick,
    hud: function (stats) {
      var g = game, R = g.rally;
      if (R.mode === "cup") stats.appendChild(hudStat("Race", (R.race + 1) + " / 4"));
      stats.appendChild(hudStat("Credits", fmtScore(g.profile.credits)));
    },
    levelStep: function () {
      var R = game.rally;
      return Math.min(2, Math.floor(3 * Math.max(0, R.you.d) / (RL_LAP * R.sim.laps)));
    },
    thinkAdjust: function () {
      var R = game.rally;
      if (!R || !R.you) return 0;
      var kind = rlLocate(R.track, R.you.d).kind;
      return kind === 2 ? -1500 : kind === 1 ? -1000 : 0;
    },
    correct: function (c, speed) {
      var g = game, R = g.rally;
      var kind = rlOnCorrect(R.you, R.track, speed, g.combo, g.avgWords);
      return { points: 0, message: kind === 0 && speed > 0.5 ? "Fast answer on the straight: long boost!" : "Boost!" };
    },
    wrong: function (late) {
      var R = game.rally;
      rlOnMiss(R.you, R.weather);
      return (late ? "Too slow, you spun out! " : "You spun out! ");
    },
    afterFeedback: function () { return game.rally.phase !== "race"; },
    quitHint: "Finished cup races stay saved; this race will start over next time.",
    resultTitle: function (g) {
      var R = g.rally;
      if (R.mode === "trial") return ": time trial";
      return R.cupPlace ? ": " + RL_CUPS[R.cup].name + " " + (R.cupPlace === 1 ? "won!" : "complete") : ": race over";
    },
    resultRows: function (g) {
      var R = g.rally;
      var rows = [];
      if (R.mode === "trial") {
        rows.push(["Track", R.track.name], ["Time", R.you.finished ? fmtRaceTime(R.you.time) : "—"], ["Medal", R.medal ? R.medal[0].toUpperCase() + R.medal.slice(1) : "None"]);
      } else {
        rows.push(["Cup", RL_CUPS[R.cup].name], ["Final place", R.cupPlace ? ordinal(R.cupPlace) : "—"], ["Race finishes", R.places.map(ordinal).join(", ") || "—"]);
      }
      rows.push(["Credits earned", fmtScore(R.earned)], ["Accuracy", g.answered ? Math.round(100 * g.correct / g.answered) + "%" : "—"]);
      return rows;
    }
  };

