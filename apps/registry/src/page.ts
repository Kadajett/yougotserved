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
  /* The id is what gets typed, so it reads as something to be typed. */
  .pkg {
    font: 0.8rem/1.4 ui-monospace, SFMono-Regular, monospace;
    background: var(--sunk); border: 1px solid var(--line); border-radius: 5px;
    padding: 1px 6px; color: var(--ink);
  }
  .by { color: var(--muted); font-size: 0.8rem; }
  .unclaimed { font-style: italic; opacity: 0.75; }
  /* Only appears when a site holds more than one, which is the whole point. */
  .count {
    margin-left: 8px; font-size: 0.72rem; font-weight: 500; letter-spacing: 0.02em;
    color: var(--muted); background: var(--sunk);
    border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px;
    vertical-align: middle;
  }
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
  .detail .steps {
    margin: 6px 0 0; padding: 8px 10px; background: var(--sunk);
    border: 1px solid var(--line); border-radius: 6px; white-space: pre-wrap;
    font: 0.72rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--ink); overflow-x: auto;
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
  /* Two install routes stacked. The label sits tight above its command so the
     pair reads as one thing, not as two unrelated code blocks. */
  .install .how {
    display: block; margin-top: 10px; font-size: 0.7rem; text-transform: uppercase;
    letter-spacing: 0.07em; color: var(--muted);
  }
  .install code { margin-top: 3px; }
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
  <!--
    One line, at the bottom, phrased so nobody has to wonder what it costs.
    Free is the whole pitch; a tip line that reads like a plan is a worse
    version of the pitch.
  -->
  <a href="/api/tip">Tip jar</a> &middot;
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
  // The id is what you install; the name is what tells two adapters for one
  // site apart. A person scanning "linkedin_apply" and "linkedin_people" reads
  // the names, then the authors, and only then types an id.
  const who = a.owner || a.author;
  const byline = who
    ? '<span class="by">by ' + esc(who) + '</span>'
    : '<span class="by unclaimed">unclaimed</span>';

  return '<li>'
    + '<div class="row"><span class="name">' + esc(a.name || a.id)
    + ' <span class="ver">' + esc(a.version) + '</span></span>'
    + '<span class="ver">' + plural(a.downloads, 'pull') + ' &middot; ' + esc(stars) + '</span></div>'
    + '<div class="row"><code class="pkg">' + esc(a.id) + '</code>' + byline + '</div>'
    + '<p class="desc">' + esc(a.description || a.name) + '</p>'
    + '<div class="meta">' + origins + caps
    + '<button class="tag" type="button" aria-expanded="false" data-id="' + esc(a.id) + '">'
    + plural(a.tools, 'tool') + ' &#9662;</button></div>'
    + '<div class="detail" hidden></div>'
    // Two ways in, because people arrive with different things open. The first
    // works through the MCP tools an agent already has; the second is the CLI.
    + '<div class="install">'
    + '<span class="how">Ask your agent</span>'
    + '<code>Install the ygs adapter "' + esc(a.id) + '", show me its origins first</code>'
    + '<span class="how">Or in a terminal</span>'
    + '<code>ygs adapter add ' + esc(a.id) + '</code>'
    + '</div></li>';
}

/**
 * What the pack actually contains, fetched when someone asks for it.
 *
 * The listing is a summary; this is the thing you are about to install. Tool
 * descriptions and risk say what it will do, the digest says which bytes, and
 * the addresses say where its origins point right now.
 */
/**
 * Renders a tool's steps as readable lines.
 *
 * Mirrors describeSteps in the SDK. Every other field on a card is prose the
 * author wrote, so this is the only part that says what a pack will really do.
 */
function describeSteps(steps, indent) {
  const pad = indent || '';
  const out = [];
  for (const s of steps) {
    if ('goto' in s) out.push(pad + 'go to ' + s.goto);
    else if ('waitFor' in s) out.push(pad + 'wait');
    else if ('click' in s) out.push(pad + 'click ' + s.click + (s.optional ? ' (if present)' : ''));
    else if ('fill' in s) out.push(pad + 'type ' + s.value + ' into ' + s.fill + (s.optional ? ' (if present)' : ''));
    else if ('select' in s) out.push(pad + 'choose ' + s.value + ' in ' + s.select);
    else if ('press' in s) out.push(pad + 'press ' + s.press);
    else if ('scroll' in s) out.push(pad + 'scroll');
    else if ('upload' in s) out.push(pad + 'attach ' + s.upload.file + ' to ' + (s.upload.selector || s.upload.trigger));
    else if ('extract' in s) {
      const f = Object.keys(s.extract.fields || {}).join(', ');
      out.push(pad + 'read ' + (s.extract.each || 'the page') + (f ? ': ' + f : ''));
    } else if ('assert' in s) out.push(pad + 'stop unless the page looks right (' + s.assert.code + ')');
    else if ('repeat' in s) {
      out.push(pad + 'repeat up to ' + s.repeat.times + ' times:');
      out.push(...describeSteps(s.repeat.steps, pad + '  '));
    } else if ('forEach' in s) {
      out.push(pad + 'for each ' + s.forEach + ':');
      out.push(...describeSteps(s.steps, pad + '  '));
    }
  }
  return out;
}

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
    + '<pre class="steps">' + esc(describeSteps(t.steps || []).join('\\n')) + '</pre>'
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
 * An adapter is filed under every host it declares, not just the first. The
 * question this page answers is "what covers the host I am on", and an adapter
 * that reaches three Greenhouse hosts is the answer for all three. That means
 * one adapter can appear more than once inside its domain, which is correct.
 *
 * The host heading is dropped when a domain has only one, where it would just
 * repeat the line above it.
 */
