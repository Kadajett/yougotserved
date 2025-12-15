# Agent Sidepanel Integration Plan

目标：在现有架构上新增一条“Sidepanel Chat UI → Native Node Agent → 本地 CLI/SDK → MCP → Chrome 工具”的完整链路，复用已有模块，不引入自研协议。

原始问题（需求来源）：

> 当前项目是一个chrome mcp server，浏览器插件，它同时包含了插件端和native
> server（本地node服务），我在项目下的other/cweb目录放了另一个项目的代码，这个项目是一个用网页来调用本地cli工具的项目
> 现在需要你和codex一起帮我深入分析，假设我要在我的chrome插件里做类似的事情，比如打开sidepanel，在上面继承一个chatbot，然后实际上是
> 调用本地的claude code或者codex，并且把我现有的mcp 工具提供给这些agent用，可行吗？

> All technical contracts, identifiers, and comments are in English.  
> 中文段落用于解释设计理由与风险，方便后续评审。

---

## 0. Scope, Current Status & Non‑Goals

### 0.1 Original Requirement (restated)

- Provide a full “Claudable-like” experience inside this repo:
  - Chrome sidepanel offers a chatbot UI similar to `other/cweb` (Claudable web app).
  - Native Node server runs agents on top of local CLIs/SDKs (Claude Code, Codex, etc.).
  - Existing MCP Chrome tools are exposed to these agents without reinventing protocols.
  - Design must reuse existing MCP server, native host, and extension infrastructure.

中文说明：目标不是做个“demo 聊天框”，而是在当前工程里落地一套可长期演进的 Claudable 等价能力，将 `other/cweb` 的 CLI + 项目 + 历史 + 工具使用能力迁移到本项目的 native-server + 浏览器插件架构上。

### 0.2 Current Status (2025‑12‑11)

- End‑to‑end path `Sidepanel → Native Server → Codex CLI → MCP (ready) → Sidepanel` 已经打通：
  - Sidepanel 有独立的 “智能助手” tab，连到本地 Fastify server。
  - `AgentChatService` + `CodexEngine` 实际调用 `codex exec --json`，按 Claudable 的事件协议解析并回放到前端。
  - Agent 层复用现有 MCP server（未重复造轮子），`AgentToolBridge` 已实现但暂未启用。
- 项目与工作区：
  - Native 层有轻量项目模型（存储在 `~/.chrome-mcp-agent/projects.json`），包含 `rootPath`、`preferredCli`、`selectedModel`等。
  - Sidepanel 支持列出项目、创建项目，并在 UI 中展示当前 workspace 路径；可通过 override 临时指定 root。
- 聊天历史：
  - 按项目将消息持久化到 `~/.chrome-mcp-agent/messages/<projectId>.json`，包含 user/assistant/tool 消息。
  - Sidepanel 在选择项目时会加载历史消息，再通过 SSE 接续实时事件。
- 多引擎抽象（当前仅 Codex 实现）：
  - `AgentEngine` 抽象支持多种 CLI/SDK（Claude、Codex、Cursor 等）。
  - `AgentChatService` 使用优先级链路选择 engine 和 model（请求 → 项目 → 默认），并通过 `/agent/engines` 向前端公开可用引擎列表。

中文说明：当前实现已经处于“单引擎（Codex）版本的 Claudable”，具备项目管理、历史记录、工具调用和 CLI 偏好选择能力；后续重点是补齐多引擎（Claude/Cursor）、MCP 深度集成与长连接可靠性。

### 0.3 Scope & Non‑Goals

- In scope
  - Add a chatbot experience to the extension sidepanel.
  - Run agent logic in `app/native-server` (Fastify + CLI/SDK engines).
  - Let supported CLIs/SDKs consume the existing MCP server (`mcp-chrome-bridge`) to access Chrome tools.
  - Use HTTP + SSE/WebSocket between sidepanel and native server for chat streaming.
- Extended scope (2025‑12‑11, Claudeable parity)
  - Align agent-facing capabilities with the `other/cweb` Claudable project so that, from the extension UI, a user can:
    - manage projects/workspaces,
    - run multi-step CLI-driven coding sessions (Claude/Codex/etc.),
    - see structured tool usage (Bash, file changes, plans, MCP-aware tools),
    - and review conversation/code history,
      using the native server as the single backend.
- Out of scope (for this iteration)
  - Multi-user auth or remote access (local machine only).
  - Long-term conversation storage in DB (initially in-memory or lightweight file-based).
  - Full-blown multi-agent orchestration framework.

中文说明：本迭代专注「单机本地开发者侧」使用场景，先打通端到端链路，后续再考虑多用户、远程访问与复杂调度。

