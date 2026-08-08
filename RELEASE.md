# Release plan

Two artifacts ship separately. The extension goes to the Chrome Web Store. The
bridge goes to npm. They must match, because the native host trusts one
extension ID.

## Extension permissions

The manifest asked for 16 permissions. It now asks for 13. `history`,
`bookmarks` and `declarativeNetRequest` are gone, with the four tools that used
them. Those tools read the whole browsing history and the whole bookmark tree,
which no site adapter needs.

One item still needs work. `debugger` with `<all_urls>` is the pair a reviewer
questions first, so the listing must justify both in plain words. `PRIVACY.md`
carries that wording and the store listing can reuse it.

| Permission              | Used by                      | State                                  |
| ----------------------- | ---------------------------- | -------------------------------------- |
| `debugger`              | File upload, network capture | Keep. Justify it in the listing        |
| `<all_urls>`            | Every content script         | Open. Replace with per-origin requests |
| `webRequest`            | Network capture              | Open. Remove if `debugger` covers it   |
| `history`               | Removed                      | Done                                   |
| `bookmarks`             | Removed                      | Done                                   |
| `declarativeNetRequest` | Nothing                      | Done                                   |

### Why webRequest stays

`chrome_network_capture` uses `webRequest` when the caller does not need a
response body, and the debugger only when it does. Attaching the debugger shows
a banner on the page, so dropping `webRequest` would make the common case worse.

### Why the two were removed, not made optional

`chrome.permissions.request` needs a user gesture. A tool call arrives in the
service worker with no gesture, so an optional `history` or `bookmarks` tool
could never grant itself. Removal was the honest option.

## Signing keys

Never put a signing key in the repository. The upstream release bundle held a
private RSA key, and we purged it from this fork's history.

Store our key as a Wrangler secret, and let the release job read it from there.

```bash
wrangler secret put CHROME_EXTENSION_KEY
wrangler secret put CHROME_CLIENT_SECRET
wrangler secret put CHROME_REFRESH_TOKEN
```

## Step 1: pick the production extension ID

Chrome derives the ID from the manifest `key`. The native host trusts one ID, so
the ID must be fixed before the bridge is published.

```bash
ygs register --extension-id <the production id>
```

## Step 2: publish the bridge to npm

The extension welcome page tells users to install this package. Publish it
first, or the install screen points at nothing. `prepack` refuses to build a
tarball that declares a workspace dependency.

```bash
pnpm --filter ygs-bridge build && npm publish
```

### Always install the tarball before you trust a publish

Version 0.1.0 shipped two `workspace:*` dependencies and could not be installed
by anyone. It built, packed and uploaded without a complaint, and it ran on a
machine that had the workspace. Only a clean install shows this.

```bash
npm pack && cd $(mktemp -d) && npm init -y && npm install <path>/ygs-bridge-*.tgz
```

## Step 3: submit the extension

The store review asks for a justification for each permission and a privacy
policy URL. Write both before you upload.

- Single purpose: run site-specific tools in the user's own browser session
- `debugger`: set files on a file input, which no other API allows
- Host permissions: requested for each origin when an adapter is installed
- Data use: nothing leaves the machine. No analytics in the extension

## Step 4: registry

The registry serves packs as static files and runs no adapter code. That keeps
the extension inside the store policy that forbids remotely hosted code.

Download counts and ratings live in D1. The free tier covers 5 GB and 5 million
row reads each day, which is far above what this needs.

## What is not built yet

Be honest about the gap. These block a working end-to-end release.

- The adapter host is not wired into MCP, so adapter tools do not reach a client
- `chrome_extract` does not exist, so `page.extract` has no page-side runner
- The registry Worker, D1 schema and site are not written
- `uploadToDropZone` is declared and not implemented
- Permission trimming above is not started

## Order

1. Trim permissions and rebuild
2. Wire the adapter host and add `chrome_extract`
3. Ship the registry, then point the welcome page at it
4. Publish the bridge to npm
5. Submit the extension
