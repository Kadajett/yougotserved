# Notice

This project is a fork of [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome),
MIT licensed, copyright 2024 hangye. We forked at commit `f48e717` on
2026-01-06.

The git history holds the upstream commits, so you can read where each part came
from. The MIT licence stays in [LICENSE](./LICENSE) and applies to all inherited
code. New code in this fork uses the same licence.

## What we inherited

The browser bridge is upstream work. Our adapter layer sits on top of it and
would not exist without that base.

- Chrome extension and native messaging host architecture
- Native messaging framing, request correlation and timeouts
- Cross-platform native host registration
- MCP transports: stdio, SSE, and streamable HTTP
- Element picker

## What we changed

We narrowed the product to a local browser bridge plus typed per-site adapter
tools. Read [AUDIT.md](./AUDIT.md) for the component comparison and
[DECISIONS.md](./DECISIONS.md) for the reasoning.

We removed every part we could not read and vouch for. Their licences no longer
apply here, and the cut dropped three Chrome permissions: sidePanel,
contextMenus and alarms.

- ONNX runtime, vector database, semantic similarity engine, WASM SIMD package
- Agent chat service and the web editor
- Record and replay engine, selector engine, element markers

## Removed release bundle

The upstream repository holds a `releases/` directory. One file in it,
`chrome-mcp-server-lastest.zip`, contains a manifest with a private RSA-2048
key. That key derives the published extension ID
`hbdgbgagpkpjffpklnamcljpakneikee`.

We removed the directory and purged it from this fork's git history. Do not
restore it. We reported the exposure to the upstream author so that the key can
be rotated.