---

## 1. High-Level Architecture

### 1.1 End-to-End Flow

1. User opens extension sidepanel, switches to `Agent Chat` tab.
2. Sidepanel Vue component sends a `POST /agent/chat/:sessionId/act` request to native server with:
   - `sessionId` / `projectId` (scoped conversation id)
   - `instruction` (user prompt)
   - optional `attachments`, `cliPreference`, `model`
3. Native Fastify handler delegates to `AgentChatService`:
   - resolves active engine (Claude Code / Codex / Cursor / etc.)
   - kicks off CLI/SDK execution in a background task
   - pushes streaming events to `AgentStreamManager`.
4. Sidepanel maintains an SSE or WebSocket connection to `/agent/chat/:sessionId/stream`:
   - receives `RealtimeEvent` objects (user echo, assistant chunks, tool status, errors).
   - updates local Vue state to render chat log and status indicators.
5. When the CLI/SDK needs tools:
   - Preferred path: the CLI/SDK is configured to use `mcp-chrome-bridge` as an MCP server, and directly calls tools via MCP.
   - Fallback: `AgentToolBridge` interprets CLI tool events and uses `@modelcontextprotocol/sdk` client to call `/mcp`, then feeds back results.

### 1.2 Module Placement

- Chrome extension sidepanel
  - `app/chrome-extension/entrypoints/sidepanel/App.vue`
  - `app/chrome-extension/entrypoints/sidepanel/components/AgentChat.vue` (new)
- Native server (agent backend)
  - `app/native-server/src/agent/chat-service.ts` (new)
  - `app/native-server/src/agent/engines/claude.ts` (new)
  - `app/native-server/src/agent/engines/codex.ts` (new)
  - `app/native-server/src/agent/engines/cursor.ts` (new, placeholder if needed)
  - `app/native-server/src/agent/engines/types.ts` (new)
  - `app/native-server/src/agent/stream-manager.ts` (new)
  - `app/native-server/src/agent/types.ts` (new: `RealtimeEvent`, message models)
  - `app/native-server/src/agent/tool-bridge.ts` (new, optional for non-MCP CLIs)
  - Fastify route wiring in `app/native-server/src/server/index.ts` (extend existing server).
- MCP server reuse
  - Continue using `app/native-server/src/mcp/mcp-server.ts` + `register-tools.ts`.
  - Reuse `packages/shared/src/tools.ts` and `TOOL_SCHEMAS` for tool contracts.

中文说明：所有新模块尽量集中在 `app/native-server/src/agent`，避免侵入现有 MCP 与 native host 流程，降低回归风险。

---

## 2. Data Models & Contracts

### 2.1 RealtimeEvent (Agent Stream)

Define shared types under `app/native-server/src/agent/types.ts`:

```ts
export type AgentRole = 'user' | 'assistant' | 'tool' | 'system';

export interface AgentMessage {
  id: string;
  sessionId: string;
  role: AgentRole;
  content: string;
  messageType: 'chat' | 'tool_use' | 'tool_result' | 'status';
  cliSource?: string; // 'claude' | 'codex' | 'cursor' | ...
  requestId?: string;
  isStreaming?: boolean;
  isFinal?: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type RealtimeEvent =
  | { type: 'message'; data: AgentMessage }
  | {
      type: 'status';
      data: {
        sessionId: string;
        status: 'starting' | 'ready' | 'running' | 'completed' | 'error';
        message?: string;
        requestId?: string;
      };
    }
  | { type: 'error'; error: string; data?: { sessionId?: string; requestId?: string } }
  | {
      type: 'connected';
      data: {
        sessionId: string;
        transport: 'sse' | 'websocket';
        timestamp: string;
      };
    }
  | { type: 'heartbeat'; data: { timestamp: string } };
```

中文说明：该结构基本复用 `other/cweb/TECHNICAL_ANALYSIS.md` 中的 RealtimeEvent，方便未来如需引入数据库或多客户端复用。

### 2.2 HTTP / Streaming API Contracts

All endpoints live under `/agent` prefix on the native server.

- `POST /agent/chat/:sessionId/act`
  - Request body:
    ```ts
    interface AgentActRequest {
      instruction: string;
      cliPreference?: 'claude' | 'codex' | 'cursor' | 'qwen' | 'glm';
      model?: string;
      attachments?: Array<{
        type: 'file' | 'image';
        name: string;
        mimeType: string;
        dataBase64: string;
      }>;
    }
    ```
  - Response body:
    ```ts
    interface AgentActResponse {
      requestId: string;
      sessionId: string;
      status: 'accepted';
    }
    ```

