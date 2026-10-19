  /* ------------------------------ Wiring ------------------------------ */

  function onGameKey(event) {
    if (state.screen !== "game" || !game || game.over) return;
    if (event.repeat) return; // a held key must not answer the next question
    if (event.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable)) return;
    // Shortcuts like Ctrl+C or Alt+Tab aren't game keys.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!byId("fish-shop-modal").classList.contains("hidden")) return;
    // Any other dialog over the game (a notice, a quit problem) owns the
    // keys; only the pause menu leaves P and Escape to the game.
    if (document.querySelector(".modal-overlay:not(.hidden):not(#game-pause-modal)")) return;
    var k = event.key.toLowerCase();
    if (k === "p" || k === "escape") {
      event.preventDefault();
      setGamePaused(!game.paused);
      return;
    }
    if (game.paused) return;
    if (game.minigame && mgKey(k)) { event.preventDefault(); return; }
    if (gameHooks() && gameHooks().key && gameHooks().key(k, event)) { event.preventDefault(); return; }
    if (idleNumberKey(k)) { event.preventDefault(); return; }
    if (game.id === "fishing" && game.fish.phase === "idle" && (k === " " || k === "enter")) {
      // A focused button or link (Return Home, Pause, Shop) does its own
      // thing with Enter and Space; casting is for the game itself.
      var t = event.target;
      if (t && t.closest && t.closest("button, a[href], [role=button], summary") && t.id !== "game-cast-btn") return;
      event.preventDefault();
      castLine();
      return;
    }
    var c = game.current;
    if (!c || byId("game-question-pane").classList.contains("hidden")) return;
    var slot = null;
    if (c.tf) {
      if (k === "t" || k === "1") slot = "true";
      if (k === "f" || k === "2") slot = "false";
    } else if (k >= "1" && k <= "4") {
      slot = "abcd".charAt(Number(k) - 1);
    }
    if (slot && !gameChoiceAvailable(slot)) slot = null;
    if (slot) { event.preventDefault(); resolveGameAnswer(slot); return; }
    if (k === "q") { event.preventDefault(); usePowerup("fifty"); }
    if (k === "w") { event.preventDefault(); usePowerup("freeze"); }
    if (k === "e") { event.preventDefault(); usePowerup("heal"); }
  }

  /* Dialogs: Tab stays inside whichever one is open (the topmost, if
     several), focus moves into a dialog when it opens and goes back to
     where it was when it closes, and every dialog is labelled by its
     title and hint for screen readers. */
  function openModal() {
    var open = Array.prototype.filter.call(document.querySelectorAll(".modal-overlay"), function (m) { return !m.classList.contains("hidden"); });
    return open.length ? open[open.length - 1] : null;
  }

  function modalFocusables(modal) {
    return Array.prototype.filter.call(
      modal.querySelectorAll("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])"),
      function (el) { return !el.disabled && el.offsetParent !== null; });
  }

  function trapPauseFocus(event) {
    if (event.key !== "Tab") return;
    var modal = openModal();
    if (!modal) return;
    var items = modalFocusables(modal);
    if (!items.length) { event.preventDefault(); return; }
    var i = items.indexOf(document.activeElement);
    event.preventDefault();
    items[(i + (event.shiftKey ? items.length - 1 : 1) + items.length) % items.length].focus();
  }

  /* While a dialog is open, everything behind it is inert (not
     clickable, focusable, or read out). */
  function updateInert() {
    var top = openModal();
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el.id === "toast-stack" || el.tagName === "SCRIPT") return;
      var block = !!top && el !== top;
      if (block) el.setAttribute("inert", ""); else el.removeAttribute("inert");
    });
  }

  /* Escape cancels confirmation dialogs (the shops, garage and rename
     dialogs handle Escape themselves, and the pause menu has its own keys). */
  function onDialogEscape(event) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    var top = openModal();
    if (!top) return;
    var cancel = top.querySelector('[id$="-cancel-btn"], #submit-back-btn, #checkpoint-done-keep-btn');
    if (!cancel || top.id === "bank-rename-modal") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel.click();
  }

  /* The most recent elements that had focus, newest last, so a dialog can
     return focus to whatever opened it. */
  var focusTrail = [];
  function lastFocusOutside(overlay) {
    for (var i = focusTrail.length - 1; i >= 0; i--) {
      if (!overlay.contains(focusTrail[i]) && document.body.contains(focusTrail[i])) return focusTrail[i];
    }
    return null;
  }

  function setupDialogs() {
    document.addEventListener("keydown", onDialogEscape, true);
    document.addEventListener("focusin", function (e) {
      if (!e.target || e.target === document.body) return;
      focusTrail.push(e.target);
      if (focusTrail.length > 8) focusTrail.shift();
    }, true);
    var n = 0;
    document.querySelectorAll(".modal-overlay").forEach(function (overlay) {
      var box = overlay.querySelector("[role='dialog']") || overlay.firstElementChild;
      if (!box) return;
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      var title = box.querySelector(".modal-text");
      var hint = box.querySelector(".modal-hint");
      if (title && !box.hasAttribute("aria-labelledby")) { if (!title.id) title.id = "dlg-title-" + (++n); box.setAttribute("aria-labelledby", title.id); }
      if (hint && !box.hasAttribute("aria-describedby")) { if (!hint.id) hint.id = "dlg-hint-" + (++n); box.setAttribute("aria-describedby", hint.id); }
      var returnTo = null;
      new MutationObserver(function () {
        updateInert();
        var shown = !overlay.classList.contains("hidden");
        if (shown && !overlay._shown) {
          overlay._shown = true;
          // Opening code often focuses a dialog button before this runs, so
          // the element to return to is the last one focused outside it.
          returnTo = overlay.contains(document.activeElement) ? lastFocusOutside(overlay) : document.activeElement;
          // Opening code usually focuses a button itself; if not, do it here.
          setTimeout(function () {
            if (overlay.classList.contains("hidden") || overlay.contains(document.activeElement)) return;
            var items = modalFocusables(overlay);
            if (items.length) items[0].focus();
          }, 0);
        } else if (!shown && overlay._shown) {
          overlay._shown = false;
          var back = returnTo;
          returnTo = null;
          // Keyboard-driven screens (games, quiz, flashcards, matching) keep
          // focus off buttons so their keys don't double as clicks.
          var keyScreens = ["game", "quiz", "flashcard", "match-board"];
          if (keyScreens.indexOf(state.screen) === -1 && back && back.focus && document.body.contains(back) &&
            back.offsetParent !== null && !openModal()) back.focus();
        }
      }).observe(overlay, { attributes: true, attributeFilter: ["class"] });
    });
  }

  function setupGames() {
    byId("mode-games-btn").addEventListener("click", function () {
      renderGamesPage();
      showScreen("games");
      whenProgressReady(function () { renderGamesPage(); });
    });
    byId("games-back-btn").addEventListener("click", function () { showScreen("home"); });
    byId("games-ach-btn").addEventListener("click", function () {
      whenProgressReady(function () { renderAchievementsPage(); showScreen("achievements"); });
    });
    byId("achievements-back-btn").addEventListener("click", function () { renderGamesPage(); showScreen("games"); });
    byId("game-reset-btn").addEventListener("click", function () {
      byId("game-reset-title").textContent = "Reset " + GAMES[gameSetupFor].name + " progress?";
      byId("game-reset-hint").textContent = "This clears its level, unlocks, challenges, achievements, best scores and bot rating" +
        (hasOwn(RESET_SCOPE, gameSetupFor) ? ", plus " + RESET_SCOPE[gameSetupFor] : "") +
        " for this bank. Completed questions stay as they are.";
      byId("game-reset-modal").classList.remove("hidden");
      byId("game-reset-cancel-btn").focus();
    });
    byId("game-reset-cancel-btn").addEventListener("click", function () { byId("game-reset-modal").classList.add("hidden"); });
    byId("game-reset-confirm-btn").addEventListener("click", function () {
      byId("game-reset-modal").classList.add("hidden");
      var resetId = gameSetupFor;
      whenProgressReady(function () {
        if (gameSetupFor !== resetId) return;
        resetGameProgress(resetId);
        // Rebuild the setup as if it had just been opened, so the game's own
        // options (perks, tracks, maps, shortcuts...) and their text follow
        // the reset straight away.
        if (resetId === "fishing") byId("game-minutes").value = String(state.gameData.fishing.minutes);
        renderProgressPanel(resetId);
        updateGameSetup();
        onGameSetupOpened(resetId);
      });
    });
    byId("game-setup-back-btn").addEventListener("click", function () { renderGamesPage(); showScreen("games"); });
    document.querySelectorAll('input[name="game-diff-mode"], input[name="game-level"], #game-bots, #game-clean, #game-skip-completed').forEach(function (el) {
      el.addEventListener("change", updateGameSetup);
    });
    byId("game-start-btn").addEventListener("click", function () { startGame(gameSetupFor, readGameSetup()); });
    byId("game-choices").addEventListener("click", onGameChoiceClick);
    byId("game-pause-btn").addEventListener("click", function () { setGamePaused(true); });
    byId("game-resume-btn").addEventListener("click", function () { setGamePaused(false); });
    byId("game-quit-btn").addEventListener("click", function () { endGame(true); });
    byId("game-exit-btn").addEventListener("click", function () {
      if (!game || game.over) { showScreen("home"); return; }
      gameQuitTo = "home";
      var hint = game.id === "fishing" && !game.clean
        ? "Coins, catches and upgrades you've already earned stay saved, but this run won't count toward your best score or rating."
        : game.id === "tycoon" && !game.clean
        ? "Days you've already closed stay saved, but today's orders are lost and this run won't count toward your best score or rating."
        : gameHooks() && gameHooks().quitHint ? (typeof gameHooks().quitHint === "function" ? gameHooks().quitHint(game) : gameHooks().quitHint)
        : "This run won't count toward your best score or rating. Questions you already got right stay completed.";
      setGamePaused(true, "Quit this game?", hint);
    });
    byId("game-cast-btn").addEventListener("click", function () {
      if (gameHooks() && gameHooks().idleAction) gameHooks().idleAction(); else castLine();
    });
    byId("game-shop-btn").addEventListener("click", function () { if (game && !game.over) openFishingShop(true); });
    byId("game-setup-shop-btn").addEventListener("click", function () {
      var hkb = gameHooks(gameSetupFor);
      whenProgressReady(function () { if (hkb && hkb.openShop) hkb.openShop(); else openFishingShop(false); });
    });
    byId("fish-shop-close-btn").addEventListener("click", closeFishingShop);
    document.querySelectorAll("#fish-shop-tabs button").forEach(function (b) {
      b.addEventListener("click", function () { shopTab = b.dataset.tab; renderFishingShop(); });
    });
    byId("game-minutes").addEventListener("change", function (e) {
      // Snap to a whole number in range so what you see is what you get.
      e.target.value = String(fishingMinutes(e.target.value));
      updateGameSetup();
    });
    byId("td-map").addEventListener("change", function () { tdSyncTier(); updateGameSetup(); });
    byId("rally-mode").addEventListener("change", function () { rlSyncSetup(); updateGameSetup(); });
    byId("rally-track").addEventListener("change", function () { rlSyncSetup(); updateGameSetup(); });
    byId("garage-close-btn").addEventListener("click", closeGarage);
    byId("mode-sessions-btn").addEventListener("click", function () { showScreen("sessions"); });
    byId("sessions-back-btn").addEventListener("click", function () { showScreen("home"); });
    byId("mode-garden-btn").addEventListener("click", openGarden);
    byId("mode-garden-btn").addEventListener("keydown", function (e) {
      if (e.target === this && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openGarden(); }
    });
    byId("boss-mode").addEventListener("change", function () { cbSyncSetup(); updateGameSetup(); });
    byId("armory-close-btn").addEventListener("click", closeArmory);
    byId("camp-close-btn").addEventListener("click", closeCamp);
    document.querySelectorAll("#camp-tabs button").forEach(function (b) {
      b.addEventListener("click", function () { campTab = b.dataset.tab; renderCamp(); });
    });
    byId("delve-start").addEventListener("change", function () { dvSyncSetup(); updateGameSetup(); });
    byId("blitz-mode").addEventListener("change", function () { bzSyncSetup(); updateGameSetup(); });
    byId("delve-class").addEventListener("change", function () { dvSyncSetup(); updateGameSetup(); });
    byId("garden-back-btn").addEventListener("click", function () { showScreen("sessions"); });
    byId("garden-water-btn").addEventListener("click", function () { startGardenSession("water"); });
    byId("garden-seed-btn").addEventListener("click", function () { startGardenSession("seed"); });
    byId("garden-seed-size").addEventListener("change", function () {
      gardenProfile().seedSize = Number(this.value) || 5;
      persistCompleted();
      renderGarden();
    });
    byId("garden-shop-btn").addEventListener("click", function () {
      renderGardenShop();
      byId("garden-shop-modal").classList.remove("hidden");
      byId("garden-shop-close-btn").focus();
    });
    byId("garden-shop-close-btn").addEventListener("click", function () { byId("garden-shop-modal").classList.add("hidden"); });
    document.querySelectorAll("#garage-tabs button").forEach(function (b) {
      b.addEventListener("click", function () { garageTab = b.dataset.tab; renderGarage(); });
    });
    byId("td-tier").addEventListener("change", function () { tdSyncTier(); updateGameSetup(); });
    byId("ty-next-btn").addEventListener("click", function () {
      if (!game || game.over || game.id !== "tycoon") return;
      game.locked = false;
      startTycoonDay(false);
    });
    byId("ty-close-btn").addEventListener("click", function () {
      if (!game || game.over) return;
      endGame(false);
    });
    byId("game-again-btn").addEventListener("click", function () {
      if (game) startGame(game.id, game.setup);
    });
    byId("game-results-games-btn").addEventListener("click", function () { renderGamesPage(); showScreen("games"); });
    byId("game-results-home-btn").addEventListener("click", function () { showScreen("home"); });
    document.addEventListener("keydown", onGameKey);
    document.addEventListener("keydown", trapPauseFocus);
    setupDialogs();
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !byId("fish-shop-modal").classList.contains("hidden")) {
        event.preventDefault();
        closeFishingShop();
      }
      if (event.key === "Escape" && !byId("camp-modal").classList.contains("hidden")) {
        event.preventDefault();
        closeCamp();
      }
      if (event.key === "Escape" && !byId("armory-modal").classList.contains("hidden")) {
        event.preventDefault();
        closeArmory();
      }
      if (event.key === "Escape" && !byId("garden-shop-modal").classList.contains("hidden")) {
        event.preventDefault();
        byId("garden-shop-modal").classList.add("hidden");
      }
      if (event.key === "Escape" && !byId("garage-modal").classList.contains("hidden")) {
        event.preventDefault();
        closeGarage();
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && state.screen === "game" && game && !game.over && !game.paused &&
          byId("fish-shop-modal").classList.contains("hidden")) setGamePaused(true);
    });
  }

  /* Each part of start-up runs on its own: if one fails (say an element an
     edit renamed), it's reported and every other part still starts, instead
     of one error leaving the whole app without its buttons. */
  var initProblems = [];
  function initStep(name, fn) {
    try { fn(); } catch (err) {
      initProblems.push(name);
      if (window.console && console.error) console.error("Start-up step \"" + name + "\" failed:", err);
    }
  }

  function init() {
    initStep("Window", function () {
      fitLayoutZoom();
      window.addEventListener("resize", fitLayoutZoom);
    });

    /* --- Theme: start from the OS preference, session-only --- */
    initStep("Theme", function () {
      setTheme(defaultTheme());
      var themeToggle = byId("theme-toggle-btn");
      if (themeToggle) themeToggle.addEventListener("click", toggleTheme);
    });

    /* --- Landing: docs link, select-file button, input, drop zone --- */
    initStep("Landing", function () {
      var docsLink = byId("docs-link");
      if (docsLink) docsLink.addEventListener("click", function () { showScreen("docs"); });

      var selectBtn = byId("select-file-btn");
      var fileInput = byId("file-input");
      if (selectBtn && fileInput) {
        selectBtn.addEventListener("click", function () { fileInput.click(); });
      }
      if (fileInput) {
        fileInput.addEventListener("change", function () {
          var file = fileInput.files && fileInput.files[0];
          if (file) readUnitFile(file);
          fileInput.value = "";
        });
      }
      var dropZone = byId("drop-zone");
      if (dropZone) {
        dropZone.addEventListener("dragover", function (event) {
          if (event.preventDefault) event.preventDefault();
          dropZone.classList.add("drag-over");
        });
        dropZone.addEventListener("dragleave", function () {
          dropZone.classList.remove("drag-over");
        });
        dropZone.addEventListener("drop", function (event) {
          if (event.preventDefault) event.preventDefault();
          dropZone.classList.remove("drag-over");
          var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
          if (file) readUnitFile(file);
          else if (!hasDesktop) notifyError("That wasn't a file. Drag a unit file (.txt) from your file manager.");
        });
      }
    });

    /* --- Documentation screen --- */
    initStep("Documentation screen", function () {
      renderDocsPage();
      byId("docs-prev-btn").addEventListener("click", function () { goToDocsPage(docsPage - 1); });
      byId("docs-next-btn").addEventListener("click", function () { goToDocsPage(docsPage + 1); });
      var downloadBtn = byId("download-md-btn");
      if (downloadBtn) downloadBtn.addEventListener("click", downloadDocs);
      var docsBack = byId("docs-back-btn");
      if (docsBack) docsBack.addEventListener("click", function () { showScreen("landing"); });
    });

    /* --- Home: mode buttons --- */
    initStep("Home", function () {
      var flashcardBtn = byId("mode-flashcard-btn");
      if (flashcardBtn) flashcardBtn.addEventListener("click", function () { showScreen("flashcard-options"); });
      var matchBtn = byId("mode-match-btn");
      if (matchBtn) matchBtn.addEventListener("click", function () { showScreen("match-size"); });
      byId("fc-start-btn").addEventListener("click", afterCompletedLoad(function () {
        var orderEl = document.querySelector('input[name="fc-order"]:checked');
        startFlashcards(Date.now(), { order: orderEl ? orderEl.value : "seeded", skipCompleted: byId("fc-skip-completed").checked });
      }));
      // These toggles drop focus afterwards, so the study keys keep working.
      byId("fc-show-progress").addEventListener("change", function (e) { state.showProgress = e.target.checked; renderFlashcardProgress(); e.target.blur(); });
      byId("fc-show-seed").addEventListener("change", function (e) { state.showSeed = e.target.checked; renderFlashcardProgress(); e.target.blur(); });
      byId("match-show-seed").addEventListener("change", function (e) { state.matchShowSeed = e.target.checked; renderMatchMeta(); e.target.blur(); });
      document.addEventListener("keydown", onStudyKey);
      document.addEventListener("keydown", onScreenKey);
      var quizBtn = byId("mode-quiz-btn");
      if (quizBtn) quizBtn.addEventListener("click", function () { showScreen("quiz-options"); });
      var examBtn = byId("mode-exam-btn");
      if (examBtn) examBtn.addEventListener("click", function () { showScreen("exam-options"); });
    });

    /* --- Flashcard screen --- */
    initStep("Flashcard screen", function () {
      var card = byId("flashcard-card");
      if (card) card.addEventListener("click", flipFlashcard);
      var flipBtn = byId("flip-btn");
      if (flipBtn) flipBtn.addEventListener("click", flipFlashcard);
      var prevBtn = byId("prev-card-btn");
      if (prevBtn) prevBtn.addEventListener("click", goToPrevCard);
      var nextBtn = byId("next-card-btn");
      if (nextBtn) nextBtn.addEventListener("click", goToNextCard);
    });

    /* --- Matching tiles --- */
    initStep("Matching tiles", function () {
      var sizeButtons = document.querySelectorAll("#screen-match-size .match-size-btn");
      for (var sb = 0; sb < sizeButtons.length; sb++) {
        sizeButtons[sb].addEventListener("click", function (event) {
          var size = parseInt(event.currentTarget.getAttribute("data-size"), 10);
          if (isFinite(size)) afterCompletedLoad(function () { startMatch(size, Date.now()); })();
        });
      }
      var matchGrid = byId("match-grid");
      if (matchGrid) matchGrid.addEventListener("click", onMatchGridClick);
      var shuffleBtn = byId("shuffle-btn");
      if (shuffleBtn) shuffleBtn.addEventListener("click", function () { shuffleBoard(Date.now()); });
    });

    /* --- Quiz / Exam --- */
    initStep("Quiz / Exam", function () {
      byId("show-seed").addEventListener("change", function (event) {
        state.showSeed = event.target.checked;
        renderQuizProgress();
        event.target.blur();
      });
      byId("session-toggle-btn").addEventListener("click", function () {
        state.sessionExpanded = !state.sessionExpanded;
        renderQuizProgress();
      });
      byId("show-progress").addEventListener("change", function (event) {
        state.showProgress = event.target.checked;
        renderQuizProgress();
        event.target.blur();
      });
      byId("save-progress-btn").addEventListener("click", saveQuizProgress);
      var resumeInput = byId("resume-file-input");
      document.querySelectorAll(".resume-session-btn").forEach(function (button) {
        button.addEventListener("click", function () {
          if (hasDesktop) openCheckpoints(state.screen === "home" ? "home" : "landing");
          else resumeInput.click();
        });
      });
      resumeInput.addEventListener("change", function () {
        readProgressFile(resumeInput.files && resumeInput.files[0]);
        resumeInput.value = "";
      });
      var quizStartBtn = byId("quiz-start-btn");
      if (quizStartBtn) quizStartBtn.addEventListener("click", onQuizStartClick);
      var examStartBtn = byId("exam-start-btn");
      if (examStartBtn) examStartBtn.addEventListener("click", onExamStartClick);
      var quizChoices = byId("quiz-choices");
      if (quizChoices) quizChoices.addEventListener("click", onQuizChoicesClick);
      var quizPrevBtn = byId("quiz-prev-btn");
      if (quizPrevBtn) quizPrevBtn.addEventListener("click", goToPrevQuizQuestion);
      var quizNextBtn = byId("quiz-next-btn");
      if (quizNextBtn) quizNextBtn.addEventListener("click", goToNextQuizQuestion);
      var submitQuizBtn = byId("submit-quiz-btn");
      if (submitQuizBtn) submitQuizBtn.addEventListener("click", onSubmitQuiz);
      var submitBackBtn = byId("submit-back-btn");
      if (submitBackBtn) submitBackBtn.addEventListener("click", hideSubmitModal);
      var submitContinueBtn = byId("submit-continue-btn");
      if (submitContinueBtn) submitContinueBtn.addEventListener("click", goToReview);
      var reviewPrevBtn = byId("review-prev-btn");
      if (reviewPrevBtn) reviewPrevBtn.addEventListener("click", goToPrevReviewPage);
      var reviewNextBtn = byId("review-next-btn");
      if (reviewNextBtn) reviewNextBtn.addEventListener("click", goToNextReviewPage);
    });

    /* --- Saved folder + completed questions --- */
    initStep("Saved folder + completed questions", function () {
      var openSavedBtn = byId("open-saved-bank-btn");
      var saveBankBtn = byId("save-bank-btn");
      if (hasDesktop) {
        desktopCall("data_folder").then(function (path) { dataFolderPath = path; }).catch(function () {});
        // A rename that was cut short last time was put back on start-up.
        desktopCall("take_startup_notice").then(function (note) { if (note) notifyError(note); }).catch(function () {});
        setupNativeDrop();
        setupCloseFlush();
        setupSingleInstanceNotice();
        document.addEventListener("keydown", function (e) { if (e.key === "F11") { e.preventDefault(); toggleFullscreen(); } });
        var quitBtn = byId("quit-btn");
        quitBtn.classList.remove("hidden");
        setupQuitDialog();
        quitBtn.addEventListener("click", function () {
          quitBtn.disabled = true;
          // Let any pending save finish before the window closes.
          requestQuit().catch(function () { return false; }).then(function () { quitBtn.disabled = false; });
        });
        openSavedBtn.addEventListener("click", openBanks);
        saveBankBtn.addEventListener("click", saveBankToFolder);
      } else {
        openSavedBtn.disabled = true;
        saveBankBtn.disabled = true;
        openSavedBtn.title = DESKTOP_ONLY_NOTE;
        saveBankBtn.title = DESKTOP_ONLY_NOTE;
        byId("landing-folder-note").textContent = DESKTOP_ONLY_NOTE;
      }
      var resetModal = byId("reset-modal");
      byId("reset-completed-btn").addEventListener("click", function () { resetModal.classList.remove("hidden"); });
      byId("reset-cancel-btn").addEventListener("click", function () { resetModal.classList.add("hidden"); });
      byId("reset-confirm-btn").addEventListener("click", function () {
        resetModal.classList.add("hidden");
        resetCompleted();
      });
      byId("skip-completed").addEventListener("change", function () {
        var errorEl = byId("quiz-options-error");
        if (errorEl) errorEl.textContent = "";
        updateQuizCountLimit(true);
      });
    });

    /* --- Checkpoints --- */
    initStep("Checkpoints", function () {
      byId("checkpoint-import-btn").addEventListener("click", function () { byId("resume-file-input").click(); });
      byId("checkpoints-back-btn").addEventListener("click", function () { showScreen(checkpointsReturnTo); });
      byId("checkpoint-delete-cancel-btn").addEventListener("click", function () {
        pendingDeleteCheckpoint = null;
        byId("checkpoint-delete-modal").classList.add("hidden");
      });
      byId("checkpoint-delete-confirm-btn").addEventListener("click", function () {
        var id = pendingDeleteCheckpoint;
        pendingDeleteCheckpoint = null;
        byId("checkpoint-delete-modal").classList.add("hidden");
        if (!id) return;
        var title = pendingDeleteCheckpointTitle;
        deleteCheckpoint(id)
          .then(function () {
            notify("Checkpoint for " + title + " deleted.");
            renderCheckpoints();
          })
          .catch(function (err) { notifyError(err.message); });
      });
      byId("checkpoint-done-keep-btn").addEventListener("click", function () {
        pendingDoneCheckpoint = null;
        byId("checkpoint-done-modal").classList.add("hidden");
      });
      byId("checkpoint-done-delete-btn").addEventListener("click", function () {
        var id = pendingDoneCheckpoint;
        pendingDoneCheckpoint = null;
        byId("checkpoint-done-modal").classList.add("hidden");
        if (!id) return;
        var unitTitle = state.unit ? state.unit.unitTitle : "this attempt";
        deleteCheckpoint(id)
          .then(function () { notify("Checkpoint for " + unitTitle + " deleted."); })
          .catch(function (err) { notifyError(err.message); });
      });
    });

    /* --- Reading speed (app-wide; shown on every game's setup and in the garden) --- */
    initStep("Reading speed", function () {
      var speedSels = document.querySelectorAll(".reading-speed-select");
      Array.prototype.forEach.call(speedSels, function (sel) {
        sel.value = readingSpeedSetting();
        sel.addEventListener("change", function () {
          readingSpeedMemory = sel.value;
          try { window.localStorage.setItem(READING_KEY, sel.value); } catch (err) { /* session only */ }
          Array.prototype.forEach.call(speedSels, function (other) { other.value = sel.value; });
          notify("Reading speed set to " + ({ relaxed: "Relaxed", normal: "Normal", quick: "Quick" })[sel.value] + " (" + READING_SPEEDS[sel.value] + " words a minute).");
        });
      });
    });

    /* --- Games --- */
    initStep("Games", function () {
      setupGames();
    });

    /* --- Question banks --- */
    initStep("Question banks", function () {
      byId("banks-back-btn").addEventListener("click", function () { showScreen("landing"); });
      byId("bank-filter").addEventListener("input", applyBankFilter);
      byId("bank-rename-cancel-btn").addEventListener("click", hideBankRename);
      byId("bank-rename-save-btn").addEventListener("click", saveBankRename);
      byId("bank-rename-input").addEventListener("keydown", function (event) {
        if (event.key === "Enter") { event.preventDefault(); saveBankRename(); }
        if (event.key === "Escape") { event.preventDefault(); hideBankRename(); }
      });
      byId("bank-delete-cancel-btn").addEventListener("click", function () {
        pendingBankDelete = null;
        byId("bank-delete-modal").classList.add("hidden");
      });
      byId("bank-delete-confirm-btn").addEventListener("click", confirmBankDelete);
    });

    /* --- Back to the landing page from Home --- */
    initStep("Back to the landing page from Home", function () {
      byId("back-to-landing-btn").addEventListener("click", function () {
        setLandingError("");
        showScreen("landing");
      });
    });

    /* --- Return Home on every mode screen --- */
    initStep("Return Home on every mode screen", function () {
      var homeButtons = document.querySelectorAll("button.return-home");
      for (var i = 0; i < homeButtons.length; i++) {
        homeButtons[i].addEventListener("click", function () { showScreen("home"); });
      }
    });

    if (initProblems.length) {
      notifyError("Part of the app didn't start (" + initProblems.join(", ") + "). Reload it; if this keeps happening, the details are in the developer console.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
