# NOTICE

This project is a fork of **[hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome)**,
MIT licensed, © 2024 hangye.

Forked at commit `f48e717` ("Merge pull request #272 from hangwin/feat/element-annotations",
2026-01-06). The upstream git history is preserved in this repository, and the upstream remote
is configured as `upstream`, so individual upstream fixes can still be reviewed and cherry-picked.

The original MIT licence is retained verbatim in [`LICENSE`](./LICENSE) and applies to all code
inherited from upstream. Modifications and new code in this fork are released under the same
MIT licence.

## What we inherited and rely on

- Chrome extension and native-messaging host architecture
- Native messaging framing, request correlation and timeouts
- Cross-platform native-host registration
- MCP transports (stdio, SSE, streamable HTTP)
- Selector engine: strategies, stability scoring, fingerprints, DOM paths, shadow DOM
- Interaction recorder and the record/replay action handlers
- Element picker and element marker
- Vitest suites for record/replay

## What this fork changes

See [`AUDIT.md`](./AUDIT.md) for the component-by-component comparison and
[`DECISIONS.md`](./DECISIONS.md) for what was kept, rewritten or removed. In summary: the fork
narrows the product to a secure local browser bridge plus compact, typed, per-site adapter
tools, removes several large out-of-scope subsystems, reduces the extension permission
surface, and replaces the process-wide MCP server singleton with per-connection sessions.

## Third-party components removed from this fork

Removed along with their dependencies: the bundled ONNX runtime, the vector database and
semantic similarity engine, the WASM SIMD package, the agent chat service, and the visual web
editor. Their licences no longer apply to this distribution.
