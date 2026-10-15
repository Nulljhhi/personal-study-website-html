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
  if (r.status !== 0 || /^(FAIL|PAGEERROR)/m.test(out)) {
    failed++;
    console.log('!! ' + f + ' failed');
    // On GitHub, each failing file also shows on the run's page, with its
    // failed checks (or the end of its output if it crashed).
    if (process.env.GITHUB_ACTIONS) {
      const lines = out.split('\n').filter(l => /^(FAIL|PAGEERROR)/.test(l));
      const detail = (lines.length ? lines : out.trim().split('\n').slice(-6)).slice(0, 12).join('\n').slice(0, 2000);
      console.log('::error title=' + f + ' (' + (process.env.PW_BROWSER || 'chromium') + ')::' + detail.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A'));
    }
  }
}
const where = 'in ' + (process.env.PW_BROWSER || 'chromium');
console.log(failed ? failed + ' test file(s) failed ' + where : 'All ' + files.length + ' test files passed ' + where);
process.exit(failed ? 1 : 0);
