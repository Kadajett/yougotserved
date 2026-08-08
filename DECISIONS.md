# DECISIONS

Companion to [AUDIT.md](./AUDIT.md). What we keep, port, rewrite or omit, and why.

## The shape of the thing

Fork `hangwin/mcp-chrome` locally and treat it as the browser bridge. Keep the parts of the
current implementation that sit _above_ the bridge, where the actual product lives. Playwright
stops being the execution engine and becomes a development and testing tool.

```
MCP clients  ──►  local broker (per-connection server, auth, tab leases)
                      │
                  site adapters  ──►  BrowserSession interface
                                            │
                                      native host  ◄─►  Chrome / Edge extension
                                                              │
                                                    the user's authenticated tabs
```

Nothing above `BrowserSession` may import native messaging, `chrome.*`, or MCP transport types.

## Decisions

### Ported from mcp-chrome

- Native messaging host framing and request correlation (`native-messaging-host.ts`).
- Native host registration and cross-platform manifest paths, **extended with Edge**.
- Selector engine: strategies, stability scoring, fingerprints, DOM paths, shadow DOM,
  composite frame selectors (`shared/selector/*`).
- Interaction recorder (`inject-scripts/recorder.js`) and the record/replay action handlers,
  including their visibility checks, navigation waits and network-idle waits.
- Extension tool dispatch map.
- HTTP/SSE/streamable MCP transports.
- Vitest suites covering record/replay.

### Kept from the current implementation

- `.ygs.json` pack format with pre-install audit — no upstream equivalent, and it is how
  adapters get shared.
- Underscore tool naming with a 64-char clamp, and one-server-per-site as the way to get a
  real namespace.
- Per-site origin allowlist with subdomain matching.
- `genericTools: 'auto'` — ad-hoc browse tools disappear once a site has real recipes.
- Compact results: file paths over inline base64, readable text over raw DOM.
- Recorder behaviours grafted onto the upstream recorder: repeated-element detection with
  auto-derived list fields, and password inputs becoming required secret parameters rather
  than stored values.
- CLI surface (`init`, `doctor`, `browsers`, `login`, `run`, `export`, `install`, `serve`).

### Rewritten

- **Multi-client isolation.** Upstream connects one process-wide `Server` to every transport
  and routes through a module-singleton native host. One server instance per client
  connection, plus tab leases, run cancellation and per-client permission grants.
- **Extension permissions.** Start from nothing and add only what a capability needs.
  No `debugger`, `history`, `bookmarks`, `webRequest`, `declarativeNetRequest`, and no
  `<all_urls>` default.
- **Site adapter SDK.** New in both codebases: typed input/output via Zod, declared origins,
  risk level, required capabilities, confirmation policy.

### Omitted

- Vector database, embeddings, semantic tab search, the bundled ONNX runtime.
- The agent chat service and its Claude/Codex engines.
- Trigger engine (cron, interval, DOM, context-menu) from record-replay v3.
- Arbitrary JavaScript injection and raw CDP passthrough as MCP tools.
- Full network response-body capture.
- Firefox and Safari.

### Adapter SDK (`packages/adapter-sdk`)

**No Zod in the parameter language.** Adapters describe inputs with a ~250-line
builder (`p.string()`, `p.integer().default(10)`) that emits JSON Schema directly and
infers TypeScript types from the same declaration. Three reasons, and the decision fails
if any one of them changes: MCP wants JSON Schema on the wire, so Zod needs a converter;
an adapter must be a single file a sandbox can evaluate without a validation library
loaded alongside it; and every byte of emitted schema is context an agent pays for on
every request, so we want to control the output exactly. Zod stays a fine choice inside
the host, where none of those apply.

**Extraction is declarative, not code.** `page.extract()` takes a JSON spec — record
root, fields, selectors — and a fixed interpreter runs it. Adapters never ship code into
the page. This is what makes an adapter safe to install from a gist: a hostile spec can
misread a page, but it cannot read `document.cookie`, call `fetch`, or reach anything the
interpreter does not itself do. It is also where the token saving comes from, since one
round trip returns the six fields asked for instead of the page they were in.

**`defineTool` exists because of a TypeScript limitation, not for style.** Inside a plain
`tools: { ... }` literal the compiler cannot infer one property's type from a sibling's,
so `args` widens to `Record<string, any>` and `args.querry` compiles. The wrapper gives it
a single call to infer from. Both forms work at runtime.