- `GET /agent/chat/:sessionId/stream` (SSE)
  - Headers: `Content-Type: text/event-stream`, etc.
  - Payload: `data: <JSON encoded RealtimeEvent>\n\n`.

Later (optional): `GET /agent/chat/:sessionId/history` for non-stream reloads.

### 2.3 Engine Abstraction

`app/native-server/src/agent/engines/types.ts`:

```ts
export interface EngineInitOptions {
  sessionId: string;
  instruction: string;
  model?: string;
  projectRoot?: string;
}

export type EngineName = 'claude' | 'codex' | 'cursor' | 'qwen' | 'glm';

export interface EngineExecutionContext {
  // Emits RealtimeEvent objects to connected clients
  emit(event: import('../types.js').RealtimeEvent): void;
}

export interface AgentEngine {
  name: EngineName;
  supportsMcp?: boolean; // whether this engine can act as an MCP client natively
  initializeAndRun(options: EngineInitOptions, ctx: EngineExecutionContext): Promise<void>;
}
```

每个具体 engine（例如 `claude.ts`, `codex.ts`）实现 `AgentEngine`，负责包装底层 CLI/SDK 调用和事件转换。

---

## 3. Native Server Changes

### 3.1 AgentStreamManager

New module: `app/native-server/src/agent/stream-manager.ts`.

Responsibilities:

- Manage SSE and/or WebSocket connections keyed by `sessionId`.
- Broadcast `RealtimeEvent` to all active connections in a session.
- Heartbeat & dead-connection pruning.

Key API:

```ts
export class AgentStreamManager {
  addSseStream(sessionId: string, controller: ReadableStreamDefaultController<Uint8Array>): void;
  removeSseStream(sessionId: string, controller: ReadableStreamDefaultController<Uint8Array>): void;

  // optional WebSocket management if we add WS later
  addWebSocket(sessionId: string, socket: import('ws').WebSocket): void;
  removeWebSocket(sessionId: string, socket: import('ws').WebSocket): void;

  publish(event: RealtimeEvent): void;
}
```

Implementation notes:

- For SSE: reuse patterns from `other/cweb`:
  - encode message: `const msg = 'data: ' + JSON.stringify(event) + '\n\n';`
  - use `TextEncoder` to push bytes into controller.
- Heartbeat: one interval timer that sends `heartbeat` events every 30 seconds per active session.

### 3.2 AgentChatService

New module: `app/native-server/src/agent/chat-service.ts`.

Responsibilities:

- Resolve which `AgentEngine` to use for a request.
- Maintain in-memory state per `sessionId` (active engine, last used CLI, etc.).
- Trigger CLI/SDK execution asynchronously and expose events through `AgentStreamManager`.

Sketch API:

```ts
export interface AgentChatServiceOptions {
  engines: AgentEngine[];
  streamManager: AgentStreamManager;
}

export class AgentChatService {
  constructor(options: AgentChatServiceOptions);

  handleAct(sessionId: string, payload: AgentActRequest): Promise<{ requestId: string }>;
}
```

Implementation notes:

- `handleAct`:
  - generate `requestId` (UUID).
  - pick engine:
    - `payload.cliPreference` if provided.
    - fallback to default CLI (configurable env or constant).
  - emit `status: starting → running`.
  - fire-and-forget `engine.initializeAndRun(..., ctx)`; catch errors and emit `status: error`.

### 3.3 Fastify Route Wiring

Extend `app/native-server/src/server/index.ts`:

- Initialize `AgentStreamManager` and `AgentChatService` in `Server` constructor.
- Add routes:

```ts
this.fastify.post('/agent/chat/:sessionId/act', async (request, reply) => {
  /* parse, delegate to AgentChatService */
});

this.fastify.get('/agent/chat/:sessionId/stream', async (request, reply) => {
  // Set SSE headers, create ReadableStream + controller,
  // register with AgentStreamManager, and clean up on close.
});
```

中文说明：这些改动集中在 Fastify 层，MCP 现有路由 (`/mcp`, `/sse`, `/ask-extension`) 维持不变，降低对现有 MCP 客户端的影响。

---

## 4. Engine Implementations

### 4.1 Claude Engine (preferred path via Claude Agent SDK)

File: `app/native-server/src/agent/engines/claude.ts`

Responsibilities:

- Wrap `@anthropic-ai/claude-agent-sdk` (or Claude Code CLI) into `AgentEngine`.
- Translate SDK events into `RealtimeEvent`.
- Encourage native MCP client usage when possible.

Steps:

