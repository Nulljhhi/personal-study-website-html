#!/usr/bin/env node
// Builds src/index.html, the single file the app runs (in the desktop
// window and when opened straight in a browser), from the readable
// sources in app/:
//
//   app/index.html      the page's markup, with two markers
//   app/styles/*.css    the stylesheet, in file-name order
//   app/scripts/*.js    the code, in file-name order; all of it runs
//                       inside one closure, so the files share variables
//                       exactly as if they were one script
//
//   node tools/build.js           write src/index.html
//   node tools/build.js --check   fail if src/index.html is out of date
//
// Keep src/index.html committed: the Rust build embeds it, and people can
// open it without Node.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = path.join(root, 'app');
const out = path.join(root, 'src', 'index.html');

function concat(dir, ext) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('');
}

function build() {
  const template = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
  const markers = ['/* build:styles */', '/* build:scripts */'];
  for (const m of markers) {
    if (template.split(m).length !== 2) throw new Error('app/index.html needs exactly one ' + m);
  }
  // Each part ends with a newline; drop the last one so the marker line is
  // replaced exactly.
  const styles = concat(path.join(app, 'styles'), '.css').replace(/\n$/, '');
  const scripts = concat(path.join(app, 'scripts'), '.js').replace(/\n$/, '');
  return template.replace(markers[0], () => styles).replace(markers[1], () => scripts);
}

const html = build();
if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== html) {
    console.error('src/index.html is out of date. Run: node tools/build.js');
    process.exit(1);
  }
  console.log('src/index.html is up to date.');
} else {
  fs.writeFileSync(out, html);
  console.log('Built src/index.html (' + Math.round(html.length / 1024) + ' KB).');
}
