// The browser the tests run in: Chromium by default, or the one named in
// PW_BROWSER (webkit, firefox). WebKit is the engine closest to the desktop
// app on Linux and macOS (WebKitGTK and WKWebView).
//
//   PW_BROWSER=webkit npm test
//
// Each test does `const { chromium } = require('./browser')` and launches
// that, whatever it's called.
const playwright = require('playwright');
const name = process.env.PW_BROWSER || 'chromium';
if (!playwright[name] || typeof playwright[name].launch !== 'function') {
  throw new Error('PW_BROWSER must be chromium, webkit or firefox, not "' + name + '".');
}
module.exports = { chromium: playwright[name], browserName: name };