**`upload` and `evaluate` are never implicit.** Other capabilities follow from a tool's
risk level. These two reach past the page — `evaluate` runs as the origin with the user's
session, `upload` reads the local disk — so they must be declared, and a tool that uploads
cannot call itself `risk: 'read'`.

**Upload paths are classified before anything is read.** `~/.ssh`, `.env`, `*.pem`,
browser profile directories and similar are refused outright; anything outside the
configured roots requires confirmation. The classifier is pure string work (no filesystem
access) so it runs anywhere and is cheap to test. Adapters narrow it further with
`uploads: { allowedExtensions: [...] }`. Note the gap: the raw `chrome_upload_file` MCP
tool bypasses all of this, which is one more reason to drop the generic tools from the
default schema.

**Upload has three methods, not one.** `upload` (existing `input[type=file]`, including
hidden ones behind styled buttons), `uploadViaPicker` (CDP `Page.setInterceptFileChooser`,
for inputs that only exist after a click), and `uploadToDropZone` (declared, not yet
implemented). One generic method would fail silently on two of the three cases: the click
lands, nothing attaches, and the agent reports success.

### Remote distribution: adapters are data, not code

Two tiers.

**Tier 1, publishable: declarative packs.** A tool written with `defineSteps` is a
step list — goto, waitFor, click, fill, upload, extract, assert, repeat — that
serialises to JSON. `buildPack` compiles an adapter into a `.ygs.json` pack,
content-addressed with a canonical-JSON SHA-256. The registry serves immutable
static artifacts and executes nothing. `runSteps` is a fixed interpreter with no
`eval`, no `Function`, and no pack-driven dynamic dispatch.

**Tier 2, local only: JS handlers.** `defineTool` keeps full expressiveness for
your own machine. `buildPack` refuses to publish these and names each one it
skipped, because "published four tools" versus "published two and silently
dropped two" is something you would otherwise learn from a bug report.

Three independent reasons converge on this, which is why it is worth the extra
authoring surface:

1. **Security.** No review process scales to auditing strangers' JavaScript that
   runs against a logged-in session. A step list is reviewable in a browser tab.
2. **Chrome Web Store policy** prohibits remotely-hosted code. Fetching adapter
   logic is only compliant if the logic is not code.
3. **`node:vm` is not a security boundary.** Sandboxing fetched JS would be
   theatre; the honest version is to not fetch JS at all.

Enforcement stays outside the pack, since a pack's claims about itself are
untrusted: the origin fence, the capability list, and upload path classification
are applied by the host. `validatePack` re-checks everything on arrival even
though the publisher's build already did — that build ran on their machine.

One specific attack the interpreter blocks: an upload step must reference a file
_parameter_ (`{{resume}}`), never a literal path. Otherwise a published pack
could name a file on the installer's disk and post it to the author's own site.

## Security posture

- Loopback binding only; bearer token required on the HTTP transport; no permissive CORS.
- Adapters restricted to declared origins, enforced at the bridge, not in the adapter.
- `read` / `write` / `irreversible` risk levels; irreversible requires explicit confirmation.
- Never return `Authorization`, `Cookie` or `Set-Cookie`; redact password-type inputs.
- Page content is untrusted input, never instructions.
- Local audit log of browser actions; a visible pause/disconnect control in the extension.

Before porting anything that touches these areas, read the upstream reports:
[#321](https://github.com/hangwin/mcp-chrome/issues/321) multi-client singleton,
[#316](https://github.com/hangwin/mcp-chrome/issues/316) prompt injection into authenticated
sessions, [#331](https://github.com/hangwin/mcp-chrome/issues/331) file operations,
[#368](https://github.com/hangwin/mcp-chrome/issues/368) JavaScript and CDP.

## Benchmark baseline

Measured live off the wire, not from source: **27 always-on tools, 33,206 bytes of JSON
Schema, ≈8,302 tokens** per session before any work happens. (An earlier estimate of
~11,000 counted commented-out entries in `packages/shared/src/tools.ts`; the measured
number is the one to beat.)

For comparison, `examples/linkedin.adapter.ts` is four tools and roughly 1.2 kB of schema.
The benchmark should report tool calls, input tokens, output tokens, wall-clock, success
rate over repeats, and recovery after a small DOM change.
