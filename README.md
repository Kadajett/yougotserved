# youGotServed

Give a coding agent one tool that does the job, instead of thirty that describe
a browser. `linkedin_search_people` costs about 300 tokens of schema. The
generic browser toolset costs about 8,300 tokens in every session, before the
agent does any work.

Tools run in the browser you already signed in to. There is no second profile,
no headless copy, and no cookie export. Chrome 136 ignores
`--remote-debugging-port` on the default user data directory, so an extension
and a native messaging host do the work instead.

## Install

The bridge speaks to the extension over native messaging. Run the doctor command
after you install, because it checks the manifest paths and the port.

```bash
npm install -g ygs-bridge
ygs doctor
```

Install the extension from the Chrome Web Store, or build it yourself below.

## Run it from source

Build everything first. The extension lands in `.output/chrome-mv3`.

```bash
pnpm install
pnpm build
```

## Load the extension

Open `chrome://extensions`, turn on Developer mode, and choose Load unpacked.
Point it at `app/chrome-extension/.output/chrome-mv3`.

Chrome derives the extension ID from the folder path. A local build gets a
different ID from the published one, so register the host for that ID.

```bash
node app/native-server/dist/cli.js register --extension-id <id-from-chrome>
node app/native-server/dist/cli.js doctor
```

## Point your client at it

The bridge serves MCP over stdio. Add it to your client config, using the
absolute path to your checkout.

```json
{
  "mcpServers": {
    "ygs": {
      "command": "node",
      "args": ["/abs/path/to/youGotServed/app/native-server/dist/mcp/mcp-server-stdio.js"]
    }
  }
}
```

Claude Code takes the same thing in one line.

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