1. Detect availability and configure MCP server in Claude SDK options:
   - If SDK supports MCP configuration, point it to:
     - HTTP endpoint: `http://127.0.0.1:56889/mcp` or
     - Stdio server: `mcp-chrome-stdio`.
2. In `initializeAndRun`:
   - Build SDK `query` or equivalent payload:
     - `prompt: instruction`
     - `options.cwd` / project root if needed
     - `options.model`, `maxOutputTokens`, etc.
   - Iterate over SDK async iterator:
     - For text deltas: emit `RealtimeEvent` with `isStreaming: true`.
     - For final assistant message: emit `isFinal: true`.
     - For tool invocations:
       - If SDK already handles MCP: just surface them as status messages to user.
       - If not: delegate to `AgentToolBridge` (see 4.3).

中文说明：Claude engine 优先使用 SDK 内置能力（包括 MCP），避免自己解析过于复杂的事件协议；只有在必要时才接入 tool bridge。

### 4.2 Codex / Cursor / Others (CLI process-based engines)

Files:

- `app/native-server/src/agent/engines/codex.ts`
- `app/native-server/src/agent/engines/cursor.ts`

Responsibilities:

- Spawn CLI processes (e.g. `codex exec`, `cursor-agent exec`), similar to `other/cweb` patterns.
- Parse JSON line streams and map them into `RealtimeEvent`.
- Integrate MCP via:
  - CLI’s own MCP support (preferred), or
  - `AgentToolBridge` if CLI exposes tool events but not MCP.

Implementation outline:

1. Build command and args (project path, model, session id, etc.).
2. Spawn process with controlled `cwd` and environment (use existing sandbox approach from `other/cweb`).
3. Use `readline` to consume `stdout` line by line, parse JSON events.
4. For each event:
   - Map `assistant` / `delta` to `RealtimeEvent`.
   - Map `tool_use` / `tool_result` to `RealtimeEvent` and, if required, `AgentToolBridge`.
5. Implement robust cleanup:
   - On completion or error: kill process if still alive.
   - Timeout protection: kill process after configurable maximum runtime.

### 4.3 AgentToolBridge (fallback for non-MCP CLIs)

File: `app/native-server/src/agent/tool-bridge.ts`

Responsibilities:

- Bridge CLI-specific tool events to MCP `CallTool` invocations against `ChromeMcpServer`.

Key ideas:

- Use `@modelcontextprotocol/sdk` `Client` with `StreamableHTTPClientTransport` pointing to `http://127.0.0.1:56889/mcp`.
- Map CLI tool request structure into MCP tool calls:

```ts
export class AgentToolBridge {
  constructor(private mcpClient: Client) {}

  async callToolFromCliEvent(cliEvent: any): Promise<any> {
    const { toolName, args } = extractFromCliEvent(cliEvent);
    const result = await this.mcpClient.callTool({
      name: toolName,
      arguments: args,
    });
    return result;
  }
}
```

中文说明：此桥接层仅在 CLI 不能原生使用 MCP 时启用；对 Claude SDK / 未来 agent 生态，优先直接配置 MCP server，减少自维护代码。

---

## 5. Sidepanel UI Changes

### 5.1 Add Agent Chat Tab

File: `app/chrome-extension/entrypoints/sidepanel/App.vue`

Tasks:

- Extend tab state:
  - from `activeTab: 'workflows' | 'element-markers'`
  - to `activeTab: 'workflows' | 'element-markers' | 'agent-chat'`
- Add a new tab button labeled e.g. `智能助手` / `Agent Chat`.
- Render `AgentChat` component when `activeTab === 'agent-chat'`.

### 5.2 AgentChat Component

New file: `app/chrome-extension/entrypoints/sidepanel/components/AgentChat.vue`.

Responsibilities:

- Manage chat input, message list, and streaming connection to native server.
- Ensure native host / server is running before sending requests.

Key behaviors:

1. On mount:
   - Call background: `GET_SERVER_STATUS` via `chrome.runtime.sendMessage`.
   - If server not running:
     - send `NativeMessageType.CONNECT_NATIVE` to start native host + server.
   - After confirmation, open SSE connection:
     - `new EventSource('http://127.0.0.1:56889/agent/chat/:sessionId/stream')`.
2. On user send:
   - Append optimistic user message to local state.
   - `fetch('http://127.0.0.1:56889/agent/chat/:sessionId/act', { method: 'POST', body })`.
3. On SSE message:
   - Parse `RealtimeEvent` and merge into Vue reactive state:
     - `message` events → chat log.
     - `status` events → loading indicators (running/completed).
     - `error` events → toast / inline error.
