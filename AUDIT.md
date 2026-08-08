# AUDIT: current implementation vs `hangwin/mcp-chrome`

Date: 2026-08-08
Reviewed commit of `mcp-chrome`: `f48e717` (2026-01-06), MIT licensed, (c) 2024 hangye.
Current implementation: 5,386 lines of TypeScript across `src/` (Playwright-based, written from scratch in this repo, never released, no tests).

The comparison was done by cloning the repo and reading the source, not from documentation.

---

## The finding that decides the architecture

### Chrome 136 blocks remote debugging on the default profile

Chrome ignores `--remote-debugging-port` and `--remote-debugging-pipe` on the
default user data directory. You must pair them with a non-default
`--user-data-dir`. That directory gets a different encryption key, so it cannot
read the real profile's cookies. Chrome did this to stop infostealer malware.

### Sources

See [Chrome for Developers, Changes to remote debugging switches to improve security](https://developer.chrome.com/blog/remote-debugging-port), [Chrome 136 update breaks remote debugging functionality](https://community.latenode.com/t/chrome-136-update-breaks-remote-debugging-functionality/21829)

> Playwright, in any of its modes, cannot drive the user's real, already-authenticated Chrome or Edge profile.

### What this rules out

`connectOverCDP` needs remote debugging on the real profile, which is now blocked. `launchPersistentContext` works, but only against a separate profile directory. The user then signs in to every site again, inside a browser they do not use. That is the problem this product exists to remove.

### What this leaves

The current implementation uses `launchPersistentContext`. It is well-formed, but
it solves a different problem. An extension plus a native messaging host is the only supported way to drive the
real signed-in profile. `mcp-chrome` already implements that bridge.

### This invalidates the browser-attachment layer of the current code (`launcher.ts`, `session.ts`, `detect.ts`, and the Playwright half of `runner.ts`, roughly 990 lines) as a production execution engine

Everything above that layer largely survives.

---

## What we compete on

`mcp-chrome` publishes 27 always-on tools. Measured on the wire, their schemas
total 33,206 bytes, about 8,302 tokens. Every agent pays that in every session,
before any work happens. Dynamic flow tools add to that baseline.

That is the number our adapter model has to beat. A five-tool site adapter should cost a few hundred tokens and one call. The generic path costs the full preamble plus an eight-call loop. The benchmark should measure exactly this.

### The policy worth keeping

`genericTools: 'auto'` exposes browse tools only while a site has no recipes. The
tool list shrinks as the site gets modelled.

---

## Component-by-component

| Subsystem              | Current implementation                                                                                                                                                                                                  | `mcp-chrome`                                                                                                                                                                | Decision                            | Reason                                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser attachment     | Playwright `launchPersistentContext` on a managed profile; CDP attach optional (`browser/launcher.ts`, `detect.ts`, 397 ln)                                                                                             | Extension + native messaging host (`native-messaging-host.ts`, 334 ln)                                                                                                      | **Port theirs, drop ours**          | Chrome 136 blocks CDP on the real profile. Only the extension reaches the authenticated browser. Ours forces a second login.                                                                                                                                     |
| Extension transport    | None                                                                                                                                                                                                                    | Length-prefixed stdio framing, UUID request correlation, pending-request map, timeouts (`native-messaging-host.ts`)                                                         | **Port nearly verbatim**            | Clean, complete, ~330 lines. Fix: it is a module singleton and calls `process.exit` from `cleanup()`.                                                                                                                                                            |
| Native host install    | None                                                                                                                                                                                                                    | Cross-platform manifest writing, Windows registry keys (`scripts/browser-config.ts`, `register.ts`)                                                                         | **Port and extend**                 | Handles Chrome + Chromium only. **Edge paths are missing** despite Edge being a v1 target; we add `Microsoft/Edge/NativeMessagingHosts`.                                                                                                                         |
| MCP transport          | stdio only, low-level `Server` + `setRequestHandler` (`mcp/server.ts`)                                                                                                                                                  | stdio + SSE + streamable HTTP over Fastify (`server/index.ts`)                                                                                                              | **Port theirs, add auth**           | We need HTTP for multi-client. Theirs has no authentication at all on `/mcp`.                                                                                                                                                                                    |
| Multi-client isolation | Single process, per-profile session, serialized queue per browser (`session.ts`)                                                                                                                                        | **Broken**: `getMcpServer()` returns one process-wide `Server` connected to every transport; `nativeMessagingHostInstance` is a module singleton                            | **Rewrite**                         | Confirms [#321](https://github.com/hangwin/mcp-chrome/issues/321) from source. Needs per-connection server instances plus tab leases. Our serialized-queue idea is right but scoped to one process.                                                              |
| Tool registry          | Static list built per request, rebuilt on fingerprint change, `notifications/tools/list_changed` (`mcp/server.ts`)                                                                                                      | `Map` of name → tool in the extension (`tools/index.ts`, 34 ln); schemas hard-coded in `packages/shared/src/tools.ts`                                                       | **Keep ours, adopt their dispatch** | Ours reloads recipes without restarting the agent, which theirs cannot do. Their dispatch map is the right shape for the extension side.                                                                                                                         |
| Site adapter registry  | Does not exist (sites + recorded recipes only)                                                                                                                                                                          | Does not exist                                                                                                                                                              | **Build new**                       | This is the actual product. Neither codebase has it.                                                                                                                                                                                                             |
| Selector generation    | In-page candidate generation + Node-side verification against live DOM using element identity (`overlay.js`, `verify.ts`, ~500 ln of the total)                                                                         | Strategy pattern with stability scoring, fingerprints, DOM paths, shadow-DOM traversal, composite frame selectors (`shared/selector/*`, 2,787 ln)                           | **Port theirs**                     | Theirs is DOM-native, which is required once Playwright's locator engine is gone. Richer: `anchor-relpath`, `stability.ts` signal scoring, `fingerprint.ts` fuzzy re-matching.                                                                                   |
| Element location       | Playwright locators (auto-wait, role/text engines, shadow-piercing CSS, frames for free)                                                                                                                                | `SelectorLocator` + ref indirection through `chrome_read_page` (`selector/locator.ts`, 544 ln)                                                                              | **Port theirs**                     | Same reason. Note their `click.ts` must call `READ_PAGE` before every locate to populate refs, a real cost we should optimise.                                                                                                                                   |
| Auto-wait              | Inherited from Playwright                                                                                                                                                                                               | Hand-rolled: `waitForNavigationDone`, `waitForNetworkIdle`, `maybeQuickWaitForNav`, explicit visibility check (`handlers/click.ts`)                                         | **Port theirs, keep behaviours**    | We lose Playwright's auto-wait, so these become load-bearing. They are decent and already handle nav vs network-idle vs quick sniff.                                                                                                                             |
| Workflow recording     | Capture-phase listeners, shadow-DOM overlay, pick-data mode, list detection with auto-derived fields (`overlay.js` 779 ln, `record.ts` 342 ln)                                                                          | Same approach, more mature: `inject-scripts/recorder.js` (1,950 ln), same `click`/`input`/`change`/`keydown`/`scroll` capture listeners, `hideInputValues`, session manager | **Port theirs, graft two of ours**  | Theirs wins on maturity and is wired to their selector engine. Ours has two ideas theirs lacks: **repeated-element detection → list extraction with auto-derived fields**, and **password fields becoming required secret parameters instead of stored values**. |
| Workflow replay        | Linear step runner, 24 step types, `{{param}}` templating (`runner.ts`, 413 ln)                                                                                                                                         | Graph engine: scheduler, control flow, assertions, HTTP steps, triggers, v2→v3 migration (`record-replay/`, 13,606 ln + `record-replay-v3/`)                                | **Adapt theirs, trim hard**         | Theirs is far more capable and far larger. Triggers (cron/interval/DOM/context-menu) are not needed for v1 and expand the attack surface. Take the action handlers and step executor; leave the trigger engine.                                                  |
| Permissions            | Per-site origin allowlist with subdomain matching, `allowEvaluate` off by default, evaluate steps stripped on pack install (`origins.ts`, `pack.ts`)                                                                    | `<all_urls>` plus `debugger`, `history`, `bookmarks`, `downloads`, `webRequest`, `declarativeNetRequest`, `scripting` (`wxt.config.ts`)                                     | **Keep ours, rebuild theirs**       | Their surface is inappropriate for an agent driving authenticated accounts. Our origin guard maps cleanly onto adapter-declared origins.                                                                                                                         |
| Result serialization   | Compact JSON, screenshots as file paths not inline base64 unless asked, readable-text extraction that strips nav/header/footer (`page-tools.ts`, `mcp/server.ts`)                                                       | Returns page content, accessibility trees, network captures                                                                                                                 | **Keep ours**                       | Directly serves the token goal. `AdapterResult<T>` from the plan should replace the ad-hoc shape.                                                                                                                                                                |
| Tool naming            | `linkedin_search_people`; underscore chosen deliberately, 64-char clamp with hash suffix (`mcp/naming.ts`)                                                                                                              | `flow.<slug>`, dotted                                                                                                                                                       | **Keep ours**                       | See below, dotted names are a real compatibility risk, and the plan document inherits it.                                                                                                                                                                        |
| Sharing / distribution | `.ygs.json` pack format, export, install from file/URL/gist, pre-install audit showing origins, write-actions and secrets, `evaluate` steps stripped unless `--allow-evaluate` (`pack.ts`, `commands/share.ts`, 369 ln) | None                                                                                                                                                                        | **Keep ours**                       | Nothing equivalent upstream. This is the "post an adapter on Twitter" requirement.                                                                                                                                                                               |
| Cross-platform install | `ygs init/setup/doctor/browsers`, Playwright browser download                                                                                                                                                           | `postinstall` + `register.ts` + `doctor.ts` (1,099 ln)                                                                                                                      | **Port theirs, keep our CLI shape** | Theirs does the native-host registration we now need. Ours has the friendlier surface.                                                                                                                                                                           |
| Testing                | **None**                                                                                                                                                                                                                | Vitest suites under `app/chrome-extension/tests/` incl. `record-replay`, `rpc-api`                                                                                          | **Adopt theirs**                    | There was no test suite to run before changing anything; that is a gap we introduced and should close.                                                                                                                                                           |

---

## Smaller findings worth recording

### Dotted tool names are a compatibility risk

`mcp-chrome` publishes `flow.<slug>`. Hosts constrain tool names to
`^[a-zA-Z0-9_-]{1,64}$` after prefixing, and a dot fails that pattern.
`linkedin_search_people` reads the same and is portable. For a real namespace,
run one MCP server for each site.

### `chrome_read_page` before every locate

`handlers/click.ts:52` calls `READ_PAGE` before locating, to populate element refs. On a large page this is the dominant cost of a click and part of why generic browsing is expensive. Adapters that navigate straight to a known URL and extract by selector avoid it entirely.

### No Edge support in the native host registration

`BrowserType` covers Chrome and Chromium only. Edge is a stated v1 target and needs its own manifest path and registry key.

### Out-of-scope surface is the majority of the extension

The repository holds about 152k lines outside `node_modules`. The web editor,
the ONNX runtime, the similarity engine, the vector database and the agent chat
service are all unrelated to a browser bridge. The vector cluster comes out. The
interaction surface stays in scope.

---

## What survives from the prototype

Kept roughly as-is: `pack.ts`, `commands/share.ts`, `mcp/naming.ts`, `browser/origins.ts`, `config/schema.ts` (step and param schemas), `config/store.ts`, `config/paths.ts`, `util/*`, and the CLI shape in `cli.ts` + `commands/`.

### Kept as ideas

Re-implemented against the new engine: `page-tools.ts` readable-text extraction, `genericTools: 'auto'` policy, list-extraction with auto-derived fields, password-to-secret-parameter handling, and the compact result formatting.

### Dropped

We drop `browser/launcher.ts`, `browser/detect.ts`, `browser/session.ts`,
`browser/selectors.ts`, and the Playwright path in `browser/runner.ts`.
Playwright stays for adapter development and tests, but it is no longer the
production engine. The upstream recorder supersedes `recorder/overlay.js` and `recorder/verify.ts`,
and we graft on the two behaviours named above.

---

## Attribution

Ported code carries an SPDX header naming `hangwin/mcp-chrome` and the MIT licence text is vendored at `licenses/mcp-chrome-LICENSE`. `NOTICE.md` lists every ported file with its upstream path and commit.
