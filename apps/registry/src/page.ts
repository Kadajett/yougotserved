/**
 * The whole site, in one string.
 *
 * It lists adapters, groups them by the site they drive, and shows how to
 * install one. There is no build step, no framework and no client bundle,
 * because that is the smallest thing that does the job.
 *
 * The palette and the wordmark match yougotserved.dev, including its dark
 * mode, so the two pages read as one product.
 */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>youGotServed adapters</title>
<meta name="description" content="Site tools that run in the browser you already signed in to.">
<link rel="icon" href="https://yougotserved.dev/icon.png">
<style>
  :root {
    --ink: #33291c; --muted: #6d6152; --red: #b3271e;
    --page: #faf6ee; --card: #fff; --line: #e4d8c3; --sunk: #f6f0e4;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #f3ece0; --muted: #b3a894; --red: #ff6b5e;
      --page: #1c1710; --card: #262017; --line: #3b3226; --sunk: #201a12;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--page); color: var(--ink);
    font: 17px/1.6 ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, sans-serif;
  }
  .wrap { max-width: 44rem; margin: 0 auto; padding: 0 24px; }
  header { padding: 6vh 0 0; }
  h1 { margin: 0; font-size: 2.2rem; letter-spacing: -0.02em; }
  h1 span { color: var(--red); }
  .sub { margin: 4px 0 0; color: var(--muted); font-size: 1rem; }
  main { padding: 28px 0 64px; }

  /* The search box needs air above it; it sat flush against the header. */
  .search { margin-top: 28px; }
  input {
    width: 100%; padding: 11px 14px; font: inherit; font-size: 1rem; color: var(--ink);
    background: var(--card); border: 1px solid var(--line); border-radius: 9px;
  }
  input:focus { outline: 2px solid color-mix(in srgb, var(--red) 40%, transparent); outline-offset: 1px; }

  details.start {
    margin-top: 22px; background: var(--card);
    border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px;
  }
  details.start summary { cursor: pointer; font-weight: 600; font-size: 0.95rem; }
  details.start p { margin: 12px 0 6px; font-size: 0.92rem; color: var(--muted); }

  /* Grouping: a site, then each host under it. */
  .domain { margin-top: 30px; }
  .domain > h2 {
    margin: 0 0 10px; font-size: 0.82rem; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--muted); font-weight: 700;
  }
  /* The rule marks the nesting, so it only earns its place when there is a
     host heading above it. One host per domain draws nothing. */
  .host { margin: 0 0 8px; }
  .host.nested { padding-left: 14px; border-left: 2px solid var(--line); }
  .host > h3 {
    margin: 0 0 8px; font-size: 0.85rem; font-weight: 600; color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px 16px; margin-bottom: 10px;
  }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .name { font-weight: 600; }
  .ver { color: var(--muted); font-size: 0.82rem; font-weight: 400; }
  .desc { color: var(--muted); margin: 4px 0 10px; font-size: 0.92rem; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 0.75rem; }
  .tag {
    border: 1px solid var(--line); background: var(--sunk);
    border-radius: 999px; padding: 2px 8px; color: var(--muted);
  }
  .tag.cap {
    border-color: color-mix(in srgb, var(--red) 35%, transparent); color: var(--red);
    background: color-mix(in srgb, var(--red) 6%, transparent);
  }
  button.tag { cursor: pointer; font: inherit; font-size: 0.75rem; color: var(--ink); }
  button.tag:hover { border-color: var(--red); color: var(--red); }
  button.tag[aria-expanded="true"] { border-color: var(--red); color: var(--red); }

  .detail { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 12px; }
  .detail h4 {
    margin: 0 0 6px; font-size: 0.72rem; text-transform: uppercase;
    letter-spacing: 0.07em; color: var(--muted);
  }
  .detail dl { margin: 0 0 14px; }
  .detail dt { font-weight: 600; font-size: 0.85rem; }
  .detail dt .risk {
    margin-left: 6px; font-weight: 400; font-size: 0.7rem; color: var(--red);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .detail dd { margin: 2px 0 8px; color: var(--muted); font-size: 0.85rem; }
  .detail .addr {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem; color: var(--muted);
  }
  .detail .digest {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.7rem; color: var(--muted); word-break: break-all;
  }
  code, pre {
    display: block; margin: 10px 0 0; padding: 9px 11px; background: var(--sunk);
    border: 1px solid var(--line); border-radius: 7px; white-space: pre-wrap;
    font: 0.78rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-x: auto;
  }
  .empty { color: var(--muted); padding: 30px 0; }
  a { color: var(--red); }
  footer {
    border-top: 1px solid var(--line); color: var(--muted);
    font-size: 0.85rem; padding: 18px 0 40px; margin-top: 20px;
  }
</style>
</head>
<body>
<header class="wrap">
  <h1><span>ygs</span> adapters</h1>
  <p class="sub">Site tools that run in the browser you already signed in to.</p>
</header>

<main class="wrap">
  <details class="start">
    <summary>New here? Paste this to your coding agent</summary>
    <p>It installs the bridge, then finds and installs the adapters you need.</p>
    <pre>Set up youGotServed so you can drive my real Chrome.

1. Run: npm install -g ygs-bridge
2. Run: ygs register
3. Install the extension from https://yougotserved.dev, then reload it.
4. Restart yourself so the ygs MCP server is connected.

Then use ygs_search_adapters to find adapters for the sites I
named, prefer ones with a rating of 4/5 or better, show me the
origins and capabilities of each, and install the ones I approve
with ygs_install_adapter.</pre>
    <p>Already set up? Ask for what you want:</p>
    <pre>Search the ygs registry for a well-rated adapter for this site,
show me what it can reach, and install it if it looks right.</pre>
  </details>

  <div class="search"><input id="q" type="search" placeholder="Search adapters" autocomplete="off"></div>
  <div id="list"></div>
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

/**
 * Suffixes where the registrable name is three labels, not two.
 *
 * Short of shipping the whole public suffix list, this covers the cases a
 * developer tool actually meets. A miss only groups a card one level too deep.
 */
const LONG_SUFFIX = /\\.(co|com|org|net|gov|ac|edu)\\.[a-z]{2}$/;

function hostOf(origin) {
  try { return new URL(origin).hostname; } catch { return String(origin || ''); }
}

function domainOf(host) {
  const parts = host.replace(/^www\\./, '').split('.');
  const want = LONG_SUFFIX.test(host) ? 3 : 2;
  return parts.length <= want ? parts.join('.') : parts.slice(-want).join('.');
}

function card(a) {
  const caps = (a.capabilities || [])
    .map((c) => '<span class="tag cap">' + esc(c) + '</span>').join('');
  const origins = (a.origins || [])
    .map((o) => '<span class="tag">' + esc(o) + '</span>').join('');
  const stars = a.votes ? a.rating + '/5 (' + a.votes + ')' : 'unrated';
  // A brand new adapter reads "1 pulls · 1 tools" without this.
  const plural = (n, one) => n + ' ' + one + (n === 1 ? '' : 's');
  return '<li>'
    + '<div class="row"><span class="name">' + esc(a.id)
    + ' <span class="ver">' + esc(a.version) + '</span></span>'
    + '<span class="ver">' + plural(a.downloads, 'pull') + ' &middot; ' + esc(stars) + '</span></div>'
    + '<p class="desc">' + esc(a.description || a.name) + '</p>'
    + '<div class="meta">' + origins + caps
    + '<button class="tag" type="button" aria-expanded="false" data-id="' + esc(a.id) + '">'
    + plural(a.tools, 'tool') + ' &#9662;</button></div>'
    + '<div class="detail" hidden></div>'
    + '<code>ygs adapter add ' + esc(a.id) + '</code></li>';
}

/**
 * What the pack actually contains, fetched when someone asks for it.
 *
 * The listing is a summary; this is the thing you are about to install. Tool
 * descriptions and risk say what it will do, the digest says which bytes, and
 * the addresses say where its origins point right now.
 */
async function detailFor(id) {
  const res = await fetch('/api/adapters/' + encodeURIComponent(id));
  if (!res.ok) return '<p class="desc">Could not load details.</p>';
  const a = await res.json();
  const tools = (a.pack && a.pack.tools) || {};

  const rows = Object.entries(tools).map(([name, t]) =>
    '<dt>' + esc(a.id + '_' + name)
    + (t.risk && t.risk !== 'read' ? '<span class="risk">' + esc(t.risk) + '</span>' : '')
    + '</dt><dd>' + esc(t.description || '')
    + (t.capabilities ? ' <span class="addr">[' + esc(t.capabilities.join(', ')) + ']</span>' : '')
    + '</dd>').join('');

  // Resolved one at a time so a slow or missing name does not hide the rest.
  const origins = await Promise.all((a.origins || []).map(async (origin) => {
    let host = origin;
    try { host = new URL(origin).hostname; } catch {}
    try {
      const dns = await fetch('/api/resolve?host=' + encodeURIComponent(host));
      if (!dns.ok) throw new Error('no');
      const { a: v4 = [], aaaa: v6 = [] } = await dns.json();
      const found = v4.concat(v6);
      return '<dd>' + esc(origin) + '<br><span class="addr">'
        + (found.length ? esc(found.join(', ')) : 'no address') + '</span></dd>';
    } catch {
      return '<dd>' + esc(origin) + '<br><span class="addr">lookup failed</span></dd>';
    }
  }));

  return (rows ? '<h4>Tools</h4><dl>' + rows + '</dl>' : '')
    + '<h4>Origins</h4><dl>' + origins.join('') + '</dl>'
    + '<h4>Version ' + esc(a.version) + '</h4>'
    + '<p class="digest">' + esc(a.digest || '') + '</p>';
}

/**
 * Groups by registrable domain, then by host inside it.
 *
 * An adapter is filed under its first origin so it appears once. The host
 * heading is dropped when a domain has only one, where it would just repeat.
 */
function group(adapters) {
  const domains = new Map();
  for (const a of adapters) {
    const host = hostOf((a.origins || [])[0]);
    const domain = domainOf(host);
    if (!domains.has(domain)) domains.set(domain, new Map());
    const hosts = domains.get(domain);
    if (!hosts.has(host)) hosts.set(host, []);
    hosts.get(host).push(a);
  }

  return [...domains.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([domain, hosts]) => {
    const many = hosts.size > 1;
    const body = [...hosts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([host, list]) =>
      '<div class="host' + (many ? ' nested' : '') + '">'
      + (many ? '<h3>' + esc(host) + '</h3>' : '')
      + '<ul>' + list.map(card).join('') + '</ul></div>').join('');
    return '<section class="domain"><h2>' + esc(domain) + '</h2>' + body + '</section>';
  }).join('');
}

async function load(q) {
  const res = await fetch('/api/adapters?q=' + encodeURIComponent(q || ''));
  const { adapters = [] } = await res.json();
  list.innerHTML = group(adapters);
  empty.hidden = adapters.length > 0;
  if (!adapters.length) empty.textContent = q ? 'No adapter matches that.' : 'Nothing published yet.';
}

// One listener on the container, so re-rendering the list never loses it.
list.addEventListener('click', async (event) => {
  const button = event.target.closest('button.tag');
  if (!button) return;

  const panel = button.closest('li').querySelector('.detail');
  const open = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!open));
  panel.hidden = open;
  if (open || panel.dataset.loaded) return;

  panel.innerHTML = '<p class="desc">Loading...</p>';
  panel.innerHTML = await detailFor(button.dataset.id);
  panel.dataset.loaded = '1';
});

let timer;
box.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => load(box.value), 150);
});
load('');
</script>
</body>
</html>`;
