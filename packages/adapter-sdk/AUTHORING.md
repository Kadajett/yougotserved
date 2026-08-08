# Writing an adapter

The short version: **you do not write an adapter by hand, and you do not write it
from scratch. You point a coding agent at the live page once, it spends the
tokens on discovery a single time, and it writes a file that costs almost
nothing forever after.**

That trade is the whole point. The generic browser toolset costs about 8,300
tokens of schema in every session, plus a page read and a locate call per step.
A four-tool adapter costs about 300 tokens of schema and one call per task.

---

## The loop

### 1. Scaffold

```bash
ygs adapter init linkedin --origin https://www.linkedin.com
```

Writes `~/.yougotserved/adapters/linkedin.adapter.ts` with the imports, the
origin fence, and one empty tool.

### 2. Discover, once

This is the expensive step, and you pay it once per site. In an agent session
with the generic tools connected:

> Open https://www.linkedin.com/search/results/people/?keywords=rust
> Use `chrome_read_page` to find the repeating result row and the fields inside
> it, then confirm each selector with a live DOM query. Report the selectors,
> not the content.

**Budget for it.** A first pass over LinkedIn — sign-in check, people search, DOM
inspection, two profile layouts — measured about **50 tool calls and 45–55k
tokens**, most of it in three large accessibility-tree reads. That is real money,
and the payback is roughly six sessions against the 8.5k-token schema the generic
toolset costs every time you connect. Do not repeat it casually; when one
selector breaks, re-derive that one selector.

`chrome_get_interactive_elements` would be the cheaper instrument here and a
handler for it exists, but it is not in the exposed tool list, so `chrome_read_page`
is what you have. A discovery tool that loads only while authoring is the obvious
fix and is not built yet.

You want back a record root and a handful of field selectors:

```
root:       main [role="list"] [role="listitem"]
name:       a[href*="/in/"] span[aria-hidden="true"]
profileUrl: a[href*="/in/"]   (read as prop: 'href')
```

Prefer selectors in this order. Sites rewrite class names constantly; they
rarely rewrite the hooks their own code depends on.

| Prefer         | Example                                                           | Why                                                         |
| -------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Data hooks     | `[data-view-name]`, `[data-urn]`, `[componentkey]`                | The site's own code depends on these                        |
| ARIA and roles | `[aria-label*="Easy Apply"]`, `[role="list"] > [role="listitem"]` | Tied to behaviour, and accessibility work keeps them stable |
| Structure      | `main h2`, `#experience ~ ul li`                                  | Changes only when the page is redesigned                    |
| Classes        | `.entity-result__primary-subtitle`                                | Churns. Fine as a fallback, never as the only hook          |

The order is a prior, not a promise. A verified pass over LinkedIn search
results in early 2026 found **no usable `data-view-name` or `data-urn` hooks on
the rows at all** — ARIA list roles were the strongest boundary available, and
profile names rendered as `h2`, not `h1`. Check what the page actually has;
never assume a tier exists because it usually does.

Give a field two chances when you are unsure — `.a, [class*="b"]` is a valid
CSS list and costs nothing.

### 3. Write the tool

```ts
search_people: defineTool({
  description: 'Search LinkedIn for people.',
  returns: 'name, headline, location and profile URL for each result',
  params: {
    query: p.string('What to search for'),
    limit: p.integer('How many results').default(10).max(50),
  },
  handler: async (page, args) => {
    await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(args.query)}`, {
      until: { selector: 'main [role="list"] [role="listitem"]' },
    });
    return page.extract({
      each: 'main [role="list"] [role="listitem"]',
      limit: args.limit,
      fields: {
        name: 'a[href*="/in/"] span[aria-hidden="true"]',
        profileUrl: { selector: 'a[href*="/in/"]', prop: 'href' },
      },
    });
  },
}),
```

`defineTool` is not decoration: inside a plain object literal TypeScript cannot
infer one property from a sibling, so `args.query` widens to `any` and a typo
compiles. Wrapped, `args` is typed from `params`.

### 4. Run it

```bash
ygs adapter test linkedin search_people --query "rust engineer"
```

Loads the adapter, opens a tab, runs the handler, prints the result and what it
would cost an agent in tokens. Iterate here, not through your MCP client — the
loop is seconds instead of a restart.

### 5. Serve it

```bash
ygs serve --adapter linkedin
```

Tools arrive as `search_people`, `get_profile`, … under a server named
`linkedin`. Serving several adapters at once prefixes them instead:
`linkedin_search_people`.

---

## Rules that keep an adapter cheap

**Return data, not pages.** `page.readPage()` exists and costs thousands of
tokens. `page.extract()` returns the six fields you asked for. If a tool ever
calls `readPage` in its normal path, it is not earning its keep.

**Summarise.** `ok(people, { summary: '12 people, showing 1-10' })` lets an
agent decide what to do without reading the payload.

**Fail with a code.** `not_authenticated` needs the user; `selector_missing`
needs this file edited; `rate_limited` needs a wait. An agent that gets
`isError: true` and a sentence of English will retry, and retrying is wrong for
two of those three.

**Say what it costs.** A tool with `limit` capped at 50 cannot surprise anyone.
An uncapped one can return a thousand rows into a context window.

---

## Security, briefly

An adapter runs against a browser holding your real cookies, so the SDK assumes
an adapter may be hostile and constrains it with data rather than trust:

- **`origins` is mandatory.** Navigation outside it is refused by the host, not
  by the adapter. A LinkedIn adapter cannot reach your bank.
- **`extract` ships no code.** The spec is JSON and the interpreter is fixed, so
  a shared adapter cannot read `document.cookie` or call `fetch`.
- **`evaluate` and `upload` are never implicit.** They have to be declared, and
  a host shows an adapter that asks for them differently.
- **Uploads are classified before anything is read.** `~/.ssh`, `.env`,
  `*.pem`, browser profiles and the rest are refused outright; anything outside
  your configured roots asks first. Narrow it further per adapter with
  `uploads: { allowedExtensions: ['pdf'] }`.
- **`irreversible` requires `confirm: true`**, and the requirement is printed in
  the tool description so the agent knows before it calls.

Read an adapter's `origins`, `capabilities` and `uploads` block before you
install it. Those three lines tell you everything it can do.

---

## Uploading files

Sites accept files three ways, and picking wrong fails silently — the click
lands, nothing attaches, and the agent reports success.

| Method                                  | Use when                                                                         | Note                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `page.upload(selector, file)`           | An `input[type=file]` is in the DOM                                              | Works on hidden inputs behind styled buttons — most "Attach" controls. Try this first.     |
| `page.uploadViaPicker(trigger, file)`   | The input only exists after a click, or the site uses the File System Access API | The host intercepts the chooser, so no dialog opens on your desktop                        |
| `page.uploadToDropZone(selector, file)` | Drag-and-drop with no input behind it                                            | Not implemented yet — returns `failed`. Most drop zones have a hidden input; use `upload`. |

The caller passes a file as a path, a URL, or inline base64:

```ts
params: {
  resume: p.file('Resume to attach.');
}
// agent sends: { resume: { path: '/home/ada/Documents/cv.pdf' } }
```

A path is the normal case — a coding agent runs on the same machine as the
browser, so it already knows where your files are. For a local path the bytes
never pass through the extension: CDP reads the file directly.

---

## When a site changes

A tool returns `selector_missing` instead of an empty list, and the message
names the file. Re-run step 2 for the one selector that broke, edit the line,
re-run step 4. That is the entire maintenance story, and it is why the
selectors live in a readable file rather than baked into a recording.
