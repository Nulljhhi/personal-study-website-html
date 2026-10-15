  /* ------------ Matching / Quiz / Exam flows (C2) ------------
     startMatch / shuffleBoard / startQuiz / startExam plus their
     renderers and click handlers. The exported names and the
     state.match / state.quiz shapes are part of the contract. */

  var RED_FLASH_MS = 500;
  var MATCH_PAIRS_NEEDED = { 4: 8, 6: 18, 8: 32 };
  /* Monotonic token: rebuilding the board or starting a new red flash
     invalidates every pending flash timeout, so a stale callback can
     never clear the lock of a freshly built board. */
  var matchFlashSeq = 0;
  /* Review pagination index (the review always starts at page 0). */
  var reviewIndex = 0;

  function freshSeed(seed) {
    return typeof seed === "number" ? seed : Date.now();
  }

  /* ---------------------------- Matching ---------------------------- */

  /* Selects the pairs, builds the tiles, resets state.match, and
     renders the board (without changing screens). */
  function buildMatchBoard(size, seed) {
    var unit = state.unit;
    if (!unit || unit.questions.length === 0) return;
    matchFlashSeq++;
    var pairsNeeded = MATCH_PAIRS_NEEDED[size] || Math.floor((size * size) / 2);
    // Hotspot questions have no answer text to put on a tile.
    var all = matchableQuestions(unit);
    var pool = all;
    if (state.match.skipCompleted) pool = pool.filter(function (q) { return !isCompleted(q); });
    if (!pool.length) pool = all;
    var pairs = selectFirstN(pool, pairsNeeded, seed);
    var tiles = buildBoardTiles(pairs, seed);
    state.match.size = size;
    state.match.seed = seed;
    state.match.pairs = pairs;
    state.match.tiles = tiles;
    state.match.selectedTile = null;
    state.match.matchedPairs = [];
    state.match.locked = false;
    state.match.done = false;
    renderMatchBoard();
  }

  function renderMatchBoard() {
    var m = state.match;
    byId("screen-match-board").dataset.size = String(m.size);
    var label = byId("match-size-label");
    if (label) label.textContent = m.size + "\u00D7" + m.size;
    renderMatchMeta();
    var grid = byId("match-grid");
    if (!grid) return;
    grid.textContent = "";
    /* Column-major fill: rows are fixed by the board size, the tiles
       flow top to bottom then into the next column. A partial board
       simply renders fewer columns. */
    var columns = Math.max(1, Math.ceil(m.tiles.length / m.size));
    grid.style.setProperty("--board-min-width", (columns * 140 + (columns - 1) * 12) + "px");
    grid.style.gridAutoFlow = "column";
    grid.style.gridTemplateRows = "repeat(" + m.size + ", 1fr)";
    grid.style.gridTemplateColumns = "repeat(" + columns + ", minmax(0, 1fr))";
    grid.style.gridAutoColumns = "1fr";
    for (var i = 0; i < m.tiles.length; i++) {
      var tile = m.tiles[i];
      var el = document.createElement("button");
      el.type = "button";
      el.className = "tile";
      el.dataset.pairId = String(tile.pairId);
      el.dataset.kind = tile.kind;
      el.textContent = tile.text;
      grid.appendChild(el);
    }
    var complete = byId("board-complete");
    if (complete) complete.classList.add("hidden");
  }

  function renderMatchMeta() {
    var m = state.match;
    byId("match-show-seed").checked = !!state.matchShowSeed;
    byId("match-meta").classList.toggle("hidden", !state.matchShowSeed);
    byId("match-meta").textContent = "Seed: " + m.seed + (m.skipCompleted ? " · skipping completed questions" : "");
  }

  function matchableQuestions(unit) { return unit.questions.filter(function (q) { return !q.hotspot; }); }

  function startMatch(size, seed) {
    if (!state.unit || state.unit.questions.length === 0) return;
    if (!matchableQuestions(state.unit).length) { notifyError("Matching Tiles needs questions with written answers; this bank only has hotspot questions."); return; }
    state.match.skipCompleted = !!(byId("match-skip-completed") && byId("match-skip-completed").checked);
    if (state.match.skipCompleted && !matchableQuestions(state.unit).some(function (q) { return !isCompleted(q); })) {
      notifyError("Every question is completed. Press Reset completed on the Home screen, or turn off Skip completed questions.");
      return;
    }
    buildMatchBoard(size, freshSeed(seed));
    showScreen("match-board");
  }

  function shuffleBoard(seed) {
    if (!state.unit || !matchableQuestions(state.unit).length) return;
    var size = state.match.size || 4;
    buildMatchBoard(size, freshSeed(seed));
  }

  /* Tile click logic: select, deselect, match a correct pair (both
     tiles stay in the DOM but become invisible), or flash a wrong
     pair red and lock the board until the flash clears. */
  /* A question tile matches its own answer tile, or any answer tile with
     the same text (two questions can share an answer, and the tiles are
     then indistinguishable). */
  function tilesMatch(a, b) {
    if (String(a.dataset.pairId) === String(b.dataset.pairId)) return true;
    var questionTile = a.dataset.kind === "question" ? a : b;
    var answerTile = questionTile === a ? b : a;
    var pair = null;
    for (var i = 0; i < state.match.pairs.length; i++) {
      if (String(state.match.pairs[i].id) === String(questionTile.dataset.pairId)) pair = state.match.pairs[i];
    }
    return !!pair && normalizeAnswer(pair.answer) === normalizeAnswer(answerTile.textContent);
  }

  function onMatchGridClick(event) {
    var m = state.match;
    if (m.locked) return;
    var tile = event.target && event.target.closest ? event.target.closest(".tile") : null;
    if (!tile) return;
    if (tile.classList.contains("matched")) return;
    if (!m.selectedTile) {
      tile.classList.add("selected");
      m.selectedTile = tile;
      return;
    }
    if (m.selectedTile === tile) {
      tile.classList.remove("selected");
      m.selectedTile = null;
      return;
    }
    var first = m.selectedTile;
    var second = tile;
    m.selectedTile = null;
    if (first.dataset.kind !== second.dataset.kind && tilesMatch(first, second)) {
      first.classList.remove("selected");
      second.classList.remove("selected");
      first.classList.add("matched");
      second.classList.add("matched");
      m.matchedPairs.push(first.dataset.pairId);
      if (m.pairs.length > 0 && m.matchedPairs.length >= m.pairs.length) {
        m.done = true;
        var complete = byId("board-complete");
        if (complete) complete.classList.remove("hidden");
      }
      return;
    }
    first.classList.add("wrong");
    second.classList.add("wrong");
    m.locked = true;
    var seq = ++matchFlashSeq;
    setTimeout(function () {
      if (seq !== matchFlashSeq) return;
      first.classList.remove("wrong");
      first.classList.remove("selected");
      second.classList.remove("wrong");
      second.classList.remove("selected");
      m.locked = false;
    }, RED_FLASH_MS);
  }

