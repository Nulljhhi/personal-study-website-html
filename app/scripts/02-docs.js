  /* ---------------------------- documentation ---------------------------- */

  var DOCS_LINES = [
    "# Study Website — Unit File Documentation",
    "",
    "## What a unit file is",
    "",
    "The study website reads a question bank that you provide as a **unit file**: a plain-text file you can create and edit in any plain-text editor (Notepad, TextEdit, or any code editor). Every line is a tag, a colon, and a value, for example `question: What is 2 + 2?`. After you load the file, the app turns it into flashcards, quizzes, matching boards, and exams.",
    "",
    "## How to create one",
    "",
    "- Open any plain-text editor and create a new plain-text file.",
    "- Write the unit title on the first non-blank line using the `unit_title` tag. We recommend naming it **topic; date**, for example `unit_title: Cell Biology; Sep 2026`. Banks are listed alphabetically, so this keeps every version of a topic together and tells them apart by date.",
    "- Leave a blank line, then add one block per question.",
    "- Start every block with a `question:` line, then give the answer and the six fake answers.",
    "- Separate the blocks with blank lines and save the file as .txt (for example my-unit.txt).",
    "",
    "## File rules",
    "",
    "- Lines have the form `tag: value`; the tag is everything before the first colon and the value is everything after it.",
    "- Exactly one `unit_title` line is allowed, and it must be the first non-blank line of the file.",
    "- Every question block must start with its `question:` line.",
    "- Each tag may appear only once inside a block, every tag marked required is required, and values may not be empty. (Hotspot questions are the exception: they use `hotspot` instead of the answer and fake answers. See **Pictures and hotspot questions**.)",
    "- Unknown tags are rejected, so keep the file to the tags in the table below.",
    "- Each question needs at least three fake answers that differ from its real answer and from each other (capitals and extra spaces don't count as different).",
    "- A bank can hold up to 20,000 questions and 5 MB of text (a .zip can add up to 25 MB of pictures). If the same question and answer appear twice, the app warns you and treats the copies as one question.",
    "",
    "## Tag reference",
    "",
    "| Tag | Required | Meaning |",
    "| --- | --- | --- |",
    "| unit_title | Yes — exactly once, at the top of the file | The title of the study unit, shown on the Home screen. Recommended format: topic; date. |",
    "| question | Yes — once per block | The question text. |",
    "| answer | Yes — once per block | The real, correct answer. |",
    "| medium_fake_answer_1 | Yes — once per block | A wrong answer that is somewhat plausible compared to the real answer. |",
    "| medium_fake_answer_2 | Yes — once per block | A wrong answer that is somewhat plausible compared to the real answer. |",
    "| medium_fake_answer_3 | Yes — once per block | A wrong answer that is somewhat plausible compared to the real answer. |",
    "| hard_fake_answer_1 | Yes — once per block | A wrong answer that is very plausible compared to the real answer. |",
    "| hard_fake_answer_2 | Yes — once per block | A wrong answer that is very plausible compared to the real answer. |",
    "| hard_fake_answer_3 | Yes — once per block | A wrong answer that is very plausible compared to the real answer. |",
    "| hotspot | Only for hotspot questions | Where to click on the question's picture: `x, y` in percent of the picture's width and height, from its top-left corner (for example `hotspot: 42, 37`). A block with this tag is a hotspot question and takes no fake answers; its `answer` is optional and only labels the spot. |",
    "| hotspot_radius | No — hotspot questions only | How much leeway a click has: the radius of the circle around the spot, in percent of the picture's width (0.5 to 50). Default: 6. |",
    "",
    "## Plausibility guidance",
    "",
    "- Medium fake answers must be **somewhat plausible** compared to the real answer: close enough that the question needs real thought, but clearly wrong once you know the material.",
    "- Hard fake answers must all be **very plausible** compared to the real answer: easy to mistake for the truth at first glance.",
    "- Wrong answers for the easy difficulty are generated automatically by the app from the real answers of the other questions in the unit, so the file format has no tags for them.",
    "- For examples of good medium and hard fake answers, use the arrow at the top of this page to open **How to write questions with AI**.",
    "",
    "## Complete example file",
    "",
    "```text",
    "unit_title: Biology Unit 1 Cells; Sep 2026",
    "",
    "question: Which organelle produces most of the cell's ATP?",
    "answer: Mitochondrion",
    "medium_fake_answer_1: Nucleus",
    "medium_fake_answer_2: Ribosome",
    "medium_fake_answer_3: Golgi apparatus",
    "hard_fake_answer_1: Chloroplast",
    "hard_fake_answer_2: Mitochondrial matrix",
    "hard_fake_answer_3: Smooth endoplasmic reticulum",
    "",
    "question: What is the basic unit of heredity?",
    "answer: Gene",
    "medium_fake_answer_1: Cell",
    "medium_fake_answer_2: Protein",
    "medium_fake_answer_3: Enzyme",
    "hard_fake_answer_1: Allele",
    "hard_fake_answer_2: Chromosome",
    "hard_fake_answer_3: Genome",
    "```",
    "",
    "## Quiz and exam progress",
    "",
    "- Use the arrow above the question to collapse or expand all study controls. Show seed independently toggles the seed display. The restored-progress message clears after a few seconds.",
    "- Use Show progress to show or hide the answered count, remaining count, and progress bar. Selecting an answer counts that question once; changing it does not increase the count.",
    "- In the desktop app, **Save progress** saves a checkpoint to `~/Documents/StudyWebsite/checkpoints`, recording the date and time, the unit, whether it's a quiz or exam, the difficulty, and how many questions you've answered. Saving again during the same attempt updates that checkpoint instead of adding a new one.",
    "- **Resume saved progress** on the landing or Home screen shows your checkpoints as tiles, newest first. Click a tile to continue where you left off; your question order and answer choices are restored, and you don't need to load the unit file separately. Each tile has a Delete button.",
    "- When you submit an attempt that has a checkpoint, a popup asks whether to delete it or keep it.",
    "- **Import from file** on the checkpoints screen opens older JSON progress files. Opened as a plain web page in a browser, Save progress downloads a JSON file and Resume saved progress opens one.",
    "- Use **Change unit** at the top of the Home screen to go back to the landing page and load a different unit.",
    "- When you submit a quiz and reach the review page, every question you answered **correctly** is marked **Completed**. If you later change a question's answer in the unit file, it's no longer marked completed, so you'll see it again. Wrong and unanswered questions stay open. Quiz mode, the games, and full blooms in Study Garden mark questions; Flashcards, Matching Tiles, Exam, and clean game runs do not.",
    "- On the Quiz Options screen, turn on **Instant feedback** to see whether each answer is right as soon as you pick it (your first pick is final). A correct answer is marked completed and saved right away, so closing the app partway through keeps it. The progress line shows your running score, and Submit takes you to the review.",
    "- On the Quiz Options screen, turn on **Skip completed questions** to draw the quiz only from questions that aren't completed yet. The number of questions is capped at how many are left.",
    "- The Home screen shows a Completed tag next to each finished question and how many are done. Press **Reset completed** to clear them all and start fresh.",
    "- Larger matching boards use more screen width. On smaller screens, scroll the board horizontally to keep tiles readable.",
    "",
    "## Games",
    "",
    "- Press **Games** on the Home screen to pick a game. Each one uses your open bank's questions, and correct answers mark questions completed.",
    "- **Boss Battle:** defeat a series of bosses. Correct answers deal damage (faster answers and streaks hit harder); misses cost one of your 3 hearts. Each boss has more health and a shorter timer, and later bosses hide behind one or two shield bars you have to break first (a miss lets the outer shield recharge a little).",
    "- **Minigames:** in Boss Battle, Quiz Rally and Deep Delve a question is sometimes interrupted by a quick Dodge (press the arrows shown), Parry (stop the marker in the zone with Space or Enter) or Rune (type the letters). Everything waits while it's up. Win it for a bonus; lose it and you pay (a broken combo, a monster's hit, a spin-out). Tougher bosses, monsters and cups bring them more often and make them harder.",
    "- **Deep Delve:** 100 floors in 20 biomes. From floor 26 monsters are tougher and elites and bosses carry shields; from floor 51 everything does; floors 76-100 are the Void. Chests and elites always drop a relic, ? rooms and shrines sometimes do, and shops sell them. At Camp, the Outfitter sells gear that lasts a few runs, supplies for the next run, and relics you've found to start your next run with; the Relic codex and Bestiary track what you've discovered. Number keys enter the numbered rooms on the map.",
    "- **Hold the Line:** each tower has two upgrade paths. Level 3 of a path unlocks an ability no other tower has (critical shots, burning ground, shatter, overload, earthquakes, plague and more) and stats grow much faster from there; level 5 powers the ability up.",
    "- **Survival:** one endless run with 3 hearts. The timer gets shorter after every correct answer.",
    "- **Blitz:** answer as many as you can in 60 seconds. A wrong answer takes 3 seconds off the clock.",
    "- Before each game choose **Rising** difficulty (easy, then medium, then hard wrong answers) or a **single difficulty** for the whole game, and which question types to use. Best scores are kept separately for each setting.",
    "- Streaks multiply your score (×1.5 at 3, ×2 at 5, ×3 at 10). In Boss Battle and Survival every 5 in a row earns a power-up: **50/50** removes two wrong answers, **Freeze** stops the timer for one question, **Heal** restores a heart.",
    "- **Fishing:** pick a session length (any whole number of minutes from 1 to 120), press Cast (or Space) and answer when a fish bites before it escapes. Harder questions hook rarer fish. Coins buy rods, stat upgrades (reel speed, bait, line strength, luck, cast speed) and new locations with more valuable fish; open the shop from the setup screen or mid-session (the clock pauses). The Collection tab tracks every species you've caught.",
    "- **Warehouse Tycoon:** each day runs on a clock (1 minute to start, up to 3 minutes with Loading docks upgrades), and each order is a question. A correct answer ships it for profit; a wrong one is a return and a late order is a smaller penalty. After each day you pay overhead and can buy upgrades, then start the next day or close for now.",
    "- Tick **Skip completed questions** to play only with questions you haven't completed yet. Questions you get right drop out as you go; if you complete them all mid-game, the game tells you and continues with the whole bank.",
    "- Game progress is saved for each bank. Tick **Clean run** to start fresh and save nothing: no XP, unlocks, scores, or completed questions.",
    "- Each question's timer is the time to read it at your reading speed (set on each game's setup screen) plus a few seconds to think; some games shorten the thinking part as you go.",
    "- Tick **Play against bots** to race three rivals with a live leaderboard along the bottom of the screen. Your rating in each game is worked out from how you play it: how often you're right and how quickly you answer (compared with the time to read each question). Your first game starts from a neutral guess and the rivals adjust as you answer; after every run the rating moves part of the way toward how that run went. Rivals play at ratings just above, at and just below yours, with the accuracy and speed that rating means, so races stay close.",
    "- Big numbers are shortened (1.25K, 38.4M, 9.18T, then scientific notation).",
    "- Menus have keys too: on Home F, Q, M, E, G and S open the modes; on Games 1-9 open a game; on a game's setup Enter starts and S opens the shop; on results Enter plays again and H goes home; Esc goes back. In a game, when there's no question up, 1-9 press the numbered buttons.",
    "- The rivals are the same three people each time (per bank and game), and they keep their own progress: their own level and run modifier, power-ups from their own streaks, Boss Battle gear from how far they've fought, a Survival perk from their best run, and in Fishing and Tycoon their own rods and upgrades bought with what they earn. The leaderboard shows each rival's level and gear. Your gear never helps them, and theirs never helps you.",
    "- Keyboard: 1–4 to answer, T or F for True/False, Q / W / E for power-ups, Space to cast in Fishing, P or Esc to pause. Pausing stops everything in the game, including short effects like fog and the pause after each answer, so nothing runs out while you're away. Questions you miss come back a few questions later.",
    "",
    "## Saved folder (desktop app)",
    "",
    "- The desktop app opens fullscreen. Press **F11** to switch to a normal window you can resize; the layout scales to fit. Press **Esc** to cancel a confirmation dialog.",
    "- In the desktop app, everything is saved under `~/Documents/StudyWebsite`: question banks in `banks/` (named after their unit titles) and each bank's completed questions and game progress in `progress/`, under an ID that stays the same when you rename the bank. `index.json` remembers which ID belongs to which title.",
    "- After loading a unit, press **Save to folder** on the Home screen to copy it into `banks/`. The folders are created automatically the first time.",
    "- Press **Open saved bank** on the landing screen to see every saved bank as a tile, in title order (\"Week 2\" comes before \"Week 10\"). Click one to study it without dragging the file in again; its completed questions load with it. With more than a screenful of banks, type in **Filter by title** to find one. The list remembers each bank's summary between sessions and reads only banks that changed, so it stays quick with years of banks.",
    "- Each bank tile has **Rename**, which changes the bank's unit title (and its file name, completed questions, and checkpoints to match), and **Delete**, which removes the bank and its completed-question progress. Checkpoints made from a deleted bank are kept.",
    "- Completed questions are written to disk as soon as you reach the review page, so closing the app never loses them.",
    "- Pictures from .zip banks are kept once each in `images/`, named by their content, and saved banks and checkpoints point to them, so a picture used by a bank and several checkpoints is stored once. Pictures nothing uses any more are removed the next time the app starts. Leave the `images/` folder in place: a saved bank needs it.",
    "- Only one copy of the app runs at a time, so two windows can't save over each other. Starting it again brings the open window forward and explains why the new copy closed. As a second safeguard the running copy holds a lock on the folder (the `.lock` file): a copy that somehow starts anyway, for example from another user account, says so and doesn't read or save anything.",
    "- Renaming a bank first copies every file it changes into `rename-backup/`. If the app stops partway through (a crash or a power cut), the next start puts those files back as they were before the rename and tells you; otherwise the copies are removed as soon as the rename is done.",
    "- Opened as a plain web page in a browser, the folder buttons are disabled and progress is kept in that browser's own storage. If the browser blocks or fills that storage (private windows often do), the app says progress is kept for this session only.",
    "- If a saved progress file can't be read, the app tells you and won't save over it, so it can still be recovered. Move or fix that file, then reopen the bank.",
    "- If `index.json` is lost, the app rebuilds it from the progress files, which each record their bank's title. If one of them can't be read, or two claim the same title, banks that could be matched keep working, but no bank starts fresh progress until you move or fix those files (the message names them). That way a bank never quietly starts over while its real progress sits unread.",
    "- Progress follows the bank's title. If you copy a bank file in `banks/` under another file name, both copies share one set of completed questions, and the bank list says so. Deleting one copy keeps that progress for the other; renaming one moves the progress to the renamed copy.",
    "- Banks, checkpoints, pictures and renames are written straight onto the disk, so a power cut right after saving can't lose them. The save after each answer is kept quick and is pushed onto the disk when you quit.",
    "",
    "## Loading your unit file",
    "",
    "Open the study website and either drag the file onto the drop zone or press the select file button and pick the file. A .zip with the unit file and its pictures works the same way (see **Pictures and hotspot questions**, the next page). When the file parses, the Home screen appears with the unit title, the four study modes, and every question with its real answer. When something is wrong with the file, a message pops up in the corner naming the problem."
  ];

  var IMAGE_DOCS_LINES = [
    "# Pictures and hotspot questions",
    "",
    "## Adding pictures to questions",
    "",
    "Any question can have a picture. Put the unit file and the pictures in a **.zip** and load the .zip instead of the .txt (drag it onto the drop zone or pick it with Select file).",
    "",
    "- The .zip holds exactly **one unit file** (.txt), and the pictures, usually in a folder next to it.",
    "- Name each picture **Img.Q** followed by the question's number and the extension, for example `Img.Q1.png` for the first question in the file and `Img.Q12.jpg` for the twelfth. Questions are numbered in the order they appear in the unit file, starting at 1.",
    "- Pictures can be .png, .jpg, .gif, .webp, .svg or .bmp, up to 8 MB each and 25 MB in all. A question without a picture is fine; most questions don't need one.",
    "- On Windows, select the unit file and the picture folder, right-click and choose **Send to → Compressed (zipped) folder**. On a Mac, select them, right-click and choose **Compress**. On Linux, use your file manager's **Compress** option.",
    "",
    "```text",
    "Cell Biology.zip",
    "├── cell-biology.txt",
    "└── images",
    "    ├── Img.Q1.png",
    "    ├── Img.Q4.jpg",
    "    └── Img.Q7.png",
    "```",
    "",
    "A question with a picture shows it beside the question in quizzes, exams and games, on the front of its flashcard and in the Home list. Matching Tiles stay text only. **Save to folder** keeps the pictures with the bank, and checkpoints carry them too, so you only load the .zip once.",
    "",
    "- A bank saved with Save to folder holds its pictures inside its .txt, so you can load that .txt directly, or zip it again. Pictures added to that zip as Img.Q files replace only those questions' pictures; the rest are kept.",
    "- Save unit files as UTF-8 text (most editors do by default). A file in another encoding is refused rather than loaded with garbled characters.",
    "",
    "## Hotspot questions",
    "",
    "A hotspot question asks you to click the right spot on its picture instead of picking an answer. Give it a `hotspot` line instead of the answer and fake answers:",
    "",
    "```text",
    "question: Click the mitochondrion.",
    "hotspot: 42, 37",
    "hotspot_radius: 5",
    "answer: Mitochondrion",
    "```",
    "",
    "- `hotspot: x, y` is the spot to click, in percent of the picture: `0, 0` is the top-left corner, `100, 100` the bottom-right, and `50, 50` the middle. Decimals are fine (`42.5, 37`).",
    "- `hotspot_radius` (optional, default 6) is the leeway: a click counts if it lands inside a circle of that radius around the spot, measured in percent of the picture's width. Use a small radius (2 to 4) for a small target among close neighbours, and a larger one (8 to 12) for a big area.",
    "- `answer` is optional. It names the spot, and shows on the Home list, the flashcard back and the review page.",
    "- A hotspot question has no fake answers, and it needs a picture: load it in a .zip with its Img.Q picture.",
    "- **Finding the coordinates:** load the .zip, then on the Home screen click the spot on the question's picture. The app shows a ready-made line such as `hotspot: 42.5, 37` and copies it, so you can paste it into the unit file and load the .zip again.",
    "",
    "## How hotspot questions work in each mode",
    "",
    "- **Quiz and Exam:** the question is above a large picture. Click to place your pick (a blue dot); click again to move it until you submit. With Instant feedback your first click is final. The review page shows the right spot circled in green and your pick (red if it missed).",
    "- **Games and Study Garden:** clicking the picture is your answer. Afterwards the right spot is circled. Power-ups and abilities that remove wrong answers (50/50, the Inspector, Study) aren't used on hotspot questions, and the timer allows a moment to find the spot.",
    "- **Flashcards:** the front shows the question and picture; the back shows the picture with the spot circled.",
    "- **Matching Tiles:** hotspot questions are left out, since they have no answer text to put on a tile.",
    "- **Keyboard:** Tab to the picture (in games it's selected for you), press Space or Enter to show a cursor in the middle, move it with the arrow keys (hold Shift for small steps), and press Enter to pick. The picture keeps the keyboard focus from one question to the next.",
    "",
    "## Complete example",
    "",
    "```text",
    "unit_title: Geography Map Skills; Oct 2026",
    "",
    "question: Which river is shown on this map?",
    "answer: The Nile",
    "medium_fake_answer_1: The Amazon",
    "medium_fake_answer_2: The Danube",
    "medium_fake_answer_3: The Mississippi",
    "hard_fake_answer_1: The Congo",
    "hard_fake_answer_2: The Niger",
    "hard_fake_answer_3: The Zambezi",
    "",
    "question: Click the river's delta.",
    "hotspot: 48, 12",
    "hotspot_radius: 7",
    "answer: The Nile Delta",
    "```",
    "",
    "Zip this file with `Img.Q1.png` (the map) and `Img.Q2.png` (the same map, or a closer one)."
  ];

  var AI_DOCS_LINES = [
    "# How to write questions with AI",
    "",
    "An AI assistant can turn your notes, slides, or a textbook chapter into a unit file for you. Paste in your study material along with the two guides below and the Tag reference from the first documentation page, then ask for a unit file with the unit_title written as **topic; date** (for example `unit_title: Cell Biology; Sep 2026`). Read through the result before you study from it; the AI can get facts wrong.",
    "",
    "For questions with pictures, an AI can write the question text and tell you which question number each picture belongs to (name the files Img.Q1.png and so on). It can't reliably give hotspot coordinates; get those by clicking the picture on the Home screen (see **Pictures and hotspot questions**).",
    "",
    "## Guide for writing questions",
    "",
    "### Keep questions factual and concise",
    "",
    "Each question should ask for one fact, and the answer should be just that fact, with no extra explanation.",
    "",
    "- **Q:** What machine is used to make coffee? **A:** A coffee maker.",
    "",
    "### Give alternate names and acronyms their own questions",
    "",
    "When a term has an alternate name or an acronym, don't put it in parentheses. Split it into two questions so you learn each one on its own.",
    "",
    "- **Q:** What organization governs residential communities? **A:** Homeowners Association.",
    "- **Q:** What is the acronym for the organization that governs residential communities? **A:** HOA.",
    "",
    "### Split multi-step processes into one question per step",
    "",
    "When the material describes a process, don't pack every step into a single answer. Write a separate question for each step.",
    "",
    "- **Q:** What is the first step of making coffee? **A:** Roasting the coffee beans.",
    "- **Q:** What is the second step of making coffee? **A:** Grinding the roasted coffee beans.",
    "",
    "### Go beyond the core concepts",
    "",
    "Also write broader questions about the supporting details, examples, and context in the material. That way you end up remembering the whole topic, not just the headline ideas.",
    "",
    "## Guide for writing fake answers",
    "",
    "Good fake answers look a lot like the real answer. If a fake answer is obviously wrong, it doesn't test anything. Every question needs three medium and three hard fake answers.",
    "",
    "### Medium fake answers",
    "",
    "A medium fake answer should be easy to rule out for someone who understands the topic, but believable to someone who isn't as familiar with it.",
    "",
    "| Question | Real answer | Medium fake answer |",
    "| --- | --- | --- |",
    "| What is the powerhouse of the cell? | The mitochondria | The nucleus |",
    "| What is 100 x 0.1? | 10 | 1000 |",
    "| What does HOA stand for? | Home Owners Association | House Order Association |",
    "",
    "### Hard fake answers",
    "",
    "A hard fake answer should match the real answer's structure closely, so you can't pick the right choice by its shape or length. It should be close enough to fool you if you only glance at the choices instead of reading them carefully.",
    "",
    "| Question | Real answer | Hard fake answer | Why it works |",
    "| --- | --- | --- | --- |",
    "| What is the powerhouse of the cell? | The organelle mitochondria | The organelle chloroplasts | Same wording, and chloroplasts are another real organelle. |",
    "| What is 100 x 0.1? | 10 | 10% | The right digits, but the question asks for a number, not a percentage. |",
    "| What does HOA stand for? | Home Owners Association | Home Owl Association | Same structure and nearly the same words, so it's easy to miss at first glance. |",
    "",
    "**Tip:** Adding an extra fact to the real answer makes hard fake answers easier to write. \"The mitochondria\" becomes \"The organelle mitochondria\", which gives you room for \"The organelle chloroplasts\"."
  ];

  var DOCS_PAGES = [
    { label: "Unit file documentation", lines: DOCS_LINES },
    { label: "Pictures and hotspot questions", lines: IMAGE_DOCS_LINES },
    { label: "How to write questions with AI", lines: AI_DOCS_LINES }
  ];
  var docsPage = 0;

  function docsMarkdown() {
    return DOCS_PAGES.map(function (page) { return page.lines.join("\n"); }).join("\n\n---\n\n");
  }

  function renderDocsPage() {
    var content = document.getElementById("docs-content");
    if (content) content.innerHTML = renderMarkdown(DOCS_PAGES[docsPage].lines.join("\n"));
    var label = document.getElementById("docs-nav-label");
    if (label) label.textContent = DOCS_PAGES[docsPage].label + " (" + (docsPage + 1) + " of " + DOCS_PAGES.length + ")";
    var prev = document.getElementById("docs-prev-btn");
    var next = document.getElementById("docs-next-btn");
    if (prev) prev.disabled = docsPage <= 0;
    if (next) next.disabled = docsPage >= DOCS_PAGES.length - 1;
  }

  function goToDocsPage(page) {
    docsPage = Math.min(Math.max(page, 0), DOCS_PAGES.length - 1);
    renderDocsPage();
    var screen = document.getElementById("screen-docs");
    if (screen && screen.scrollIntoView) window.scrollTo(0, 0);
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderInline(text) {
    var html = escapeHtml(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    return html;
  }

  /* Tiny markdown renderer for the documentation content above
     (headings, bullet lists, pipe tables, fenced code, bold, code spans). */
  function renderMarkdown(md) {
    var lines = md.split("\n");
    var html = [];
    var paragraph = [];
    var listItems = [];
    var tableRows = [];
    var codeLines = null;

    function flushParagraph() {
      if (paragraph.length) {
        html.push("<p>" + renderInline(paragraph.join(" ")) + "</p>");
        paragraph = [];
      }
    }
    function flushList() {
      if (listItems.length) {
        var items = "";
        for (var i = 0; i < listItems.length; i++) {
          items += "<li>" + renderInline(listItems[i]) + "</li>";
        }
        html.push("<ul>" + items + "</ul>");
        listItems = [];
      }
    }
    function flushTable() {
      if (!tableRows.length) return;
      var rows = [];
      for (var i = 0; i < tableRows.length; i++) {
        var cells = tableRows[i].split("|").slice(1, -1);
        for (var c = 0; c < cells.length; c++) cells[c] = cells[c].trim();
        rows.push(cells);
      }
      var separatorIndex = -1;
      for (var r = 1; r < rows.length; r++) {
        var allDashes = rows[r].length > 0;
        for (var d = 0; d < rows[r].length; d++) {
          if (!/^:?-{3,}:?$/.test(rows[r][d])) allDashes = false;
        }
        if (allDashes) { separatorIndex = r; break; }
      }
      var table = "<table>";
      if (separatorIndex > 0) {
        table += "<thead><tr>";
        for (var h = 0; h < rows[0].length; h++) {
          table += "<th>" + renderInline(rows[0][h]) + "</th>";
        }
        table += "</tr></thead><tbody>";
        for (var b = separatorIndex + 1; b < rows.length; b++) {
          table += "<tr>";
          for (var bb = 0; bb < rows[b].length; bb++) {
            table += "<td>" + renderInline(rows[b][bb]) + "</td>";
          }
          table += "</tr>";
        }
        table += "</tbody>";
      } else {
        table += "<tbody>";
        for (var t = 0; t < rows.length; t++) {
          table += "<tr>";
          for (var tt = 0; tt < rows[t].length; tt++) {
            table += "<td>" + renderInline(rows[t][tt]) + "</td>";
          }
          table += "</tr>";
        }
        table += "</tbody>";
      }
      table += "</table>";
      html.push(table);
      tableRows = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (codeLines !== null) {
        if (/^```/.test(line.trim())) {
          html.push("<pre>" + escapeHtml(codeLines.join("\n")) + "</pre>");
          codeLines = null;
        } else {
          codeLines.push(line);
        }
        continue;
      }
      var trimmed = line.trim();
      if (trimmed === "") {
        flushParagraph();
        flushList();
        flushTable();
        continue;
      }
      if (/^```/.test(trimmed)) {
        flushParagraph();
        flushList();
        flushTable();
        codeLines = [];
        continue;
      }
      if (trimmed.charAt(0) === "|") {
        flushParagraph();
        flushList();
        tableRows.push(trimmed);
        continue;
      }
      flushTable();
      if (/^###\s/.test(trimmed)) { flushParagraph(); flushList(); html.push("<h3>" + renderInline(trimmed.slice(4)) + "</h3>"); continue; }
      if (/^##\s/.test(trimmed)) { flushParagraph(); flushList(); html.push("<h2>" + renderInline(trimmed.slice(3)) + "</h2>"); continue; }
      if (/^#\s/.test(trimmed)) { flushParagraph(); flushList(); html.push("<h1>" + renderInline(trimmed.slice(2)) + "</h1>"); continue; }
      if (/^-\s/.test(trimmed)) { flushParagraph(); listItems.push(trimmed.slice(2)); continue; }
      flushList();
      paragraph.push(trimmed);
    }
    flushParagraph();
    flushList();
    flushTable();
    if (codeLines !== null) {
      html.push("<pre>" + escapeHtml(codeLines.join("\n")) + "</pre>");
    }
    return html.join("\n");
  }

