  /* =====================================================================
     2. APPLICATION STATE
     Live object exported as window.StudyApp.state (shared by reference).
     ===================================================================== */

  var state = {
    screen: "landing",
    theme: "light",
    unit: null,
    unitText: "",
    showProgress: true,
    showSeed: true,
    sessionExpanded: true,
    flashcards: { order: [], index: 0, flipped: false },
    /* Matching mode sub-state (flow logic owned by C2). */
    match: {
      size: 0,
      seed: null,
      pairs: [],
      tiles: [],
      selectedTile: null,
      matchedPairs: [],
      locked: false,
      done: false
    },
    /* Quiz / Exam sub-state (flow logic owned by C2). */
    quiz: {
      mode: "quiz",
      seed: null,
      order: [],
      tfFlags: [],
      choices: [],
      answers: [],
      index: 0,
      submitted: false
    }
  };

  /* =====================================================================
     3. SCREEN ROUTER
     showScreen(name) toggles the .active class on the ten screen
     sections and mirrors the name into state.screen. Per-screen hooks
     run whenever that screen is shown (register more below or in C2's
     controllers, e.g. screenShowHooks["match-board"] = fn).
     ===================================================================== */

  var SCREEN_IDS = {
    "landing": "screen-landing",
    "docs": "screen-docs",
    "home": "screen-home",
    "flashcard": "screen-flashcard",
    "flashcard-options": "screen-flashcard-options",
    "match-size": "screen-match-size",
    "match-board": "screen-match-board",
    "quiz-options": "screen-quiz-options",
    "quiz": "screen-quiz",
    "quiz-review": "screen-quiz-review",
    "exam-options": "screen-exam-options",
    "checkpoints": "screen-checkpoints",
    "banks": "screen-banks",
    "games": "screen-games",
    "game-setup": "screen-game-setup",
    "game": "screen-game",
    "game-results": "screen-game-results",
    "garden": "screen-garden",
    "sessions": "screen-sessions",
    "tycoon-day": "screen-tycoon-day",
    "achievements": "screen-achievements"
  };

  var screenShowHooks = {};

  function showScreen(name) {
    var id = SCREEN_IDS[name] || String(name);
    var target = document.getElementById(id);
    if (!target) return;
    var sections = document.querySelectorAll("section.screen");
    for (var i = 0; i < sections.length; i++) {
      sections[i].classList.remove("active");
    }
    target.classList.add("active");
    state.screen = name;
    document.body.setAttribute("data-screen", name);
    // A game was running when another tab let go of this bank: now that
    // it's left, read the newer progress and start saving (05-progress.js).
    if (state.tabTakeoverPending && name !== "game") finishTabTakeover();
    // Focus left behind on the screen that was just hidden is lost for
    // keyboard and screen-reader users: move it to the new screen's heading.
    var active = document.activeElement;
    if (!active || active === document.body || (active.closest && active.closest("section.screen") && !target.contains(active))) {
      var heading = target.querySelector("h1, h2");
      var spot = heading && heading.offsetParent !== null ? heading : target;
      if (!spot.hasAttribute("tabindex")) spot.setAttribute("tabindex", "-1");
      try { spot.focus({ preventScroll: true }); } catch (err) { /* not focusable */ }
    }
    var hook = screenShowHooks[name];
    if (typeof hook === "function") hook();
    if (name === "game") wakeGameLoop();
    else document.body.classList.remove("board-on");
  }

  /* Quiz Options: default the count control to the unit total each time
     the screen is shown (max is capped at the total). */
  /* "N of M not completed yet" hints on the flashcard and matching menus. */
  function skipHintText() {
    if (!state.unit) return "";
    var total = questionTotal();
    return (total - completedCount()) + " of " + total + " questions not completed yet.";
  }
  screenShowHooks["flashcard-options"] = function () { byId("fc-skip-hint").textContent = skipHintText(); };
  screenShowHooks["match-size"] = function () { byId("match-skip-hint").textContent = skipHintText() + " A board uses fewer tiles if there aren't enough left."; };

  /* Keyboard controls for Flashcards, Matching, Quiz and Exam. */
  function onStudyKey(event) {
    var scr = state.screen;
    if (scr !== "flashcard" && scr !== "match-board" && scr !== "quiz") return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    var t = event.target;
    if (t && (/^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === "INPUT" && !/^(checkbox|radio)$/.test(t.type)))) return;
    if (t && t.tagName === "INPUT" && (event.key === " " || event.key === "Enter")) return; // let a focused checkbox toggle
    var open = document.querySelector(".modal-overlay:not(.hidden)");
    var k = event.key;
    var kl = k.length === 1 ? k.toLowerCase() : k;
    if (open) {
      if (scr === "quiz" && (k === "Escape" || k === "Backspace") && !byId("submit-modal").classList.contains("hidden")) { event.preventDefault(); hideSubmitModal(); }
      return;
    }
    var onButton = !!t && (t.tagName === "BUTTON" || t.tagName === "A" || t.getAttribute("role") === "button");
    var activate = k === " " || k === "Enter";
    if (k === "Escape" || k === "Backspace") { event.preventDefault(); showScreen("home"); return; }
    if (scr === "flashcard") {
      if (kl === "a" || k === "ArrowLeft") { event.preventDefault(); goToPrevCard(); }
      else if (kl === "d" || k === "ArrowRight") { event.preventDefault(); goToNextCard(); }
      // A focused button or link does its own thing on Enter/Space.
      else if (activate && !onButton) { event.preventDefault(); flipFlashcard(); }
      return;
    }
    if (scr === "match-board") {
      if (activate && !onButton) { event.preventDefault(); shuffleBoard(Date.now()); }
      return;
    }
    // Quiz and Exam share the quiz screen.
    var q = state.quiz;
    if (!q.order.length) return;
    if (kl === "a" || k === "ArrowLeft") { event.preventDefault(); goToPrevQuizQuestion(); return; }
    if (kl === "d" || k === "ArrowRight") { event.preventDefault(); goToNextQuizQuestion(); return; }
    if (k === "Enter" && !(onButton && t.id !== "submit-quiz-btn")) { event.preventDefault(); onSubmitQuiz(); return; }
    var tf = !!q.tfFlags[q.index];
    var slot = null;
    if (tf) { if (kl === "t" || k === "1") slot = "true"; if (kl === "f" || k === "2") slot = "false"; }
    else if (k >= "1" && k <= "4") slot = "abcd".charAt(Number(k) - 1);
    if (!slot) return;
    var btn = byId("quiz-choices").querySelector('button.choice[data-slot="' + slot + '"]');
    if (btn) { event.preventDefault(); btn.click(); }
  }

  screenShowHooks["quiz-options"] = function () {
    var errorEl = document.getElementById("quiz-options-error");
    if (errorEl) errorEl.textContent = "";
    updateQuizCountLimit(true);
  };

  /* =====================================================================
     3.5 THEME CONTROLLER
     The theme is session-only. defaultTheme() reads the OS color-scheme
     preference at CALL time, fully guarded: no matchMedia, a throwing
     matchMedia, or a query that does not match all mean "light".
     setTheme()/toggleTheme() switch the data-theme attribute on <html>,
     mirror it into state.theme, and relabel the global toggle button
     (which always names the theme it will switch TO). Nothing is ever
     written to any store, so a fresh load always starts from the
     default again.
     ===================================================================== */

  function defaultTheme() {
    try {
      var mm = window.matchMedia;
      if (typeof mm !== "function") return "light";
      var query = mm.call(window, "(prefers-color-scheme: dark)");
      if (query && query.matches === true) return "dark";
    } catch (err) {
      return "light";
    }
    return "light";
  }

  function setTheme(theme) {
    if (theme !== "light" && theme !== "dark") return;
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    var toggle = document.getElementById("theme-toggle-btn");
    if (toggle) {
      if (theme === "dark") {
        toggle.textContent = "\u2600 Light mode";
        toggle.setAttribute("aria-label", "Switch to light mode");
      } else {
        toggle.textContent = "\u263E Dark mode";
        toggle.setAttribute("aria-label", "Switch to dark mode");
      }
    }
  }

  function toggleTheme() {
    setTheme(state.theme === "dark" ? "light" : "dark");
  }

