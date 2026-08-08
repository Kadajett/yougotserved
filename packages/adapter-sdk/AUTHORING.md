# Write an adapter

You do not write an adapter by hand. You point a coding agent at the live page
once. It spends the tokens on discovery a single time, then writes a file that
costs almost nothing after that.

The generic browser toolset costs about 8,300 tokens of schema in every session.
It also needs a page read and a locate call for each step. A four-tool adapter
costs about 300 tokens of schema and one call for each task.

## The loop

### 1. Scaffold

The command writes `~/.yougotserved/adapters/linkedin.adapter.ts`. The file
holds the imports, the origin fence, and one empty tool.

```bash
ygs adapter init linkedin --origin https://www.linkedin.com
```

### 2. Discover, one time

Open the page in an agent session that has the generic tools. Ask for the
repeating row selector and the field selectors inside it. Budget for this step:
a first pass over LinkedIn used about 50 calls and 45,000 to 55,000 tokens. The
payback is about six sessions against the generic schema.

Use `chrome_read_page` once to find the row. Then test each candidate selector
with `chrome_extract`, which returns only the fields you name. Reading the page
again for each try is what makes discovery expensive.

```text
Open https://www.linkedin.com/search/results/people/?keywords=rust
Use chrome_read_page once to find the repeating result row.
Then test each selector with chrome_extract and a small limit.
Report the selectors, not the content.
```

### 3. Prefer stable selectors

Sites rewrite class names often. They rarely rewrite the hooks their own code
depends on. Use the order below, but check what the page actually has. A
verified pass over LinkedIn found no `data-view-name` hooks on the search rows.

| Prefer         | Example                             | Why                                                  |
| -------------- | ----------------------------------- | ---------------------------------------------------- |
| Data hooks     | `[data-view-name]`, `[data-urn]`    | The site's own code depends on these                 |
| ARIA and roles | `[role="list"] > [role="listitem"]` | Tied to behaviour, kept stable by accessibility work |
| Structure      | `main h2`, `#experience ~ ul li`    | Changes only on a redesign                           |
| Classes        | `.entity-result__primary-subtitle`  | Churns. Use as a fallback only                       |

### 4. Write the tool

Wrap each tool in `defineTool`. Inside a plain object literal, TypeScript cannot
infer one property from a sibling. Without the wrapper, `args` widens to `any`
and a typo compiles.

```ts
search_people: defineTool({
  description: 'Search LinkedIn for people.',
  returns: 'name, headline and profile URL for each result',
  params: {
    query: p.string('What to search for'),
    limit: p.integer('How many results').default(10).max(50),
  },
  handler: async (page, args) => {
    await page.goto(searchUrl(args.query), {
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

### 5. Run it

The command loads the adapter, opens a tab, and prints the result. It also
prints the token cost. Iterate here, because the loop takes seconds instead of a
client restart.

```bash
ygs adapter test linkedin search_people --query "rust engineer"
```

### 6. Serve it

Tools arrive as `search_people` under a server named `linkedin`. If you serve
several adapters at once, the host adds a prefix: `linkedin_search_people`.

```bash
ygs serve --adapter linkedin
```

## Two tiers

A tool written with `defineTool` holds JavaScript. It runs on your machine only,
and you cannot publish it. A tool written with `defineSteps` holds a step list
that serializes to JSON.

`buildPack` compiles an adapter into a pack. It packs the step tools, skips each
JavaScript tool, and names the ones it skipped.

```ts
search_people: defineSteps({
  params: { query: p.string('Search terms') },
  steps: [
    { goto: 'https://www.linkedin.com/search/results/people/?keywords={{query|url}}',
      until: { selector: 'main [role="list"]' } },
    { assert: { selector: 'main [role="listitem"]', code: 'not_authenticated',
                message: 'LinkedIn showed the signed-out page.' } },
    { extract: { each: 'main [role="listitem"]', fields: { name: 'a[href*="/in/"] span' } } },
  ],
}),
```

## Rules that keep an adapter cheap

Return data, not pages. `page.readPage()` costs thousands of tokens, and
`page.extract()` returns only the fields you ask for. A tool that calls
`readPage` in its normal path does not earn its keep.

Give each list a `limit` cap. Add a `summary` so an agent can act without
reading the payload. Fail with a code, because an agent retries a generic error,
and a retry is wrong for two of the three common failures.

- `not_authenticated` needs the user to sign in
- `selector_missing` needs the adapter file edited
- `rate_limited` needs a wait

## Security

An adapter runs against a browser that holds your real cookies. The SDK assumes
an adapter can be hostile. It constrains the adapter with data, not with trust.

Read the `origins`, `capabilities` and `uploads` fields before you install an
adapter. Those three lines state everything the adapter can do.

- `origins` is required. The host refuses navigation outside it
- `extract` ships no code. A hostile spec cannot read `document.cookie`
- `evaluate` and `upload` are never implicit. The author must declare them
- Upload paths are classified first. The host refuses `~/.ssh`, `.env` and `*.pem`
- An `irreversible` tool requires `confirm: true`

## Upload files

Sites accept files in three ways. If you pick the wrong one, the call fails
quietly: the click lands, nothing attaches, and the agent reports success.

For a local path, the bytes do not pass through the extension. CDP reads the
file directly. A coding agent runs on the same machine as the browser, so a path
is the usual case.

| Method                                  | Use when                                                    |
| --------------------------------------- | ----------------------------------------------------------- |
| `page.upload(selector, file)`           | An `input[type=file]` is in the DOM, including a hidden one |
| `page.uploadViaPicker(trigger, file)`   | The input exists only after a click                         |
| `page.uploadToDropZone(selector, file)` | Drag and drop with no input. Not built yet                  |

```ts
params: {
  resume: p.file('Resume to attach.');
}
// the agent sends: { resume: { path: '/home/ada/Documents/cv.pdf' } }
```

## When a site changes

The tool returns `selector_missing` and names the file. It does not return an
empty list, because an agent reads an empty list as "no results". Run step 2
again for the one selector that broke, then edit that line.
