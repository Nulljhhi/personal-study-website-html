  /* ------------------------- Submit + review ------------------------- */

  function hideSubmitModal() {
    var modal = byId("submit-modal");
    if (modal) modal.classList.add("hidden");
  }

  function hasUnansweredQuestion() {
    var answers = state.quiz.answers;
    for (var i = 0; i < answers.length; i++) {
      if (answers[i] === null || answers[i] === undefined) return true;
    }
    return false;
  }

  function onSubmitQuiz() {
    if (hasUnansweredQuestion()) {
      var modal = byId("submit-modal");
      if (modal) modal.classList.remove("hidden");
      return;
    }
    goToReview();
  }

  function goToReview() {
    var firstSubmit = !state.quiz.submitted;
    state.quiz.submitted = true;
    var note = byId("review-completed-note");
    if (note && firstSubmit) {
      note.textContent = "";
      if (state.quiz.mode === "quiz") {
        markCorrectAsCompleted();
        var added = state.quiz.markedThisAttempt || 0;
        if (added > 0) {
          note.textContent = added + (added === 1 ? " question" : " questions") + " marked completed.";
        }
      }
    }
    if (firstSubmit && state.quiz.checkpointId) {
      pendingDoneCheckpoint = state.quiz.checkpointId;
      byId("checkpoint-done-modal").classList.remove("hidden");
    }
    reviewIndex = 0;
    hideSubmitModal();
    renderReview();
    showScreen("quiz-review");
  }

  /* One review page at a time: the question (with its candidate for
     true/false), the same choices as during the quiz, a green outline
     on the correct choice, a red outline on a wrongly picked choice,
     and a "Not answered" note when the question was left blank. */
  function renderReview() {
    var q = state.quiz;
    var list = byId("review-list");
    if (!list) return;
    forgetNearView(list);
    list.textContent = "";
    var i = reviewIndex;
    var question = q.order[i];
    if (!question) return;
    var tf = !!q.tfFlags[i];
    var data = q.choices[i];
    var answer = q.answers[i];
    var correctSlot = data.hotspot ? null : tf ? (data.isReal ? "true" : "false") : data.correctSlot;

    var item = document.createElement("div");
    item.className = "review-item";

    var number = document.createElement("p");
    number.className = "review-number";
    number.textContent = "Question " + (i + 1) + " of " + q.order.length;
    item.appendChild(number);

    var questionEl = document.createElement("p");
    questionEl.className = "review-question";
    questionEl.textContent = question.question;
    item.appendChild(questionEl);

    if (question.hotspot) {
      // The picture with the right spot circled and your pick on it.
      var fig = document.createElement("div");
      fig.className = "review-figure";
      var pad = hotspotPad(question, { pick: parseHotspotAnswer(answer), locked: true, reveal: true, lazy: true });
      pad.el.tabIndex = -1;
      pad.el.removeAttribute("role");
      pad.el.setAttribute("aria-label", "Picture with the right spot circled" + (answer ? " and your pick marked" : ""));
      fig.appendChild(pad.el);
      item.appendChild(fig);
      if (answer !== null && answer !== undefined) {
        var hit = quizAnswerRight(i);
        var res = document.createElement("p");
        res.className = "review-hs-result " + (hit ? "right" : "wrong");
        res.textContent = hit ? "Your pick was on the spot." : "Your pick (red) missed. The right spot is circled.";
        item.appendChild(res);
      }
      if (question.answer) {
        var lab0 = document.createElement("p");
        lab0.className = "review-real";
        lab0.textContent = "Answer: " + question.answer;
        item.appendChild(lab0);
      }
    } else if (question.image) {
      var fig2 = document.createElement("div");
      fig2.className = "review-figure";
      fig2.appendChild(questionImage(question, null, true));
      item.appendChild(fig2);
    }

    if (tf) {
      var candidateEl = document.createElement("p");
      candidateEl.className = "review-candidate";
      candidateEl.textContent = data.candidate;
      item.appendChild(candidateEl);
    }

    var choicesEl = document.createElement("div");
    choicesEl.className = "review-choices";
    var slots = data.hotspot ? [] : tf ? ["true", "false"] : ["a", "b", "c", "d"];
    for (var s = 0; s < slots.length; s++) {
      var slot = slots[s];
      var el = document.createElement("div");
      el.className = "review-choice";
      if (!tf && !data[slot]) continue;
      el.textContent = tf ? (slot === "true" ? "True" : "False") : data[slot];
      // Say it in words too, not just with the outline colour.
      var labels = [];
      if (slot === correctSlot) { el.classList.add("correct-outline"); labels.push("Correct answer"); }
      else if (answer === slot) el.classList.add("picked-outline");
      if (answer === slot) labels.push(slot === correctSlot ? "Your answer" : "Your answer (wrong)");
      if (labels.length) {
        var lab = document.createElement("span");
        lab.className = "review-label";
        lab.textContent = labels.join(" · ");
        el.appendChild(lab);
      }
      choicesEl.appendChild(el);
    }
    item.appendChild(choicesEl);
    if (tf && !data.isReal) {
      var real = document.createElement("p");
      real.className = "review-real";
      real.textContent = "That statement was false. The real answer: " + question.answer;
      item.appendChild(real);
    }

    if (answer === null || answer === undefined) {
      var note = document.createElement("p");
      note.className = "not-answered-note";
      note.textContent = "Not answered";
      item.appendChild(note);
    }

    list.appendChild(item);

    var prev = byId("review-prev-btn");
    var next = byId("review-next-btn");
    if (prev) prev.disabled = reviewIndex <= 0;
    if (next) next.disabled = reviewIndex >= q.order.length - 1;
  }

  function goToPrevReviewPage() {
    if (reviewIndex > 0) {
      reviewIndex--;
      renderReview();
    }
  }

  function goToNextReviewPage() {
    if (reviewIndex < state.quiz.order.length - 1) {
      reviewIndex++;
      renderReview();
    }
  }

  /* --------------------- Options screen Start --------------------- */

  function selectedTypes(mcCheckbox, tfCheckbox) {
    var types = [];
    if (mcCheckbox && mcCheckbox.checked) types.push("mc");
    if (tfCheckbox && tfCheckbox.checked) types.push("tf");
    return types;
  }

  /* Starting anything that filters by completed status waits for the
     saved list to load, so "Skip completed" never sees a partial list. The
     start is dropped if, by then, another bank is open or the person has
     left the screen, and repeated clicks while waiting start it once. */
  function afterCompletedLoad(fn) {
    var waiting = false;
    return function () {
      if (waiting) return;
      var args = arguments, self = this, unit = state.unit, where = state.screen;
      waiting = true;
      Promise.resolve(state.completedReady).catch(function () {}).then(function () {
        waiting = false;
        if (state.unit !== unit || state.screen !== where) return;
        fn.apply(self, args);
      });
    };
  }

  var onQuizStartClick = afterCompletedLoad(function () {
    var types = selectedTypes(byId("type-mc"), byId("type-tf"));
    var errorEl = byId("quiz-options-error");
    if (types.length === 0) {
      notifyError("Select at least one question type: Multiple Choice or True/False.");
      return;
    }
    if (errorEl) errorEl.textContent = "";
    var skip = byId("skip-completed");
    var skipping = !!(skip && skip.checked);
    var pool = quizPool();
    if (pool.length === 0) {
      notifyError("Every question is completed. Press Reset completed on the Home screen to start over, or turn off Skip completed questions.");
      return;
    }
    var total = pool.length;
    var countInput = byId("quiz-count");
    var count = countInput ? parseInt(countInput.value, 10) : NaN;
    if (!isFinite(count)) count = total;
    count = Math.min(Math.max(count, 1), total);
    var checked = document.querySelector('input[name="quiz-difficulty"]:checked');
    startQuiz(
      {
        count: count, difficulty: checked ? checked.value : "easy", types: types,
        instantFeedback: !!(byId("instant-feedback") && byId("instant-feedback").checked),
        poolIds: skipping ? pool.map(function (q) { return q.id; }) : null
      },
      Date.now()
    );
  });

  function onExamStartClick() {
    var types = selectedTypes(byId("exam-type-mc"), byId("exam-type-tf"));
    var errorEl = byId("exam-options-error");
    if (types.length === 0) {
      notifyError("Select at least one question type: Multiple Choice or True/False.");
      return;
    }
    if (errorEl) errorEl.textContent = "";
    var checked = document.querySelector('input[name="exam-difficulty"]:checked');
    startExam(
      { difficulty: checked ? checked.value : "easy", types: types },
      Date.now()
    );
  }

