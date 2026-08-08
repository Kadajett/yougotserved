# ARCHITECTURE

Companion to [AUDIT.md](./AUDIT.md) and [DECISIONS.md](./DECISIONS.md).

## What the system is

A local browser bridge plus a set of site adapters. It lets an MCP-compatible coding agent act
inside the browser the user is already logged into, through compact typed tools such as
`github_list_pull_requests` or `linkedin_search_people`, without the agent ever implementing
OAuth, replaying a login, or paging through a DOM snapshot.

Everything runs on the user's machine. Nothing is sent anywhere the adapter did not declare.

## Why an extension and not Playwright

Chrome 136 stopped honouring `--remote-debugging-port` on the default user-data directory, so
no CDP client can attach to the profile that holds the user's real sessions. Playwright can
only drive a separate profile, which means logging in again — the exact friction this product
removes. A browser extension talking to a local native-messaging host is currently the only
supported path to the authenticated profile.

Playwright stays in the repository for adapter development, locator semantics, integration
tests and workflow compilation. It is not the production execution engine.

## Layers

```
┌─ MCP clients (Claude Code, editors, other agents) ─────────────────┐
│   stdio  │  authenticated loopback HTTP                            │
└────┬─────────────────────────────────────────────────────────────┬─┘
     │                                                             │
┌────▼─────────────────────────────────────────────────────────────▼─┐
│ Broker (app/native-server)                                         │
│  · one MCP server instance per client connection                   │
│  · bearer auth, loopback binding, no permissive CORS               │
│  · tab leases, run cancellation, audit log                         │
│  · tool registry: adapters + published workflows                   │
└────┬───────────────────────────────────────────────────────────────┘
     │
┌────▼───────────────────────────────────────────────────────────────┐
│ Site adapters (packages/adapters/*)                                │
│  · typed input/output, declared origins, risk level                │
│  · speak only BrowserSession                                       │
└────┬───────────────────────────────────────────────────────────────┘
     │
┌────▼───────────────────────────────────────────────────────────────┐
│ BrowserSession (packages/bridge-core)                              │
│  stable internal interface: tabs, page, elements                   │
└────┬───────────────────────────────────────────────────────────────┘
     │  native messaging (length-prefixed stdio, correlated requests)
┌────▼───────────────────────────────────────────────────────────────┐
│ Chrome / Edge extension (app/chrome-extension)                     │
│  · selector engine, recorder, replay handlers, element picker      │
│  · executes against the user's authenticated tabs                  │
└────────────────────────────────────────────────────────────────────┘
```

**Layering rule:** nothing above `BrowserSession` may import native messaging, `chrome.*`, or
MCP transport types. An adapter that reaches past the interface is a bug, because it makes the
execution engine unswappable.

## Trust boundaries

There are four, and each one is a place where data changes trust level.

1. **MCP client → broker.** Callers are authenticated with a bearer token over loopback, or
   are the parent process over stdio. Tool arguments are untrusted until schema-validated.
2. **Broker → extension.** The broker can only ask for capabilities an adapter declared. The
   extension enforces the origin allowlist rather than trusting the broker's word.
3. **Extension → page.** The page is hostile. Content scripts read and act; page-supplied text
   never becomes an instruction.
4. **Page content → agent.** Everything returned is data. Page text that looks like a prompt
   is still page text. Results are compact and typed so there is little room to smuggle
   instructions through a wall of DOM.

## Permission model

Least privilege, declared per adapter and enforced at the bridge:

```ts
interface AdapterPermissions {
  origins: string[];
  capabilities: Array<
    'read-page' | 'navigate' | 'click' | 'fill' | 'upload' | 'download' | 'network-metadata'
  >;
}
```

The extension requests no `<all_urls>`, no `debugger`, no `history`, `bookmarks`,
`webRequest` or `declarativeNetRequest`. Host access is granted per origin as adapters are
installed.

Risk levels gate execution:

- `read` — observation only.
- `write` — changes state that is easy to undo, such as filling a draft.
- `irreversible` — sending, purchasing, deleting, changing permissions. Requires explicit
  confirmation and is never auto-approved.

## Multi-client model

Upstream connects a single process-wide MCP `Server` to every transport, so two agents share
one tool registry and one native host. This fork gives each connection its own session:

```ts
interface ClientSession {
  clientId: string;
  connectedAt: number;
  leasedTabs: Set<number>;
  activeRuns: Map<string, AbortController>;
  permissions: GrantedPermission[];
}
```

Reads may share a tab. Writes require a lease and are serialized. Disconnecting releases
leases. The extension shows which agent currently controls each tab, and offers a pause and
disconnect control.

## Result shape

```ts
interface AdapterResult<T> {
  ok: boolean;
  data?: T;
  warnings?: string[];
  nextCursor?: string;
  error?: { code: string; message: string; recoverable: boolean };
}
```

Never returned unless a diagnostic mode is explicitly requested: full HTML, complete
accessibility trees, screenshots, cookies, storage, network bodies. Never returned at all:
`Authorization`, `Cookie`, `Set-Cookie`, or password-type input values.

## Tool naming

`<adapter>_<tool>`, lower snake case: `github_list_pull_requests`. Dots are avoided because
hosts constrain tool names to `^[a-zA-Z0-9_-]{1,64}$` after prefixing, and a client such as
Claude Code exposes the tool as `mcp__ygs__github_list_pull_requests`. Running one server per
adapter gives a true namespace from the host instead: `mcp__github__list_pull_requests`.

## From recording to adapter

Recording is an authoring accelerator, not the final representation.

1. The user records an operation in their own browser.
2. The recorder captures ranked selector candidates, frame context and page transitions.
3. A draft workflow is generated as JSON.
4. Variables, outputs, validation and risk level are added.
5. The workflow is published and appears as an MCP tool without restarting the agent.
6. Frequently used or fragile workflows are promoted to code-defined adapters with real
   schemas and recovery behaviour.

Adapters are shareable as a single `.ygs.json` pack: origins, steps and schemas, never
cookies, profile data or recorded secrets. Installing one prints an audit of the origins it
will visit, what it changes, and which secrets it will ask for, and strips page-script steps
unless explicitly allowed.
