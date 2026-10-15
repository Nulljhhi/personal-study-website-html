
  /* ------------------------------ Keyboard ------------------------------
     Shortcuts for the menus around the study modes and games (the study
     screens and the games themselves have their own keys):
       Home          F Flashcards · Q Quiz · M Matching · E Exam · G Games · S Study Sessions
       Options       Enter starts · Esc or Backspace goes back
       Matching size 1-4 picks a board size
       Games         1-9 open a game · A Achievements · Esc back
       Game setup    Enter starts · S shop · Esc back
       Results       Enter or R plays again · G Games · Esc or H Home
       Sessions      Enter or 1 opens Study Garden · Esc back
       Garden        W water · P plant · D decorate · Esc back
     Inside a game, when there's no question up, 1-9 press the buttons in
     the panel (numbered on screen), and on the Deep Delve map they enter
     the lit rooms from left to right. */

  function screenEl() { return document.querySelector("section.screen.active"); }
  function clickIf(el) { if (el && !el.disabled && el.offsetParent !== null) { el.click(); return true; } return false; }

  function onScreenKey(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    var t = event.target;
    // Typing fields keep their keys; checkboxes and radios only use Space, so
    // Enter still works on them.
    var typing = t && (/^(TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable ||
      (t.tagName === "INPUT" && !/^(checkbox|radio)$/.test(t.type)));
    if (typing) return;
    if (t && t.tagName === "INPUT" && event.key !== "Enter" && event.key !== "Escape") return;
    if (document.querySelector(".modal-overlay:not(.hidden)")) return;
    var scr = state.screen, k = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    var onButton = t && (t.tagName === "BUTTON" || t.getAttribute && t.getAttribute("role") === "button");
    var back = k === "Escape" || k === "Backspace";
    var done = false;
    var root = screenEl();
    var backBtn = function () { return root && (clickIf(root.querySelector(".back-btn")) || clickIf(root.querySelector(".return-home"))); };
    switch (scr) {
      case "home":
        var map = { f: "mode-flashcard-btn", q: "mode-quiz-btn", m: "mode-match-btn", e: "mode-exam-btn", g: "mode-games-btn", s: "mode-sessions-btn" };
        if (map[k]) done = clickIf(byId(map[k]));
        break;
      case "flashcard-options": case "quiz-options": case "exam-options":
        if (k === "Enter" && !onButton) done = clickIf(root.querySelector("button.primary"));
        else if (back) done = backBtn();
        break;
      case "match-size":
        if (k >= "1" && k <= "9") done = clickIf(root.querySelectorAll(".match-size-btn")[Number(k) - 1]);
        else if (back) done = backBtn();
        break;
      case "games":
        if (k >= "1" && k <= "9") done = clickIf(document.querySelectorAll("#games-grid .checkpoint-tile")[Number(k) - 1]);
        else if (k === "a") done = clickIf(byId("games-ach-btn"));
        else if (back) done = clickIf(byId("games-back-btn"));
        break;
      case "achievements":
        if (back) done = clickIf(byId("achievements-back-btn"));
        break;
      case "game-setup":
        if (k === "Enter" && !onButton) done = clickIf(byId("game-start-btn"));
        else if (k === "s") done = clickIf(byId("game-setup-shop-btn"));
        else if (back) done = clickIf(byId("game-setup-back-btn"));
        break;
      case "game-results":
        if ((k === "Enter" && !onButton) || k === "r") done = clickIf(byId("game-again-btn"));
        else if (k === "g") done = clickIf(byId("game-results-games-btn"));
        else if (back || k === "h") done = clickIf(byId("game-results-home-btn"));
        break;
      case "sessions":
        if ((k === "Enter" && !onButton) || k === "1") done = clickIf(byId("mode-garden-btn"));
        else if (back) done = clickIf(byId("sessions-back-btn"));
        break;
      case "garden":
        if (k === "w") done = clickIf(byId("garden-water-btn"));
        else if (k === "p") done = clickIf(byId("garden-seed-btn"));
        else if (k === "d") done = clickIf(byId("garden-shop-btn"));
        else if (back) done = clickIf(byId("garden-back-btn"));
        break;
      case "checkpoints": case "banks": case "docs":
        if (back) done = backBtn();
        break;
    }
    // Stop here, so a key that just started a game isn't also read by the game.
    if (done) { event.preventDefault(); event.stopImmediatePropagation(); }
  }

  /* In a game with no question up: number keys press the panel's buttons
     (or enter Delve rooms on the map). Called from onGameKey. */
  function idleNumberKey(k) {
    if (!(k >= "1" && k <= "9") || !game) return false;
    if (!byId("game-idle-pane") || byId("game-idle-pane").classList.contains("hidden")) return false;
    var n = Number(k) - 1;
    var nodes = Array.prototype.slice.call(document.querySelectorAll(".dv-node.reach"));
    if (nodes.length) {
      nodes.sort(function (a, b) { return parseFloat(a.style.left) - parseFloat(b.style.left); });
      return clickIf(nodes[n]);
    }
    var btns = Array.prototype.filter.call(document.querySelectorAll("#game-idle-actions button"), function (b) { return b.offsetParent !== null; });
    return clickIf(btns[n]);
  }
