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
- Selector engine: strategies, stability scoring, fingerprints, shadow DOM
- Interaction recorder and the record and replay action handlers
- Element picker and element marker
- Vitest suites for record and replay

## What we changed

We narrowed the product to a local browser bridge plus typed per-site adapter
tools. Read [AUDIT.md](./AUDIT.md) for the component comparison and
[DECISIONS.md](./DECISIONS.md) for the reasoning.

We removed the ONNX runtime, the vector database, the semantic similarity
engine, the WASM SIMD package, the agent chat service, and the web editor. Their
licences no longer apply to this distribution.

## Removed release bundle

The upstream repository holds a `releases/` directory. One file in it,
`chrome-mcp-server-lastest.zip`, contains a manifest with a private RSA-2048
key. That key derives the published extension ID
`hbdgbgagpkpjffpklnamcljpakneikee`.

We removed the directory and purged it from this fork's git history. Do not
restore it. We reported the exposure to the upstream author so that the key can
be rotated.
