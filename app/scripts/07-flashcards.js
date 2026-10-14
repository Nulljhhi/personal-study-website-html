  /* ---------------------------- Flashcard ---------------------------- */

  /* opts: { order: "seeded" | "bank", skipCompleted } */
  function startFlashcards(seed, opts) {
    if (!state.unit || state.unit.questions.length === 0) return;
    opts = opts || {};
    var pool = state.unit.questions;
    if (opts.skipCompleted) {
      pool = pool.filter(function (q) { return !isCompleted(q); });
      if (!pool.length) { notifyError("Every question is completed. Press Reset completed on the Home screen, or turn off Skip completed questions."); return; }
    }
    var effectiveSeed = typeof seed === "number" ? seed : Date.now();
    var bankOrder = opts.order === "bank";
    state.flashcards.order = bankOrder ? pool.slice() : seededShuffle(pool, effectiveSeed);
    state.flashcards.seed = bankOrder ? null : effectiveSeed;
    state.flashcards.index = 0;
    state.flashcards.flipped = false;
    state.flashcards.seen = {};
    renderFlashcard();
    showScreen("flashcard");
  }

  function renderFlashcardProgress() {
    var f = state.flashcards;
    var total = f.order.length;
    f.seen = f.seen || {};
    f.seen[f.index] = true;
    var seen = Object.keys(f.seen).length;
    byId("fc-show-progress").checked = state.showProgress;
    byId("fc-show-seed").checked = state.showSeed;
    byId("fc-progress").classList.toggle("hidden", !state.showProgress);
    byId("fc-meta").classList.toggle("hidden", !state.showSeed);
    byId("fc-progress-text").textContent = "Card " + (f.index + 1) + " of " + total + " · " + (total - seen) + " not seen yet";
    byId("fc-progress-bar").max = total || 1;
    byId("fc-progress-bar").value = seen;
    byId("fc-meta").textContent = "Flashcards · " + (f.seed === null || f.seed === undefined ? "Question bank order" : "Seed: " + f.seed);
  }

  function renderFlashcard() {
    var f = state.flashcards;
    var card = f.order[f.index];
    var questionEl = byId("card-question");
    var answerEl = byId("card-answer");
    if (questionEl) questionEl.textContent = card ? card.question : "";
    if (answerEl) answerEl.textContent = card ? card.answer : "";
    // A picture shows with the question; a hotspot card's back shows it with the spot circled.
    var fig = byId("card-figure");
    if (fig) {
      fig.textContent = "";
      var withImg = !!(card && card.image) && (!f.flipped || !!card.hotspot);
      fig.classList.toggle("hidden", !withImg);
      byId("flashcard-card").classList.toggle("with-image", withImg);
      if (withImg) {
        if (card.hotspot && f.flipped) fig.appendChild(hotspotAnswerView(card).firstChild);
        else fig.appendChild(questionImage(card));
        if (f.flipped && card.hotspot && !card.answer && answerEl) answerEl.textContent = "The answer is circled.";
      }
    }
    if (questionEl) questionEl.classList.toggle("hidden", f.flipped);
    if (answerEl) answerEl.classList.toggle("hidden", !f.flipped);
    var prev = byId("prev-card-btn");
    var next = byId("next-card-btn");
    if (prev) prev.disabled = f.index <= 0;
    if (next) next.disabled = f.index >= f.order.length - 1;
    renderFlashcardProgress();
  }

  function flipFlashcard() {
    state.flashcards.flipped = !state.flashcards.flipped;
    renderFlashcard();
  }

  function goToPrevCard() {
    var f = state.flashcards;
    if (f.index > 0) {
      f.index--;
      f.flipped = false;
      renderFlashcard();
    }
  }

  function goToNextCard() {
    var f = state.flashcards;
    if (f.index < f.order.length - 1) {
      f.index++;
      f.flipped = false;
      renderFlashcard();
    }
  }

