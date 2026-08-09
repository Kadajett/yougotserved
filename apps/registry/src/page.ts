/**
 * The whole site, in one string.
 *
 * It lists adapters, filters them, and shows an install command. There is no
 * build step, no framework and no client bundle, because that is the smallest
 * thing that does the job. Swap in a framework when the page needs state that
 * outlives a click.
 *
 * The palette matches the extension welcome screen: tan ground, white cards,
 * one red accent.
 */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>youGotServed adapters</title>
<style>
  :root {
    --tan: #e4d8c3; --surface: #fff; --muted: #f6f0e4;
    --text: #33291c; --dim: #6d6152; --line: #d5c6aa; --red: #b3271e;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--tan); color: var(--text);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif;
    background-image: radial-gradient(rgba(120,98,66,.09) 1px, transparent 1px);
    background-size: 22px 22px;
  }
  header { border-bottom: 1px solid var(--line); background: rgba(246,240,228,.86); }
  .wrap { max-width: 820px; margin: 0 auto; padding: 0 20px; }
  h1 { font-size: 21px; margin: 0; padding: 20px 0 4px; }
  .sub { color: var(--dim); font-size: 14px; padding-bottom: 18px; margin: 0; }
  main { padding: 22px 0 60px; }
  input {
    width: 100%; padding: 10px 12px; font-size: 15px; color: var(--text);
    background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
  }
  input:focus { outline: 2px solid rgba(179,39,30,.35); outline-offset: 1px; }
  ul { list-style: none; margin: 18px 0 0; padding: 0; }
  li {
    background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px 16px; margin-bottom: 10px;
  }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .name { font-weight: 600; }
  .ver { color: var(--dim); font-size: 13px; font-weight: 400; }
  .desc { color: var(--dim); margin: 4px 0 10px; font-size: 14px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; }
  .tag {
    border: 1px solid var(--line); background: var(--muted);
    border-radius: 999px; padding: 2px 8px; color: var(--dim);
  }
  .tag.cap { border-color: rgba(179,39,30,.35); color: var(--red); background: rgba(179,39,30,.06); }
  code {
    display: block; margin-top: 10px; padding: 8px 10px; background: var(--muted);
    border: 1px solid var(--line); border-radius: 6px;
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; overflow-x: auto;
  }
  .empty { color: var(--dim); padding: 30px 0; }
  a { color: var(--red); }
  footer { border-top: 1px solid var(--line); color: var(--dim); font-size: 13px; padding: 16px 0; }
</style>
</head>
<body>
<header><div class="wrap">
  <h1>youGotServed adapters</h1>
  <p class="sub">Site tools that run in the browser you already signed in to.</p>
</div></header>

<main class="wrap">
  <input id="q" type="search" placeholder="Search adapters" autocomplete="off">
  <ul id="list"></ul>
  <p class="empty" id="empty" hidden>Nothing published yet.</p>
</main>

<footer class="wrap">
  <!--
    Store link. Points at the install steps until the listing is public.
    Swap this one href for the Chrome Web Store URL on the day it is live.
  -->
  <a href="https://github.com/Kadajett/yougotserved#install">Get the extension</a> &middot;
  <a href="https://yougotserved.dev">yougotserved.dev</a> &middot;
  <a href="https://github.com/Kadajett/yougotserved">Source</a> &middot;
  A pack is data, never code. Read the origins before you install one.
</footer>

<script>
const list = document.getElementById('list');
const empty = document.getElementById('empty');
const box = document.getElementById('q');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function card(a) {
  const caps = (a.capabilities || [])
    .map((c) => '<span class="tag cap">' + esc(c) + '</span>').join('');
  const origins = (a.origins || [])
    .map((o) => '<span class="tag">' + esc(o) + '</span>').join('');
  const stars = a.votes ? a.rating + '/5 (' + a.votes + ')' : 'unrated';
  return '<li>'
    + '<div class="row"><span class="name">' + esc(a.id)
    + ' <span class="ver">' + esc(a.version) + '</span></span>'
    + '<span class="ver">' + a.downloads + ' pulls &middot; ' + esc(stars) + '</span></div>'
    + '<p class="desc">' + esc(a.description || a.name) + '</p>'
    + '<div class="meta">' + origins + caps
    + '<span class="tag">' + a.tools + ' tools</span></div>'
    + '<code>ygs adapter add ' + esc(a.id) + '</code></li>';
}

async function load(q) {
  const res = await fetch('/api/adapters?q=' + encodeURIComponent(q || ''));
  const { adapters = [] } = await res.json();
  list.innerHTML = adapters.map(card).join('');
  empty.hidden = adapters.length > 0;
  if (!adapters.length) empty.textContent = q ? 'No adapter matches that.' : 'Nothing published yet.';
}

let timer;
box.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => load(box.value), 150);
});
load('');
</script>
</body>
</html>`;