4. On unmount:
   - Close SSE connection, reset local state.

中文说明：Sidepanel 不做任何工具路由逻辑，只需要可靠地展示 agent 输出与状态，所有 CLI/MCP 调度留给 native server。

---

## 6. Configuration and MCP Integration

### 6.1 MCP Server Reuse

Native server already exposes MCP server:

- HTTP: `/mcp` (Streamable HTTP transport).
- SSE: `/mcp` GET for streaming.
- Stdio: `mcp-chrome-stdio` binary (`dist/mcp/mcp-server-stdio.js`).

No structural changes are required; we only:

- Optionally add a small helper to expose MCP base URL to engines.
- Make sure the MCP server is started at the same time as the native Fastify server (already true via `getMcpServer()` usage).

### 6.2 CLI / SDK MCP Config (High-Level)

This part depends on each CLI/SDK’s official MCP integration, but design assumption:

- For CLI that supports HTTP MCP servers:
  - Configure a server entry pointing to `http://127.0.0.1:56889/mcp`.
- For CLI that prefers stdio MCP:
  - Configure `mcp-chrome-stdio` as a server command.

中文说明：配置细节需要参考各 CLI 官方文档（例如 Codex、Claude Code），但从 MCP 协议侧看，本项目已经提供完整的 server 能力，无需额外协议。

---

## 7. Security & Safety Considerations

- Native server is bound to `127.0.0.1`, not exposed externally.
- CORS is enabled (`CORS_ORIGIN: true`) primarily for the extension; we should:
  - Confirm this does not unintentionally allow untrusted origins.
  - If necessary, restrict origins to `chrome-extension://<id>` and `moz-extension://*` patterns.
- CLI sandboxing:
  - Reuse the project path security pattern from `other/cweb` (resolve absolute path, ensure within allowed base directory).
  - Avoid allowing arbitrary paths from sidepanel without validation.
- Resource cleanup:
  - Ensure each engine has robust process termination and timeout.
  - Ensure `AgentStreamManager` cleans up SSE/WebSocket connections on close.

---

## 8. Implementation Phasing

Suggested small, verifiable steps:

1. **Scaffold agent backend types and stream manager**
   - Add `agent/types.ts`, `agent/stream-manager.ts`.
   - Wire minimal `/agent/chat/:sessionId/stream` SSE endpoint that only sends heartbeat and dummy events.
2. **Add Agent Chat tab in sidepanel**
   - Basic UI + SSE connection to dummy backend.
   - Verify end-to-end connectivity and error handling.
3. **Implement AgentChatService and minimal mock engine**
   - Add `AgentChatService` with a fake engine that echoes user instructions with a delay.
   - Verify streaming UX in sidepanel.
4. **Integrate first real engine (Claude or Codex)**
   - Implement one `AgentEngine` concrete class.
   - Ensure process / SDK lifecycle and error propagation are correct.
5. **Connect MCP via CLI native support or AgentToolBridge**
   - For chosen engine, configure MCP usage.
   - Validate that a simple Chrome MCP tool (e.g. `chrome_get_windows_and_tabs`) can be triggered from inside a chat session.
6. **Harden security, timeouts, and reconnection**
   - Add timeouts, cleanup, and reconnection strategies.
   - Document expected failure modes (CLI not installed, MCP server not reachable, etc.).

---

### 8.0.1 Claudeable Capability Parity Roadmap

To align with the `other/cweb` Claudable project without blindly copying code, we will migrate capabilities by layer, reusing patterns but adapting to this repo’s Fastify + extension-native architecture:

1. **Realtime / CLI integration (done first)**
   - Define agent-side `RealtimeEvent` and `AgentMessage` types compatible with Claudable’s `RealtimeMessage`.
   - Implement an `AgentStreamManager` for SSE streaming (session-scoped, heartbeat, cleanup).
   - Implement `AgentEngine` abstraction and at least one real CLI engine (Codex) that:
     - spawns the CLI,
     - parses JSON line events,
     - converts assistant/tool events into `RealtimeEvent`.
2. **Project & workspace model (backend)**
   - Introduce a lightweight project model in `app/native-server` (initially filesystem-based, not tied to Next.js/Prisma).
   - Provide APIs to list/select projects and derive a safe `projectRoot`/working directory per session.
3. **Chat history & message persistence**
   - Define message storage interfaces and implement local persistence (DB or structured files) behind a service layer.
   - Expose history APIs (e.g. `GET /agent/chat/:projectId/messages`) and adapt the sidepanel chat UI to show past conversations, not only streaming state.
