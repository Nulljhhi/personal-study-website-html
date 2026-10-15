
  /* =========================== Skill ratings ===========================
     Your rating in each game is a guess at how you actually play, built
     from two things the game measures on every answer:
       accuracy  how often you're right
       pace      how long you take, as a share of the time it takes to
                 read that question plus the base thinking time (so long
                 and short questions count the same)
     One curve turns a rating into an accuracy and a pace, and back, so a
     bot rated 1100 answers about as often right, and about as fast, as a
     player rated 1100.

     Your first game in each mode starts from a neutral guess and the bots
     re-tune themselves as soon as you've answered a few questions. After
     every finished run the rating moves part of the way toward how that
     run went, so it keeps following you as you improve (or have an off
     day) without jumping around. */

  var SKILL_PRIOR_N = 6;        // answers before a first guess trusts you over 1000
  var SKILL_STEP = 0.35;        // share of the gap closed after each run
  var SKILL_MAX_STEP = 180;     // most a single run can move the rating

  function skillAcc(rating) { return clamp(0.70 + (rating - 1000) / 1000, 0.30, 0.98); }
  function skillPace(rating) { return clamp(0.60 - (rating - 1000) / 1500, 0.10, 1.20); }
  function ratingFromSkill(acc, pace) {
    var fromAcc = 1000 + 1000 * (acc - 0.70);
    var fromPace = 1000 + 1500 * (0.60 - pace);
    return clamp(Math.round(0.6 * fromAcc + 0.4 * fromPace), 100, 3000);
  }


  /* Your measured play in a game: { acc, pace } (null before your first
     finished run there). */
  function storedSkill(id) {
    var s = state.gameData.skill && state.gameData.skill[id];
    return s && isFinite(s.acc) && isFinite(s.pace) ? s : null;
  }
  var NEUTRAL_SKILL = { acc: skillAcc(1000), pace: skillPace(1000) };

  /* One answer (slot null = the timer ran out). Called for every game, with
     or without bots, so each game's rating reflects how you play it. */
  function recordSkill(c, right, timedOut) {
    var g = game;
    if (!g || !c) return;
    var base = readingMs(c.words || g.avgWords) + BASE_THINK_MS;
    var spent = timedOut ? Math.max(c.limit || base, base) : c.spent;
    var pace = clamp(spent / base, 0.03, 1.6);
    var s = g.skillRun = g.skillRun || { n: 0, right: 0, pace: 0 };
    s.n++;
    if (right) s.right++;
    s.pace += pace;
    // First game in this mode: let the bots catch up to you as you go.
    if (g.botsOn && !storedSkill(g.id) && !g.leagueBase) retuneBots(liveSkill(g));
  }

  /* The run so far, pulled toward what we knew before (or a neutral
     player) until there's enough of it. */
  function liveSkill(g) {
    var s = g.skillRun, prior = storedSkill(g.id) || NEUTRAL_SKILL, n = SKILL_PRIOR_N;
    if (!s || !s.n) return { acc: prior.acc, pace: prior.pace };
    return { acc: (s.right + prior.acc * n) / (s.n + n), pace: (s.pace + prior.pace * n) / (s.n + n) };
  }

  /* A bot copies a measured accuracy and pace, a step better (+1), even
     (0) or a step worse (-1). Accuracy and speed are matched separately,
     so a fast but careless player meets fast, careless bots. */
  function botSkillFor(skill, step) {
    return { acc: clamp(skill.acc + 0.04 * step, 0.25, 0.97), pace: clamp(skill.pace * (1 - 0.12 * step), 0.05, 1.5) };
  }
  function applyBotSkill(b, skill) {
    b.acc = skill.acc;
    b.pace = skill.pace;
    b.rating = ratingFromSkill(skill.acc, skill.pace);
  }
  var RIVAL_STEPS = [1, 0, -1];

  function retuneBots(skill) {
    var g = game;
    g.bots.forEach(function (b, i) {
      applyBotSkill(b, botSkillFor(skill, RIVAL_STEPS[i]));
      if (b.mod && b.mod.forceHard) b.acc *= 0.9;
    });
  }

  /* After a finished run: your measured accuracy and pace move part of the
     way toward this run's (all the way, weighted by length, on a first
     run), and the rating is read off them. Returns the numbers for the
     results screen. */
  function settleSkill(g) {
    var before = playerRating(g.id);
    var s = g.skillRun;
    if (!s || s.n < 3) return { before: before, after: before, changed: false, acc: null, pace: null };
    var acc = s.right / s.n, pace = s.pace / s.n;
    var prev = storedSkill(g.id);
    var next = prev
      ? { acc: prev.acc + (acc - prev.acc) * SKILL_STEP, pace: prev.pace + (pace - prev.pace) * SKILL_STEP }
      : liveSkill(g);
    var after = ratingFromSkill(next.acc, next.pace);
    if (prev) after = clamp(after, before - SKILL_MAX_STEP, before + SKILL_MAX_STEP);
    if (!g.clean) {
      state.gameData.ratings[g.id] = Math.round(after);
      state.gameData.skill[g.id] = { acc: next.acc, pace: next.pace, n: Math.min(10000, (prev ? prev.n : 0) + s.n) };
    }
    return { before: Math.round(before), after: Math.round(after), changed: !g.clean, acc: acc, pace: pace };
  }

  function parseSkill(src) {
    var out = {};
    if (!src || typeof src !== "object") return out;
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (!hasOwn(GAMES, k) || !v || typeof v !== "object") return;
      var acc = Number(v.acc), pace = Number(v.pace), n = Number(v.n);
      if (!isFinite(acc) || !isFinite(pace) || !isFinite(n)) return;
      out[k] = { acc: clamp(acc, 0, 1), pace: clamp(pace, 0, 2), n: clamp(Math.floor(n), 0, 10000) };
    });
    return out;
  }
