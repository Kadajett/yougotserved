/**
 * Proves the injected extract runner still works after bundling.
 *
 * `chrome_extract` sends `runExtractSpec` into the page with
 * `chrome.scripting.executeScript({ func })`, which stringifies it and drops
 * the closure. The SDK unit tests cannot see this: they run the source, not the
 * bundle, and the extension bundler moves a function-local `const` out to
 * module scope. That hoisting broke the runner once already.
 *
 * Run after `wxt build`:
 *   node scripts/check-injected-runner.js app/chrome-extension/.output/chrome-mv3/background.js
 */
import fs from 'node:fs';
const bundle = process.argv[2];
if (!bundle) {
  console.error('Usage: node scripts/check-injected-runner.js <background.js>');
  process.exit(2);
}
const src = fs.readFileSync(bundle, 'utf8');

const i = src.indexOf('An extract spec needs');
const start = src.lastIndexOf('function runExtractSpec', i);
let depth = 0,
  end = -1,
  inStr = null;
for (let k = src.indexOf('{', start); k < src.length; k++) {
  const c = src[k],
    prev = src[k - 1];
  if (inStr) {
    if (c === inStr && prev !== '\\') inStr = null;
    continue;
  }
  if (c === '"' || c === "'" || c === '`') {
    inStr = c;
    continue;
  }
  if (c === '{') depth++;
  else if (c === '}') {
    depth--;
    if (depth === 0) {
      end = k + 1;
      break;
    }
  }
}

const fnSrc = src.slice(start, end);
let fn;
try {
  fn = new Function('return (' + fnSrc + ')')();
} catch (e) {
  console.log('PARSE FAIL:', e.message);
  process.exit(1);
}

const el = (tag, text, attrs) => ({
  tagName: tag,
  textContent: text,
  getAttribute: (a) => attrs[a] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
});
const rows = [el('LI', 'Ada', { 'data-n': '1,234' }), el('LI', 'Grace', { 'data-n': '987' })];
const root = { querySelector: () => null, querySelectorAll: (s) => (s === 'li' ? rows : []) };

try {
  const out = fn(
    { each: 'li', fields: { name: {}, count: { attr: 'data-n', number: true } } },
    root,
  );
  const want = '[{"name":"Ada","count":1234},{"name":"Grace","count":987}]';
  if (JSON.stringify(out) !== want) {
    console.error('WRONG OUTPUT\n  got:  ' + JSON.stringify(out) + '\n  want: ' + want);
    process.exit(1);
  }
  console.log('injected extract runner: ok');
} catch (e) {
  console.error(
    'RUNTIME FAIL: ' +
      e.constructor.name +
      ': ' +
      e.message +
      '\nThe bundler moved something out of runExtractSpec. Keep every helper and ' +
      'every constant inside the function body.',
  );
  process.exit(1);
}