4. **Multi-engine support (Claude/Cursor/Qwen/GLM)**
   - For each engine, add an `AgentEngine` implementation that wraps the official CLI/SDK, mirrors the Claudable event mapping, and uses the same `AgentChatService` abstraction.
5. **MCP integration (CLI-native first, bridge as fallback)**
   - Prefer configuring CLIs/SDKs to call the chrome MCP server directly (streamable HTTP `http://127.0.0.1:<port>/mcp` or stdio).
   - Use `AgentToolBridge` only for engines that emit explicit tool invocation events but cannot talk MCP natively.
6. **UX parity with Claudable**
   - Bring over key UX affordances into the extension:
     - project/workspace switcher,
     - rich tool traces (command/file/plan cards),
     - session/request status indicators.
   - Adapt layouts and flows to sidepanel/popup constraints instead of one-to-one copying React components.

中文说明：以上 roadmap 用于指导「能力迁移」而非「代码复制」——每一层都以现有 native-server + Chrome 插件为基础，复用 Claudable 的设计与协议，但避免引入不适合当前架构的实现细节（例如 Next.js App Router 或 Electron 特定逻辑）。

### 8.1 Implementation Status (2025-12-11, Codex)

- [x] Step 1 – `app/native-server/src/agent/types.ts` and `app/native-server/src/agent/stream-manager.ts` added, `/agent/chat/:sessionId/stream` SSE endpoint wired in `app/native-server/src/server/index.ts`. Stream manager broadcasts `connected` + `heartbeat` events; business events are emitted by `AgentChatService` and engines.
- [x] Step 2 – Sidepanel tab bar extended in `app/chrome-extension/entrypoints/sidepanel/App.vue` with `智能助手` (Agent Chat) tab; new `AgentChat` component at `app/chrome-extension/entrypoints/sidepanel/components/AgentChat.vue` connects to the native server via SSE and shows chat history, connection status, error states, and an editable `projectRoot` field persisted in `chrome.storage.local`.
- [x] Step 3 – `AgentChatService` implemented in `app/native-server/src/agent/chat-service.ts` to normalize user messages and status events and delegate execution to `AgentEngine` implementations. `AgentActRequest.projectRoot` is threaded into `EngineInitOptions.projectRoot` for workspace-aware engines.
- [x] Step 4 – First real CLI engine wired: `CodexEngine` in `app/native-server/src/agent/engines/codex.ts` spawns the `codex` CLI with JSON streaming, parses `item.started` / `item.delta` / `item.completed` / `item.failed` / `error` events, and streams both assistant messages (`role: 'assistant'`) and structured tool messages (`role: 'tool'`, covering command execution, file changes, and todo/plan updates) as `RealtimeEvent` objects to the sidepanel. The previous mock engine has been removed from the server wiring.
- [x] Step 5 (bridge building) – `AgentToolBridge` added in `app/native-server/src/agent/tool-bridge.ts`, using `@modelcontextprotocol/sdk`’s `Client` + `StreamableHTTPClientTransport` to talk to the existing HTTP MCP endpoint (`http://127.0.0.1:<port>/mcp`). The bridge exposes a `callTool` method accepting a CLI-style invocation (`server`, `tool`, `args`) and returning a typed MCP tool result. Current Codex integration sets `supportsMcp = false` and does not yet invoke this bridge; the bridge is intended for future engines (e.g. Claude Agent SDK) or for Codex once its MCP event shape is finalized.
- [x] Step 5 (UI wiring for project root) – Sidepanel `AgentChat` supports a persistent `projectRoot` text field; this value is sent with each `POST /agent/chat/:sessionId/act` and used by `CodexEngine` as the working directory (falling back to `MCP_AGENT_PROJECT_ROOT` or `process.cwd()` when unset).
- [x] Project model (backend, roadmap 2) – File-backed project store implemented in `app/native-server/src/agent/project-service.ts` and `project-types.ts`, with REST APIs wired in `app/native-server/src/server/index.ts`:
  - `GET /agent/projects` → list stored projects (sorted by `lastActiveAt`/`updatedAt`).
  - `POST /agent/projects` → create or update a project (`name`, `rootPath` required).
  - `DELETE /agent/projects/:id` → remove a project from the store.
    `AgentChatService` now accepts `projectId` in `AgentActRequest` and resolves `projectRoot` via this service when provided. Project activity timestamps are updated when a chat request is handled.
