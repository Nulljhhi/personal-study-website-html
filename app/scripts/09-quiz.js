  /* ------------------------- Quiz / Exam ------------------------- */

  /* Shared engine behind startQuiz and startExam: seeded question
     order, true/false assignment, and per-question derived seeds.
     Choices are built exactly once here and stay stable while the
     user navigates back and forth. */
  function beginQuizExam(mode, opts, seed) {
    var unit = state.unit;
    if (!unit || unit.questions.length === 0) return;
    var options = opts || {};
    var effectiveSeed = freshSeed(seed);
    var pool = unit.questions;
    var poolIds = null;
    if (mode === "quiz" && Array.isArray(options.poolIds)) {
      pool = options.poolIds.map(function (id) { return unit.questions[id]; }).filter(Boolean);
      poolIds = pool.map(function (q) { return q.id; });
      if (pool.length === 0) return;
    }
    var total = pool.length;
    var count = total;
    if (mode !== "exam") {
      count = Math.floor(Number(options.count));
      if (!isFinite(count)) count = total;
      count = Math.min(Math.max(count, 1), total);
    }
    var difficulty = options.difficulty === "medium" || options.difficulty === "hard"
      ? options.difficulty
      : "easy";
    var rawTypes = options.types || [];
    var hasMc = false;
    var hasTf = false;
    for (var t = 0; t < rawTypes.length; t++) {
      if (rawTypes[t] === "mc") hasMc = true;
      if (rawTypes[t] === "tf") hasTf = true;
    }
    var types = [];
    if (hasMc) types.push("mc");
    if (hasTf) types.push("tf");
    var order = selectFirstN(pool, count, effectiveSeed);
    var tfFlags = assignTrueFalse(order.length, types);
    var choices = [];
    var answers = [];
    for (var i = 0; i < order.length; i++) {
      var derived = deriveSeed(effectiveSeed, i);
      // A hotspot question is always answered on its picture.
      if (order[i].hotspot) { tfFlags[i] = false; choices.push({ hotspot: true }); answers.push(null); continue; }
      choices.push(tfFlags[i]
        ? buildTfCandidate(unit, order[i], difficulty, derived, options.legacyChoices)
        : buildMcChoices(unit, order[i], difficulty, derived, options.legacyChoices));
      answers.push(null);
    }
    state.quiz.mode = mode;
    state.quiz.seed = effectiveSeed;
    state.quiz.options = { count: count, difficulty: difficulty, types: types };
    if (mode === "quiz" && options.instantFeedback === true) state.quiz.options.instantFeedback = true;
    state.quiz.poolIds = poolIds;
    state.quiz.markedThisAttempt = 0;
    state.quiz.instantMarked = {};
    state.quiz.checkpointId = null;
    state.quiz.order = order;
    state.quiz.tfFlags = tfFlags;
    state.quiz.choices = choices;
    state.quiz.answers = answers;
    state.quiz.index = 0;
    state.quiz.submitted = false;
    setSessionStatus("");
    reviewIndex = 0;
    hideSubmitModal();
    renderQuizQuestion();
    showScreen("quiz");
  }

  function startQuiz(opts, seed) {
    beginQuizExam("quiz", opts, seed);
  }

  function startExam(opts, seed) {
    beginQuizExam("exam", opts, seed);
  }

  function renderQuizQuestion() {
    var q = state.quiz;
    renderQuizProgress();
    var question = q.order[q.index];
    if (!question) return;
    var tf = !!q.tfFlags[q.index];
    var data = q.choices[q.index];
    var questionEl = byId("quiz-question-text");
    if (questionEl) questionEl.textContent = question.question;
    var candidateEl = byId("tf-candidate");
    if (candidateEl) {
      candidateEl.classList.toggle("hidden", !tf);
      candidateEl.textContent = tf && data ? data.candidate : "";
    }
    var hs = !!question.hotspot;
    var at = q.index, picked = parseHotspotAnswer(q.answers[at]);
    var locked = hs && instantFeedbackOn() && q.answers[at] != null;
    renderQuestionFigure("quiz", question, {
      pick: picked, locked: locked, reveal: locked,
      onPick: function (x, y) { pickQuizHotspot(at, x, y); }
    });
    var container = byId("quiz-choices");
    if (container) container.classList.toggle("hs-hidden", hs);
    if (container && hs) container.textContent = "";
    if (container && !hs) {
      container.textContent = "";
      var slots = tf ? ["true", "false"] : ["a", "b", "c", "d"];
      for (var s = 0; s < slots.length; s++) {
        var slot = slots[s];
        // Guard for old checkpoints with fewer than three wrong answers:
        // never show a blank option.
        if (!tf && !data[slot]) continue;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "choice";
        btn.dataset.slot = slot;
        btn.textContent = tf ? (slot === "true" ? "True" : "False") : data[slot];
        if (q.answers[q.index] === slot) btn.classList.add("selected");
        btn.setAttribute("aria-pressed", String(q.answers[q.index] === slot));
        container.appendChild(btn);
      }
    }
    renderInstantFeedback();
    var prev = byId("quiz-prev-btn");
    var next = byId("quiz-next-btn");
    if (prev) prev.disabled = q.index <= 0;
    if (next) next.disabled = q.index >= q.order.length - 1;
  }

  /* ----------------------------- Instant feedback -----------------------------
     Quiz option: once a question is answered, show right away whether it
     was right (same green/red outlines as the review page) and lock it. */
  function instantFeedbackOn() {
    return state.quiz.mode === "quiz" && !!(state.quiz.options && state.quiz.options.instantFeedback);
  }

  function correctSlotAt(i) {
    var data = state.quiz.choices[i];
    if (!data || data.hotspot) return null;
    return state.quiz.tfFlags[i] ? (data.isReal ? "true" : "false") : data.correctSlot;
  }

  /* Is the answer given to question i right? (A hotspot pick is right when
     it lands inside the spot's circle.) */
  function quizAnswerRight(i) {
    var q = state.quiz, a = q.answers[i];
    if (a === null || a === undefined) return false;
    var question = q.order[i];
    if (question && question.hotspot) return hotspotAnswerRight(question, a);
    return a === correctSlotAt(i);
  }

  function correctCount() {
    var q = state.quiz;
    var n = 0;
    for (var i = 0; i < q.order.length; i++) if (quizAnswerRight(i)) n++;
    return n;
  }

  function pickQuizHotspot(i, x, y) {
    var q = state.quiz;
    if (q.index !== i || !q.order[i] || !q.order[i].hotspot) return;
    if (instantFeedbackOn() && q.answers[i] != null) return; // first pick is final
    q.answers[i] = hotspotAnswer(x, y);
    if (instantFeedbackOn()) markInstantCompleted(i);
    setSessionStatus("");
    renderQuizProgress();
    if (instantFeedbackOn()) renderQuizQuestion();
  }

  /* With instant feedback on, a correct answer is marked completed and
     saved straight away instead of waiting for Submit. */
  function markInstantCompleted(i) {
    var q = state.quiz;
    var question = q.order[i];
    if (!question || !state.unit || !quizAnswerRight(i)) return;
    if (!markCompleted(question)) return;
    q.markedThisAttempt = (q.markedThisAttempt || 0) + 1;
    q.instantMarked = q.instantMarked || {};
    q.instantMarked[i] = true;
    persistCompleted();
    renderCompletedMarks(question);
  }

  function renderInstantFeedback() {
    var q = state.quiz;
    var container = byId("quiz-choices");
    var line = byId("quiz-feedback");
    var answer = q.answers[q.index];
    var show = instantFeedbackOn() && answer !== null && answer !== undefined;
    if (container) container.classList.toggle("locked", show);
    if (line) {
      line.textContent = "";
      line.classList.remove("right", "wrong");
    }
    if (!show || !container) return;
    if (q.order[q.index] && q.order[q.index].hotspot) {
      container.classList.remove("locked");
      var hit = quizAnswerRight(q.index);
      var done = hit && q.instantMarked && q.instantMarked[q.index];
      if (line) {
        line.classList.add(hit ? "right" : "wrong");
        line.textContent = hit ? (done ? "Correct! Marked completed." : "Correct!") : "Not quite. The right spot is circled.";
      }
      return;
    }
    var correct = correctSlotAt(q.index);
    var buttons = container.querySelectorAll("button.choice");
    var correctText = "";
    for (var i = 0; i < buttons.length; i++) {
      var slot = buttons[i].dataset.slot;
      if (slot === correct) {
        buttons[i].classList.add("correct-outline");
        correctText = buttons[i].textContent;
      } else if (slot === answer) {
        buttons[i].classList.add("picked-outline");
      }
    }
    if (line) {
      var right = answer === correct;
      line.classList.add(right ? "right" : "wrong");
      var marked = right && q.instantMarked && q.instantMarked[q.index];
      line.textContent = right ? (marked ? "Correct! Marked completed." : "Correct!")
        : "Not quite. " + missExplanation(q.order[q.index], !!q.tfFlags[q.index], q.choices[q.index], correctText);
    }
  }

  function onQuizChoicesClick(event) {
    var container = byId("quiz-choices");
    var btn = event.target && event.target.closest ? event.target.closest("button.choice") : null;
    if (!btn || !container || btn.parentElement !== container) return;
    var slot = btn.dataset.slot;
    if (!slot) return;
    var current = state.quiz.answers[state.quiz.index];
    if (instantFeedbackOn() && current !== null && current !== undefined) return; // first pick is final
    state.quiz.answers[state.quiz.index] = slot;
    if (instantFeedbackOn()) markInstantCompleted(state.quiz.index);
    setSessionStatus("");
    renderQuizProgress();
    var buttons = container.querySelectorAll("button.choice");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("selected", buttons[i] === btn);
      buttons[i].setAttribute("aria-pressed", String(buttons[i] === btn));
    }
    if (instantFeedbackOn()) renderInstantFeedback();
  }

  function goToPrevQuizQuestion() {
    if (state.quiz.index > 0) {
      state.quiz.index--;
      renderQuizQuestion();
    }
  }

  function goToNextQuizQuestion() {
    if (state.quiz.index < state.quiz.order.length - 1) {
      state.quiz.index++;
      renderQuizQuestion();
    }
  }

  /* Saved files are self-contained: the original bank plus the seed and
     options reproduce the exact question order and answer choices. */
  function renderQuizProgress() {
    var q = state.quiz;
    var answered = q.answers.filter(function (answer) { return answer !== null && answer !== undefined; }).length;
    var total = q.order.length;
    byId("show-progress").checked = state.showProgress;
    byId("show-seed").checked = state.showSeed;
    byId("session-meta").classList.toggle("hidden", !state.showSeed);
    byId("session-panel").classList.toggle("hidden", !state.sessionExpanded);
    var toggle = byId("session-toggle-btn");
    var toggleLabel = state.sessionExpanded ? "Hide study controls" : "Show study controls";
    toggle.textContent = state.sessionExpanded ? "\u2227" : "\u2228";
    toggle.setAttribute("aria-expanded", String(state.sessionExpanded));
    toggle.setAttribute("aria-label", toggleLabel);
    toggle.setAttribute("title", toggleLabel);
    byId("quiz-progress").classList.toggle("hidden", !state.showProgress);
    byId("quiz-progress-text").textContent = answered + " of " + total + " answered · " + (total - answered) + " left" +
      (instantFeedbackOn() ? " · " + correctCount() + " correct" : "");
    byId("quiz-progress-bar").max = total || 1;
    byId("quiz-progress-bar").value = answered;
    byId("session-meta").textContent = (q.mode === "exam" ? "Exam" : "Quiz") + " · Seed: " + q.seed;
  }

  function setSessionStatus(message, isError) {
    if (!message) return;
    if (isError === true) notifyError(message); else notify(message);
  }

  function newCheckpointId() {
    return "checkpoint-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
  }

  function saveQuizProgress() {
    var q = state.quiz;
    if (!q.order.length || !state.unitText) return;
    var url;
    var anchor;
    var answered = q.answers.filter(function (a) { return a !== null && a !== undefined; }).length;
    // One checkpoint per attempt: saving again (or saving a resumed
    // attempt) updates the same checkpoint instead of adding a new one.
    if (hasDesktop && !q.checkpointId) q.checkpointId = newCheckpointId();
    var snapshot = {
      format: "study-website-session", version: 1,
      savedAt: new Date().toISOString(), unitTitle: state.unit ? state.unit.unitTitle : "",
      bankId: state.bankId || undefined,
      answeredCount: answered, totalCount: q.order.length,
      unitText: state.unitText,
      mode: q.mode, seed: q.seed, options: q.options, poolIds: q.poolIds,
      // The exact questions and choices, so resuming never depends on
      // how choices happen to be generated in a later version.
      generator: 3,
      orderIds: q.order.map(function (item) { return item.id; }),
      tfFlags: q.tfFlags.slice(),
      choices: q.choices,
      answers: q.answers, index: q.index, showProgress: state.showProgress,
      showSeed: state.showSeed, sessionExpanded: state.sessionExpanded
    };
    if (hasDesktop) {
      var id = q.checkpointId;
      var json = JSON.stringify(snapshot);
      if (json.length > MAX_JSON_BYTES) { setSessionStatus("Could not save progress: this bank and its pictures are too large for a checkpoint.", true); return; }
      retryableWrite("checkpoint:" + id, function () { return desktopCall("save_checkpoint", { id: id, json: json }); })
        .then(function () {
          setSessionStatus("Progress saved (" + answered + " of " + q.order.length + " answered).");
        })
        .catch(function (err) { setSessionStatus("Could not save progress: " + err.message, true); });
      return;
    }
    try {
      var blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      // Only offer a file that Resume saved progress will accept again.
      if (blob.size > MAX_JSON_BYTES) { setSessionStatus("Could not save progress: this bank and its pictures are too large for a progress file.", true); return; }
      url = URL.createObjectURL(blob);
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = q.mode + "-seed-" + q.seed + "-progress.json";
      document.body.appendChild(anchor);
      anchor.click();
      setSessionStatus("Progress saved. Use Resume saved progress to continue from this point.");
    } catch (err) {
      setSessionStatus("Could not save progress. Please try again.", true);
    } finally {
      if (anchor) anchor.remove();
      if (url) setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
  }

  /* The one validator for saved sessions, used both to resume and to
     decide which checkpoints the list offers. Throws if anything is off;
     otherwise returns everything needed to restore. */
  function validateSession(text) {
    var saved = JSON.parse(text);
    function requireValid(condition) {
      if (!condition) throw new Error("This is not a valid Study Website progress file.");
    }
    requireValid(saved && saved.format === "study-website-session" && saved.version === 1);
    requireValid(saved.mode === "quiz" || saved.mode === "exam");
    requireValid(Number.isSafeInteger(saved.seed) && saved.seed >= 0);
    var unit = parseUnitFile(saved.unitText);
    var opts = saved.options;
    requireValid(opts && Number.isInteger(opts.count) && opts.count >= 1 && opts.count <= unit.questions.length);
    requireValid(saved.mode !== "exam" || opts.count === unit.questions.length);
    requireValid(["easy", "medium", "hard"].indexOf(opts.difficulty) !== -1);
    requireValid(Array.isArray(opts.types) && opts.types.length >= 1 && opts.types.length <= 2 &&
      opts.types.every(function (type) { return type === "mc" || type === "tf"; }) &&
      new Set(opts.types).size === opts.types.length);
    requireValid(Array.isArray(saved.answers) && saved.answers.length === opts.count);
    requireValid(Number.isInteger(saved.index) && saved.index >= 0 && saved.index < opts.count);
    requireValid(typeof saved.showProgress === "boolean");
    requireValid(saved.showSeed === undefined || typeof saved.showSeed === "boolean");
    requireValid(saved.sessionExpanded === undefined || typeof saved.sessionExpanded === "boolean");
    requireValid(saved.bankId === undefined || (typeof saved.bankId === "string" && /^bank-[0-9a-f]{1,32}$/.test(saved.bankId)));
    // Quizzes started with "Skip completed questions" save the exact pool
    // they drew from, so the same questions come back even if the
    // completed list has changed since.
    var poolIds = null;
    if (saved.poolIds !== undefined && saved.poolIds !== null) {
      requireValid(saved.mode === "quiz" && Array.isArray(saved.poolIds) &&
        saved.poolIds.length >= opts.count &&
        saved.poolIds.every(function (id) { return Number.isInteger(id) && id >= 0 && id < unit.questions.length; }) &&
        new Set(saved.poolIds).size === saved.poolIds.length);
      poolIds = saved.poolIds.slice();
    }
    // Checkpoints from v1.2.1 and earlier don't store their choices: those
    // are rebuilt with the original generator so saved answers still line up.
    var stored = saved.choices !== undefined;
    if (stored) {
      requireValid(Array.isArray(saved.orderIds) && saved.orderIds.length === opts.count &&
        saved.orderIds.every(function (id) { return Number.isInteger(id) && id >= 0 && id < unit.questions.length; }) &&
        new Set(saved.orderIds).size === saved.orderIds.length);
      requireValid(Array.isArray(saved.tfFlags) && saved.tfFlags.length === opts.count &&
        saved.tfFlags.every(function (f) { return typeof f === "boolean"; }));
      requireValid(Array.isArray(saved.choices) && saved.choices.length === opts.count &&
        saved.choices.every(function (c, i) {
          if (!c || typeof c !== "object") return false;
          var hq = unit.questions[saved.orderIds[i]];
          if (hq.hotspot || c.hotspot) return !!hq.hotspot && c.hotspot === true && !saved.tfFlags[i];
          if (saved.tfFlags[i]) return typeof c.candidate === "string" && typeof c.isReal === "boolean";
          return ["a", "b", "c", "d"].every(function (k) { return typeof c[k] === "string"; }) &&
            ["a", "b", "c", "d"].indexOf(c.correctSlot) !== -1;
        }));
    }
    var flags = stored ? saved.tfFlags : assignTrueFalse(opts.count, opts.types);
    requireValid(saved.answers.every(function (answer, i) {
      if (answer === null) return true;
      if (stored && saved.choices[i].hotspot) return parseHotspotAnswer(answer) !== null;
      if ((flags[i] ? ["true", "false"] : ["a", "b", "c", "d"]).indexOf(answer) === -1) return false;
      // The picked option has to be one that's shown (older checkpoints can
      // have a blank, hidden slot).
      return !stored || flags[i] || saved.choices[i][answer] !== "";
    }));
    requireValid(opts.instantFeedback === undefined || typeof opts.instantFeedback === "boolean");
    requireValid(saved.mode === "quiz" || opts.instantFeedback !== true);
    // Stored choices have to agree with the bank: the marked slot holds the
    // real answer, options don't repeat, and a "true" statement really is
    // the answer. Otherwise a crafted file could mark questions completed.
    if (stored) {
      requireValid(saved.choices.every(function (c, i) {
        var question = unit.questions[saved.orderIds[i]];
        if (c.hotspot) return true;
        if (saved.tfFlags[i]) return c.isReal === (normalizeAnswer(c.candidate) === normalizeAnswer(question.answer));
        if (c[c.correctSlot] !== question.answer) return false;
        var texts = ["a", "b", "c", "d"].map(function (k) { return c[k]; }).filter(function (t) { return t !== ""; });
        return texts.length >= 2 && new Set(texts.map(normalizeAnswer)).size === texts.length;
      }));
      if (poolIds) requireValid(saved.orderIds.every(function (id) { return poolIds.indexOf(id) !== -1; }));
    }
    return { saved: saved, unit: unit, opts: opts, poolIds: poolIds, stored: stored };
  }

  function restoreQuizProgress(text, checkpointId) {
    var v = validateSession(text);
    var saved = v.saved, unit = v.unit, opts = v.opts, poolIds = v.poolIds, stored = v.stored;
    // Validate fully before replacing the current unit or attempt.
    if (!state.unit || state.unit.unitTitle !== unit.unitTitle) {
      state.bankPath = "";
      renderBankPath();
    }
    if (state.unit && state.unit !== unit) releaseImageUrls();
    state.unit = unit;
    state.unitText = saved.unitText;
    state.showProgress = saved.showProgress;
    state.showSeed = saved.showSeed !== false;
    state.sessionExpanded = saved.sessionExpanded !== false;
    renderHome(unit);
    loadCompletedForUnit();
    beginQuizExam(saved.mode, {
      count: opts.count, difficulty: opts.difficulty, types: opts.types, poolIds: poolIds,
      instantFeedback: opts.instantFeedback === true,
      legacyChoices: !stored
    }, saved.seed);
    if (stored) {
      state.quiz.order = saved.orderIds.map(function (id) { return unit.questions[id]; });
      state.quiz.tfFlags = saved.tfFlags.slice();
      state.quiz.choices = saved.choices.map(function (c) { return Object.assign({}, c); });
    }
    state.quiz.answers = saved.answers.slice();
    state.quiz.index = saved.index;
    state.quiz.checkpointId = checkpointId || null;
    renderQuizQuestion();
    setSessionStatus("Progress restored.");
    // With instant feedback, right answers are marked completed as they're
    // given; do the same for the restored ones (say, in a fresh browser),
    // once this bank's progress has loaded and if the attempt is still open.
    if (instantFeedbackOn()) {
      var order = state.quiz.order, restoredUnit = state.unit;
      Promise.resolve(state.completedReady).catch(function () {}).then(function () {
        if (state.unit !== restoredUnit || state.quiz.order !== order || state.quiz.submitted) return;
        for (var i = 0; i < order.length; i++) markInstantCompleted(i);
        if (state.screen === "quiz") renderInstantFeedback();
      });
    }
  }

  function readProgressFile(file) {
    if (!file) return;
    if (file.size > MAX_JSON_BYTES) { notifyError("That file is too large to be a saved session."); return; }
    var error = byId("resume-error");
    error.classList.add("hidden");
    var reader = new FileReader();
    var token = nextImport();
    function fail(message) { if (isLatestImport(token)) notifyError(message); }
    reader.onload = function () {
      if (!isLatestImport(token)) return;
      try { restoreQuizProgress(String(reader.result)); }
      catch (err) { fail("Could not resume. Choose a valid JSON file downloaded with Save progress."); }
    };
    reader.onerror = function () { fail("The progress file could not be read. Please try again."); };
    reader.readAsText(file);
  }

