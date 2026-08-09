# youGotServed

Give a coding agent one tool that does the job, instead of thirty that describe
a browser. `linkedin_search_people` costs about 300 tokens of schema. The
generic browser toolset costs about 8,300 tokens in every session, before the
agent does any work.

Tools run in the browser you already signed in to. There is no second profile,
no headless copy, and no cookie export. Chrome 136 ignores
`--remote-debugging-port` on the default user data directory, so an extension
and a native messaging host do the work instead.

## Two parts

There are two parts, and you need both.

The **bridge** is a program on your computer. It speaks MCP to your agent, and
native messaging to the extension. Install it from npm.

The **extension** drives Chrome. The Chrome Web Store still reviews it. Until
the review ends, build it yourself. The steps are below and they take a minute.

## What works without the extension

The bridge alone does the registry work. You can search adapters, install them,
sign in, and tip. Nothing opens a browser tab.

```bash
npm install -g ygs-bridge
ygs adapter search hacker
```

No tool touches a page until the extension connects. So install the bridge
first, and add the extension when you want the browser part.

## Install the bridge

```bash
npm install -g ygs-bridge
ygs register
ygs doctor
```

The `register` command writes the native messaging manifest. The `doctor`
command checks the manifest and the port. Every line must show OK.

Sign-in and the tip jar need version 0.1.5 or later. Check your version, and
install again if it is older.

```bash
ygs --version
```

## Install the extension

The store review is not finished. Build the extension yourself for now.

```bash
git clone https://github.com/Kadajett/yougotserved
cd yougotserved
pnpm install
pnpm build
```

The extension lands in `app/chrome-extension/.output/chrome-mv3`.

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Choose `app/chrome-extension/.output/chrome-mv3`.
5. Copy the extension ID that Chrome shows.

Chrome makes the ID from the folder path, so your ID differs from the published
one. Tell the bridge to permit your ID.

```bash
ygs register --extension-id <id-from-chrome>
ygs doctor
```

When the store approves the extension, install it in one click and run
`ygs register` with no options.

## Connect

1. Click the extension icon.
2. Check that the port is 12306.
3. Click Connect.

The dot turns green. If it stays red, restart Chrome and run `ygs doctor`.

## Point your client at it

The bridge serves MCP over stdio. Add it to your client config.

```json
{
  "mcpServers": {
    "ygs": { "command": "ygs-stdio" }
  }
}
```

Claude Code takes the same thing in one line.

```bash
claude mcp add ygs -- ygs-stdio
```

Restart the client. It then sees the `ygs_` tools.

If you built from source instead of installing from npm, name the file
directly.

```bash
claude mcp add ygs -- node /abs/path/to/youGotServed/app/native-server/dist/mcp/mcp-server-stdio.js
```

## Manage adapters

The bridge installs packs for you. `add` prints the origins and the abilities,
then asks before it writes.

```bash
ygs adapter search hacker
ygs adapter add hackernews
ygs adapter list
```

Your agent can do the same thing without leaving its session. See **Use** below.

## Sign in

Signing in is optional. Nothing needs an account. It gives your ratings and your
tips a name, and it reserves your adapter names when you publish.

```bash
ygs account login
```

The command prints a URL and a short code. Open the URL, type the code, and
approve it with your GitHub account. The terminal then prints your name.

The browser holds the GitHub part. The bridge never sees your GitHub password.

```bash
ygs account whoami
ygs account logout
```

## Tip

Everything is free. No tool, no adapter and no route is behind a payment, and
there is no plan to change that.

If you want to send something anyway, the tip jar takes USDC on Base:

<https://registry.yougotserved.dev/api/tip>

The page shows an address. Copy it, and send from any wallet. Coinbase sends to
Base without a bridge step.

Your agent can do this too. It reads the tip jar with `ygs_tip`, and records a
transfer you already sent.

```text
ygs_tip { "action": "how" }
ygs_tip { "action": "claim", "txHash": "0x..." }
```

Sign in first if you want your name on it.

The agent mentions the tip jar in one line, after a few registry calls. To stop
that line for good:

```text
ygs_tip { "action": "hide" }
```

## Change an adapter

Edit the JSON in `adapters/`, then check it. The check prints the digest and
what each tool is allowed to reach.

```bash
node scripts/adapters.mjs check
```

## Use

An adapter turns a site into a small set of typed tools. Your agent finds one
and installs it without leaving the session. The new tools then have plain
names, such as `linkedin_search_people`.

Install shows the origins and the capabilities first, and stops. It writes
nothing until you agree. The host checks each argument against the pack, and
each page address against the pack origins.

```text
ygs_search_adapters { "query": "linkedin" }
ygs_install_adapter { "id": "linkedin" }             -> shows the reach, refuses
ygs_install_adapter { "id": "linkedin", "confirm": true }
linkedin_search_people { "query": "rust compilers", "limit": 10 }
```

## Write an adapter

You do not write an adapter by hand. A coding agent reads the live page once,
then writes the file. Read [AUTHORING.md](./packages/adapter-sdk/AUTHORING.md)
for the loop.

```ts
search_people: defineTool({
  description: 'Search LinkedIn for people.',
  params: { query: p.string('What to search for') },
  handler: async (page, args) => page.extract({
    each: 'main [role="list"] [role="listitem"]',
    fields: { name: 'a[href*="/in/"] span[aria-hidden="true"]' },
  }),
}),
```

## Share an adapter

A published adapter is data, not code. `buildPack` compiles the step tools into
a JSON pack with a SHA-256 digest. The local engine reads the pack and never
runs code that came from the network.

Three reasons force this design. No review process can audit a stranger's
JavaScript that runs against a signed-in session. Chrome Web Store policy
forbids remotely hosted code. `node:vm` is not a security boundary.

## Publishing

Publishing runs from the repository, not the CLI. CI does it on every push that
touches `adapters/`. Set `YGS_PUBLISH_TOKEN` to run it yourself.

```bash
node scripts/adapters.mjs publish
```

## Security

An adapter runs against your real cookies. The host applies the limits, so an
adapter cannot widen its own reach at run time.

- The adapter states its origins. The host refuses any other navigation
- Extraction is a JSON spec. A pack cannot read `document.cookie` or call `fetch`
- `upload` and `evaluate` are never implicit. The author must declare them
- Upload paths are checked first. The host refuses `~/.ssh`, `.env` and `*.pem`
- An `irreversible` tool needs `confirm: true` from the caller

## Credit

This project started as a fork of [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome),
MIT licensed. The git history holds their 191 commits. The native messaging host
and the extension architecture come from that work.

We then removed every part we could not read and vouch for, and rewrote what we
kept. That took out the record and replay engine, the agent chat service, the
vector database, and the selector engine. We added the adapter SDK, the pack
format, and the origin and capability limits.

## Layout

| Path                   | Holds                                        |
| ---------------------- | -------------------------------------------- |
| `packages/adapter-sdk` | Adapter SDK, pack format, step interpreter   |
| `app/chrome-extension` | Chrome extension, tool handlers              |
| `app/native-server`    | Native messaging host, MCP server            |
| `apps/registry`        | Adapter registry, Cloudflare Worker and site |
| `examples`             | Example adapters                             |