- [x] Project selection in sidepanel UI (roadmap 2 + 6/partial) – Agent sidepanel now includes a project dropdown and inline create flow in `app/chrome-extension/entrypoints/sidepanel/components/AgentChat.vue`:
  - Loads projects from `GET /agent/projects`, persists the selected project id in `chrome.storage.local.agentSelectedProjectId`, and shows the resolved workspace path.
  - Allows creating a new project (`name` + `rootPath`) from the sidepanel, wiring directly into the native server API and selecting the new project automatically.
  - Keeps an optional “root override” input (persisted as `agentProjectRoot`) for advanced users who want to temporarily override the project workspace.
- [x] Chat history & message persistence (roadmap 3) – A file-backed message store is implemented in `app/native-server/src/agent/message-service.ts`, with history APIs wired in `app/native-server/src/server/index.ts`:
  - Messages are stored per project under `~/.chrome-mcp-agent/messages/<projectId>.json` (overridable via `CHROME_MCP_AGENT_MESSAGES_DIR`).
  - `AgentChatService` persists user/assistant/tool messages when a `projectId` is present, storing only final (non-streaming) snapshots.
  - HTTP APIs:
    - `GET /agent/chat/:projectId/messages?limit=200&offset=0` → load ordered history with pagination metadata.
    - `POST /agent/chat/:projectId/messages` → append a message from external callers (not yet used by the extension, reserved for future tooling).
    - `DELETE /agent/chat/:projectId/messages` → clear all history (optionally filtered by `conversationId`).
  - Sidepanel `AgentChat.vue` loads history for the selected project on mount and when the selection changes, mapping stored messages into `AgentMessage` entries before realtime streaming resumes.
- [x] Engine discovery and selection (roadmap 4/partial) – `AgentChatService` now resolves the active engine per request using a priority chain (request-level `cliPreference` → project-level `preferredCli` → default engine), and exposes registered engines via `getEngineInfos()`. The native server exports `GET /agent/engines` so the extension can discover available engines instead of hard-coding names. Sidepanel `AgentChat.vue` renders a CLI + model row:
  - CLI dropdown lists engines from `/agent/engines` (currently `codex`), with an “Auto” option that lets the server choose based on project preference.
  - Model input is sent as `AgentActRequest.model` and persisted per project via `POST /agent/projects` (`preferredCli` / `selectedModel` fields), mirroring Claudable’s CLI preference behavior at a project level.
- [ ] Step 6 – More advanced timeouts, per-session cancel/abort, and reconnection strategies are still pending; current implementation includes a per-run timeout (`CODEX_ENGINE_TIMEOUT_MS`), stderr collection, basic JSON parse hardening, and coarse-grained error propagation via `status: error`, but does not yet classify failure modes for the UI or integrate automatic SSE reconnection in the sidepanel.
- [ ] Parity roadmap – Remaining items under “8.0.1 Claudeable Capability Parity Roadmap” (additional engines and engine selection UI, CLI-native MCP usage, richer tool UX, and automatic SSE/WebSocket reconnection) are not yet implemented; these define the remaining work to turn the current agent backend into a full Claudable-equivalent service inside this repo.

中文说明：当前已完成「Sidepanel → Native Server → Codex CLI → Sidepanel」的端到端链路，并对 Codex 工具事件（命令执行、文件变更、计划/TODO 列表）进行结构化映射，前端可以看到 `role: tool` 的消息流。MCP Bridge 已按官方 SDK 完整打好（Streamable HTTP 客户端 + Client），但尚未与具体 CLI 事件绑定，避免在缺乏 Codex MCP 事件规范的前提下做过多假设；后续接入 Claude/Cursor 或 Codex 的 MCP 事件时，可直接复用该桥接层。

## 9. Handover Checklist & Next Steps

### 9.1 What We Have Now (baseline for new contributors)

- Chrome extension
  - Sidepanel tab `智能助手` wired in `app/chrome-extension/entrypoints/sidepanel/App.vue`.
  - `AgentChat.vue` handles:
    - Native host/server discovery via background messages.
    - SSE connection to `/agent/chat/:sessionId/stream`.
    - Project list/create/select UI and workspace display.
    - CLI/model selection row (currently only `codex` listed from `/agent/engines`).
    - History loading for the selected project from `/agent/chat/:projectId/messages`.
- Native server (agent backend)
  - `AgentStreamManager` (`app/native-server/src/agent/stream-manager.ts`) streams `RealtimeEvent` to SSE/WebSocket clients.
  - `AgentChatService` (`app/native-server/src/agent/chat-service.ts`) coordinates:
    - engine selection: `cliPreference` → project `preferredCli` → default engine,
    - project root resolution via `projectId` → `AgentProject.rootPath`,
    - message persistence into project history when `projectId` is present.
  - `CodexEngine` (`app/native-server/src/agent/engines/codex.ts`) wraps the `codex` CLI and maps JSON events to:
    - assistant messages (`role: 'assistant'`),
    - structured tool messages (`role: 'tool'`, `tool_use` / `tool_result` for Bash, file changes, TODO/plan updates).
  - Project store (`project-service.ts` / `project-types.ts`) and message store (`message-service.ts`) are file-based and live under `~/.chrome-mcp-agent`.
  - MCP server remains in `app/native-server/src/mcp/*`, reused by agents via `AgentToolBridge` when needed.

