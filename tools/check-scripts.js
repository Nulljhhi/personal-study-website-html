#!/usr/bin/env node
// Checks app/scripts/*.js the way the app runs them: joined in file-name
// order inside one closure (see build.js), so every file shares one scope.
// That sharing is what makes these mistakes easy, and this catches them:
//
//   - a name declared twice, in two files (the later one silently wins)
//   - a name used but declared nowhere (a typo, or an implicit global)
//   - top-level code that reads a variable a later file declares (it's
//     still undefined when that line runs; functions are fine, they're
//     hoisted)
//   - ESLint's recommended checks, and unused variables and functions
//
// Findings are reported by file and line. Needs the test dependencies:
//
//   cd tests && npm ci && cd .. && node tools/check-scripts.js

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const root = path.join(__dirname, '..');
// A folder to check instead (tests use it on a broken copy).
const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'app', 'scripts');
const fromTests = createRequire(path.join(root, 'tests', 'package.json'));
let Linter, js, globals;
try {
  ({ Linter } = fromTests('eslint'));
  js = fromTests('@eslint/js');
  globals = fromTests('globals');
} catch (err) {
  console.error('ESLint isn\'t installed. Run: cd tests && npm ci');
  process.exit(2);
}

// The same text build.js puts in the page (the closure lines included), so
// line numbers map straight back to the files.
const head = '(function () {\n  "use strict";\n';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const starts = [];
let source = head;
let line = head.split('\n').length;
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  if (!text.endsWith('\n')) {
    console.error(`app/scripts/${f} must end with a newline (the files are joined as they are).`);
    process.exit(1);
  }
  starts.push({ file: f, line });
  source += text;
  line += text.split('\n').length - 1;
}
source += '})();\n';

function where(l) {
  let at = starts[0];
  for (const s of starts) if (s.line <= l) at = s;
  return `${path.relative(root, dir)}/${at.file}:${l - at.line + 1}`;
}

const config = [{
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
    // window.__TAURI__ and the test switches are read through window.
    globals: { ...globals.browser }
  },
  rules: {
    ...js.configs.recommended.rules,
    'no-undef': 'error',
    'no-redeclare': 'error',
    // Only same-scope uses: a function using a later file's variable runs
    // after everything has loaded, which is fine.
    'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
    'no-unused-vars': ['error', { vars: 'all', args: 'none', caughtErrors: 'none' }]
  }
}];

const messages = new Linter().verify(source, config);

// Two parts must stand on their own, or they break where they really run:
//   01-core.js        pure parsing and choice building, no page or DOM
//                     (the Node tests in tests/core.test.js load it alone)
//   makeZipKit()      unzips in a background worker, which gets only its
//                     source and hashText's (13-zip-and-images.js)
const espree = createRequire(fromTests.resolve('eslint'))('espree');
function standalone(label, text, env) {
  const found = new Linter().verify(text, [{
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: env },
    rules: { 'no-undef': 'error' }
  }]);
  for (const m of found) messages.push({ ...m, standalone: label });
}
const coreFile = path.join(dir, '01-core.js');
if (fs.existsSync(coreFile)) {
  standalone('01-core.js on its own', fs.readFileSync(coreFile, 'utf8'), { ...globals.builtin });
}
const ast = espree.parse(source, { ecmaVersion: 2022, range: true });
const named = (n) => ast.body[0].expression.callee.body.body.find((d) => d.type === 'FunctionDeclaration' && d.id.name === n);
const kit = named('makeZipKit'), hash = named('hashText');
if (kit && hash) {
  standalone('makeZipKit in its worker', source.slice(...hash.range) + '\n' + source.slice(...kit.range), { ...globals.builtin, ...globals.worker });
}
for (const m of messages) {
  console.log(m.standalone ? `${m.standalone}, line ${m.line}: ${m.message} (must stand alone)` : `${where(m.line)}: ${m.message} (${m.ruleId || 'parse'})`);
}
if (messages.length) {
  console.error(`${messages.length} problem(s) in ${path.relative(root, dir)}.`);
  process.exit(1);
}
console.log(`${path.relative(root, dir)}: ${files.length} files checked, no problems.`);
