// Runs every *.test.js here one at a time (they use fake clocks, and
// running them in parallel makes timing flaky). Exits non-zero if any fails.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  console.log('== ' + f);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 10 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  if (r.status !== 0 || /^(FAIL|PAGEERROR)/m.test(out)) { failed++; console.log('!! ' + f + ' failed'); }
}
const where = 'in ' + (process.env.PW_BROWSER || 'chromium');
console.log(failed ? failed + ' test file(s) failed ' + where : 'All ' + files.length + ' test files passed ' + where);
process.exit(failed ? 1 : 0);
