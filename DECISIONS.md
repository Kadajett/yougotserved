# Decisions

Companion to [AUDIT.md](./AUDIT.md). What we keep, port, rewrite or omit, and
why.

## The shape of the thing

We fork `hangwin/mcp-chrome` and treat it as the browser bridge. The product
lives above the bridge. Playwright becomes a test tool, not the execution engine.

Nothing above `BrowserSession` may import native messaging, `chrome.*`, or MCP
transport types.

```
MCP clients  ->  local broker (per-connection server, auth, tab leases)
                     |
                 site adapters  ->  BrowserSession interface
                                          |
                                    native host  <->  Chrome / Edge extension
                                                            |
                                                  the user's signed-in tabs
```

## Ported from mcp-chrome

- Native messaging framing and request correlation
- Native host registration and platform manifest paths, extended with Edge
- Selector engine: strategies, stability scoring, fingerprints, shadow DOM
- Interaction recorder and the record and replay action handlers
- Extension tool dispatch map
- MCP transports: HTTP, SSE, streamable
- Vitest suites for record and replay

## Kept from our earlier prototype

- `.ygs.json` pack format with a pre-install audit
- Underscore tool naming with a 64 character clamp
- One server for each site, which gives a real namespace
- Per-site origin allowlist
- `genericTools: 'auto'`, so browse tools disappear once a site has recipes
- Compact results: file paths over base64, readable text over raw DOM
- CLI surface: `init`, `doctor`, `run`, `export`, `install`, `serve`

## Rewritten

Upstream connects one process-wide `Server` to every transport. We give each
client connection its own server instance, plus tab leases and run cancellation.

The extension starts from no permissions and adds only what a capability needs.
It drops `debugger`, `history`, `bookmarks`, `webRequest`, and the `<all_urls>`
default.

## Omitted

- Vector database, embeddings, semantic tab search, ONNX runtime
- The agent chat service and its Claude and Codex engines
- Trigger engine from record and replay v3
- Arbitrary JavaScript injection and raw CDP passthrough as MCP tools
- Full network response body capture
- Firefox and Safari

## No Zod in the parameter language

Adapters describe inputs with a small builder that emits JSON Schema directly. It
infers TypeScript types from the same declaration. Zod stays a fine choice inside
the host, where none of the reasons below apply.

- MCP wants JSON Schema on the wire, so Zod needs a converter
- An adapter must be one file that a sandbox can read without a library
- Every emitted byte is context an agent pays for on every request

## Extraction is declarative

`page.extract()` takes a JSON spec and a fixed interpreter runs it. Adapters
never ship code into the page. A hostile spec can misread a page, but it cannot
read `document.cookie` or call `fetch`.

## defineTool works around a TypeScript limit

Inside a plain object literal the compiler cannot infer one property from a
sibling. Without the wrapper `args` widens to `Record<string, any>` and
`args.querry` compiles. Both forms behave the same at run time.

## upload and evaluate are never implicit

Other capabilities follow from a tool's risk level. These two reach past the
page: `evaluate` runs as the origin, and `upload` reads the local disk. A tool
that uploads cannot call itself `risk: 'read'`.

## Upload paths are classified first

The host refuses `~/.ssh`, `.env`, `*.pem` and browser profile directories. A
path outside the configured roots needs confirmation. The classifier is pure
string work, so it runs anywhere and is cheap to test.

The raw `chrome_upload_file` tool bypasses all of this. That is one more reason
to drop the generic tools from the default schema.

## Upload has three methods

One generic method would fail without an error on two of the three cases. The
click lands, nothing attaches, and the agent reports success.

- `upload` sets files on an `input[type=file]`, including a hidden one
- `uploadViaPicker` answers the file chooser that a click opens
- `uploadToDropZone` is declared but not built

## Tier 1: declarative packs

A tool written with `defineSteps` is a step list that serializes to JSON.
`buildPack` compiles it into a pack with a canonical SHA-256 digest. The registry
serves static files and runs nothing.

## Tier 2: JS handlers stay local

`defineTool` keeps full expressiveness for your own machine. `buildPack` refuses
to publish these tools and names each one it skipped. A silent drop would show up
later as a bug report.

## Why data and not code

Three reasons converge here. Each one alone would justify the extra authoring
surface.

- No review process can audit a stranger's JavaScript against a signed-in session
- Chrome Web Store policy forbids remotely hosted code
- `node:vm` is not a security boundary, so sandboxing fetched code is theatre

## Enforcement sits outside the pack

A pack's claims about itself are untrusted. The host applies the origin fence,
the capability list, and the path checks. `validatePack` re-checks everything on
arrival, because the publisher's build ran on their machine.

## The attack this blocks

An upload step must name a file parameter such as `{{resume}}`. It may never hold
a literal path. Otherwise a published pack could name a file on your disk and
post it to the author's own site.

## Security posture

- Loopback binding only, with a bearer token on the HTTP transport
- Adapters limited to declared origins, enforced at the bridge
- Risk levels `read`, `write`, `irreversible`, the last needs confirmation
- Never return `Authorization`, `Cookie` or `Set-Cookie`
- Page content is untrusted input, never instructions
- A local audit log, and a visible disconnect control in the extension

Read the upstream reports before you port anything in these areas:
[#321](https://github.com/hangwin/mcp-chrome/issues/321) multi-client singleton,
[#316](https://github.com/hangwin/mcp-chrome/issues/316) prompt injection,
[#331](https://github.com/hangwin/mcp-chrome/issues/331) file operations,
[#368](https://github.com/hangwin/mcp-chrome/issues/368) JavaScript and CDP.

## Benchmark baseline

Measured on the wire: 27 always-on tools, 33,206 bytes of JSON Schema, about
8,302 tokens. An earlier estimate of 11,000 counted commented-out entries.

The benchmark should report tool calls, input tokens, output tokens, wall clock,
success rate over repeats, and recovery after a small DOM change.
