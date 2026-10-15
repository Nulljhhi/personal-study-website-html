  /* =====================================================================
     5. GLOBAL EXPORT
     ===================================================================== */

  window.StudyApp = {
    mulberry32: mulberry32,
    seededShuffle: seededShuffle,
    deriveSeed: deriveSeed,
    parseUnitFile: parseUnitFile,
    easyDistractors: easyDistractors,
    selectFirstN: selectFirstN,
    assignTrueFalse: assignTrueFalse,
    buildMcChoices: buildMcChoices,
    buildTfCandidate: buildTfCandidate,
    buildBoardTiles: buildBoardTiles,
    unitTextFromZip: unitTextFromZip,
    loadUnitZip: loadUnitZip,
    inflateRaw: inflateRaw,
    hotspotHit: hotspotHit,
    hotspotAnswer: hotspotAnswer,
    docsMarkdown: docsMarkdown,
    loadUnitText: loadUnitText,
    showScreen: showScreen,
    defaultTheme: defaultTheme,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    startFlashcards: startFlashcards,
    startMatch: startMatch,
    shuffleBoard: shuffleBoard,
    startQuiz: startQuiz,
    startExam: startExam,
    state: state,
    __test: { RED_FLASH_MS: RED_FLASH_MS, game: function () { return game; }, persist: function () { return persistCompleted(); },
      flush: function () { return flushSaves(); }, key: function (q) { return completedKey(q); }, resetGame: function (id) { resetGameProgress(id); },
      migrate: function (d) { return migrateProgress(d); }, inflateEntry: function (b, n) { return inflateEntry(b, n); },
      describeBank: function (n, t, p) { return describeBank(n, t, p, 0); }, markDeleted: function (title) { markUnitDeleted({ unitTitle: title }); },
      avgWords: function () { return bankAverageWords(); }, failedWrites: function () { return failedWrites.size; },
      renderMarks: function (q) { renderCompletedMarks(q); }, progressJson: function () { return progressJson(state.unit); },
      mark: function (q) { return markCompleted(q); }, after: function (ms, fn, forTurn) { gameAfter(ms, fn, forTurn); },
      retryable: function (key, make) { return retryableWrite(key, make); }, deleteCheckpoint: function (id) { return deleteCheckpoint(id); } }
  };

  /* =====================================================================
     6. LISTENER WIRING (on DOMContentLoaded)
     ===================================================================== */