### 9.2 Immediate Next Steps (high-priority tasks)

1. **Add at least one more real engine (Claude)**
   - Implement `ClaudeEngine` in `app/native-server/src/agent/engines/claude.ts`:
     - Reuse patterns from `other/cweb/lib/services/cli/claude.ts` for tool-message enrichment and error handling.
     - Emit `RealtimeEvent` using the same `AgentMessage` structure as `CodexEngine`, including `tool_use`/`tool_result` messages.
   - Register the engine in `Server` (`app/native-server/src/server/index.ts`) by passing `[new CodexEngine(), new ClaudeEngine()]` into `AgentChatService`.
   - Extend `AgentCliPreference` / `EngineName` unions if needed, and ensure `/agent/engines` exposes the new engine.

2. **Tighten engine selection UX**
   - In `AgentChat.vue`, make engine choice explicit:
     - Show which engine is active for the current project (e.g. `codex` / `claude`) and whether it is configured.
     - Optionally gray-out engines that are not installed or misconfigured (requires a small health check endpoint per engine).
   - Persist CLI/model choice per project only (keep request-level override, but favour project-level settings to mirror Claudable’s behavior).

3. **MCP integration (from “ready” to “used”)**
   - For CLIs/SDKs that already support HTTP MCP (Codex, Claude Code):
     - Document concrete config examples in this repo (e.g. sample CLI config pointing to `http://127.0.0.1:<port>/mcp`).
     - Validate that typical chrome MCP tools (e.g. `chrome_read_page`, `chrome_network_request`) can be invoked end-to-end from CLI through MCP.
   - For engines that emit tool invocation events but do not call MCP themselves:
     - Define the expected tool event schema for that engine in `AgentToolBridge`.
     - Wire `AgentToolBridge.callTool` into the engine implementation and map results back into `role: 'tool'` messages.

4. **Reliability & control paths**
   - SSE / WebSocket robustness:
     - Implement reconnection/backoff logic in `AgentChat.vue` (reference `other/cweb/hooks/useWebSocket.ts` and its SSE fallback).
     - Add clear UI states for `connecting` / `disconnected` / `reconnecting`.
   - Cancellation:
     - Add a per-session cancel endpoint (e.g. `DELETE /agent/chat/:sessionId`) that:
       - tracks running engine processes,
       - sends a termination signal to the child process (Codex, Claude, etc.).
     - Expose a “Stop” / “Cancel” button in the sidepanel that calls this endpoint.
   - Error classification:
     - Standardize error codes / messages in `AgentChatService` for:
       - CLI not found,
       - workspace path invalid/inaccessible,
       - MCP server unreachable,
       - CLI output malformed.
     - Surface these in `AgentStatusEvent.message` for better UX.

5. **History & project management UX (nice-to-have but valuable)**
   - Project management:
     - Allow renaming / deleting projects from sidepanel (hook into existing `/agent/projects` DELETE).
     - Show `lastActiveAt` and message count summary next to each project in the selector.
   - History controls:
     - Add “Clear history” for the current project (calls `DELETE /agent/chat/:projectId/messages`).
     - Optionally support pagination UI if history becomes large (using `limit`/`offset` in the existing GET API).

中文说明：本节为“交接清单”，优先级从高到低排列。新的开发者可以按 9.2 中的任务逐项推进，每一项都对应明确的文件位置与接口约定，避免重复摸索现有实现。

## 10. Open Questions / To Clarify

1. Session identity
   - Should `sessionId` be tied to:
     - current tab URL?
     - a user-chosen project/workspace?
     - or a simple random UUID per sidepanel open?
2. Project root / workspace support
   - Do we want sidepanel to be able to select a local project directory?
   - If yes, we need a file-picker flow and security checks.
3. CLI preference persistence
   - Should CLI choice/model mirror `other/cweb/useCLI` (persisted per project)?
   - For now, a simple per-session runtime preference may be enough.

中文说明：这些开放问题不会阻挡基础架构落地，但会影响 UX 和「项目 / 工作区」的长期定位，建议在首次实现后由产品/上游 Agent 再决策。