function group(adapters) {
  const domains = new Map();
  for (const a of adapters) {
    const hosts = new Set((a.origins || []).map(hostOf));
    for (const host of (hosts.size ? hosts : new Set(['']))) {
      const domain = domainOf(host);
      if (!domains.has(domain)) domains.set(domain, new Map());
      const byHost = domains.get(domain);
      if (!byHost.has(host)) byHost.set(host, []);
      byHost.get(host).push(a);
    }
  }

  const sorted = (map) => [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return sorted(domains).map(([domain, byHost]) => {
    const all = [...new Map([...byHost.values()].flat().map((a) => [a.id, a])).values()];

    // Several adapters for one site is the ordinary case, not the edge one:
    // LinkedIn can hold a people search by one author and a job applier by
    // another. The heading says how many so nobody assumes the first is the
    // only one.
    const heading = '<h2>' + esc(domain)
      + (all.length > 1 ? '<span class="count">' + all.length + ' adapters</span>' : '')
      + '</h2>';

    // Nest by host only when the adapters actually sit on different hosts.
    // Two adapters both on www.linkedin.com under a www.linkedin.com heading
    // is a level of nesting that carries no information.
    const hostsWithAdapters = [...byHost.entries()].filter(([, list]) => list.length > 0);
    const spansHosts = hostsWithAdapters.length > 1
      && hostsWithAdapters.some(([, list]) =>
        list.some((a) => !hostsWithAdapters.every(([, other]) => other.some((b) => b.id === a.id))));

    if (!spansHosts) {
      return '<section class="domain">' + heading
        + '<div class="host"><ul>' + all.map(card).join('') + '</ul></div></section>';
    }

    const body = sorted(byHost).map(([host, list]) => {
      const unique = [...new Map(list.map((a) => [a.id, a])).values()];
      return '<div class="host nested"><h3>' + esc(host) + '</h3>'
        + '<ul>' + unique.map(card).join('') + '</ul></div>';
    }).join('');
    return '<section class="domain">' + heading + body + '</section>';
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

/**
 * The page a person lands on to approve a waiting agent.
 *
 * Deliberately one thing on one screen. Someone arrives here mid-task, from a
 * terminal, having been told to type eight characters, and the only useful
 * design is the one that lets them do that and leave. The code is prefilled
 * when the agent passed it through the sign-in round trip, so the common path
 * is a single click.
 *
 * The palette is copied from the listing page rather than shared, which is a
 * duplication the TanStack rewrite is meant to collapse. Worth naming here so
 * it gets collapsed rather than copied a third time.
 */
export const DEVICE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Approve an agent — youGotServed</title>
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
    margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px;
    background: var(--page); color: var(--ink);
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card {
    width: 100%; max-width: 26rem; background: var(--card);
    border: 1px solid var(--line); border-radius: 14px; padding: 28px;
  }
  h1 { margin: 0 0 6px; font-size: 20px; }
  p { margin: 0 0 18px; color: var(--muted); font-size: 14px; }
  label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
  input {
    width: 100%; padding: 12px 14px; font: 600 20px/1.2 ui-monospace, SFMono-Regular, monospace;
    letter-spacing: .12em; text-align: center; text-transform: uppercase;
    background: var(--sunk); color: var(--ink);
    border: 1px solid var(--line); border-radius: 10px;
  }
  button {
    width: 100%; margin-top: 14px; padding: 12px 14px; font: 600 15px/1 inherit;
    background: var(--ink); color: var(--page);
    border: 0; border-radius: 10px; cursor: pointer;
  }
  button:disabled { opacity: .5; cursor: default; }
  .note { margin: 18px 0 0; font-size: 13px; }
  .ok { color: var(--ink); }
  .bad { color: var(--red); }
  .who { font-size: 13px; color: var(--muted); margin: 0 0 18px; }
</style>
</head>
<body>
<main class="card">
  <h1>Approve an agent</h1>
  <p>An agent on your machine is waiting for permission to act as you. Check the
     code it printed matches the one below before you approve it.</p>
  <p class="who" id="who"></p>
  <form id="form">
    <label for="code">Code from the agent</label>
    <input id="code" name="code" autocomplete="off" spellcheck="false"
           placeholder="ABCD-EFGH" maxlength="9" required>
    <button type="submit" id="go">Approve</button>
  </form>
  <p class="note" id="note"></p>
</main>
<script>
  var params = new URLSearchParams(location.search);
  var input = document.getElementById('code');
  var note = document.getElementById('note');
  var go = document.getElementById('go');
  input.value = (params.get('code') || '').toUpperCase();

  fetch('/api/auth/me')
    .then(function (r) { return r.json(); })
    .then(function (body) {
      if (body.account) {
        document.getElementById('who').textContent =
          'Signed in as ' + body.account.login + '. The agent will act as you.';
      }
    })
    .catch(function () {});

  document.getElementById('form').addEventListener('submit', function (event) {
    event.preventDefault();
    go.disabled = true;
    note.className = 'note';
    note.textContent = 'Approving...';

    fetch('/api/auth/device/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userCode: input.value.trim().toUpperCase() }),
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (result) {
        if (result.ok) {
          note.className = 'note ok';
          note.textContent = 'Approved as ' + result.body.approvedAs +
            '. Go back to your terminal, it will pick this up in a few seconds.';
        } else {
          note.className = 'note bad';
          note.textContent = (result.body.error && result.body.error.message) || 'That did not work.';
          go.disabled = false;
        }
      })
      .catch(function () {
        note.className = 'note bad';
        note.textContent = 'Could not reach the registry.';
        go.disabled = false;
      });
  });
</script>
</body>
</html>`;

/**
 * The tip page.
 *
 * `/api/tip` answers a machine with x402 JSON, which is the right answer for a
 * machine and an unreadable one for a person who clicked a link in the footer.
 * Same URL, same 402, content negotiated: an address someone can copy, and no
 * wallet connector, because a page that wants to touch your wallet to accept a
 * tip has misunderstood what a tip is.
 */
export function tipPage(address: string, chain: string, token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tip jar &middot; ygs adapters</title>
<style>
  :root {
    --bg: #fbfaf8; --fg: #1b1a17; --muted: #6b6862; --line: #e4e0d8; --red: #b23a25;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #161513; --fg: #ecebe7; --muted: #97938b; --line: #2c2a26; --red: #e0674c; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  .wrap { max-width: 640px; margin: 0 auto; padding: 0 20px; }
  h1 { font-size: 1.5rem; margin: 48px 0 4px; }
  h1 span { color: var(--red); }
  p { margin: 0 0 16px; }
  .muted { color: var(--muted); }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem;
    background: color-mix(in srgb, var(--fg) 6%, transparent);
    padding: 2px 6px; border-radius: 4px; word-break: break-all;
  }
  .addr {
    display: block; padding: 14px; margin: 8px 0 20px;
    border: 1px solid var(--line); border-radius: 8px;
  }
  dl { border-top: 1px solid var(--line); padding-top: 16px; margin-top: 28px; }
  dt { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.07em; }
  dd { margin: 2px 0 14px; }
  a { color: var(--red); }
  footer { color: var(--muted); font-size: 0.85rem; margin: 40px 0; }
</style>
</head>
<body>
<main class="wrap">
  <h1><span>ygs</span> tip jar</h1>
  <p class="muted">Nothing on this registry is behind this page.</p>

  <p>Every adapter, every search and every install works the same whether you tip
  or not, and there is no plan to change that. This exists because people keep
  asking where to send something, not because anything here is gated.</p>

  <p>USDC on ${chain}, to:</p>
  <code class="addr">${address}</code>

  <p class="muted">Send from any wallet or from Coinbase, which withdraws to
  ${chain} directly. There is nothing to connect and nothing to sign here: this
  page is a string you copy.</p>

  <dl>
    <dt>Agents</dt>
    <dd>This URL answers <code>402</code> with x402 v2 payment requirements as
    JSON, and in the <code>PAYMENT-REQUIRED</code> header. Nothing is gated, so
    paying unlocks nothing; <code>optional: true</code> says so in the response.</dd>

    <dt>Token</dt>
    <dd><code>${token}</code></dd>
  </dl>
</main>
<footer class="wrap"><a href="/">Back to the adapters</a></footer>
</body>
</html>`;
}
