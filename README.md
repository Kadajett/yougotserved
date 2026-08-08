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
npm install -g @yougotserved/bridge
ygs doctor
```

## Use

An adapter turns a site into a small set of typed tools. Point your MCP client
at one adapter, and the tools arrive with plain names.

```bash
ygs serve --adapter linkedin
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

```bash
ygs adapter publish linkedin
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
MIT licensed. The git history holds their 191 commits. The native messaging
host, the selector engine, and the record and replay engine come from that work.

We removed the vector database, the agent chat service, and the web editor. We
added the adapter SDK, the pack format, and the origin and capability limits.
Read [NOTICE.md](./NOTICE.md) for the full list.

## Layout

| Path                   | Holds                                        |
| ---------------------- | -------------------------------------------- |
| `packages/adapter-sdk` | Adapter SDK, pack format, step interpreter   |
| `app/chrome-extension` | Chrome extension, tool handlers              |
| `app/native-server`    | Native messaging host, MCP server            |
| `apps/registry`        | Adapter registry, Cloudflare Worker and site |
| `examples`             | Example adapters                             |
