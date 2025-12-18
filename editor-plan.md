# Web Visual Editor (Chrome Extension) — Implementation Plan

## 0) Goal

Build a **visual in-page editor** for local dev pages (e.g. `localhost`) that:

- Enters/exits **Edit Mode** via **keyboard shortcut**, **right-click context menu**, or a **Popup button**.
- Lets the user **hover + click to select** an element with a high-performance overlay.
- Allows **quick visual edits** (v1: text + inline styles) with optimistic DOM updates.
- Sends a structured “intent payload” to the existing **AgentChat** backend so the AI Agent can **persist changes into source code**.

Non-goals (v1):

- Full Figma/Webflow-grade layout editing, multi-select, constraints, snapping, history/undo.
- Cross-origin iframe editing (same-origin can be added later).
- Perfect framework source mapping in production builds (dev-mode metadata first).

## 1) Context Scan (Evidence-Based)

### 1.1 Similar patterns we will reuse

1. **Record/Replay triggers** (hotkeys + context menus)

- `app/chrome-extension/wxt.config.ts` (manifest `commands`)
- `app/chrome-extension/entrypoints/background/record-replay/index.ts` (`chrome.commands` + `chrome.contextMenus`)

2. **Injected overlay + selection**

- `app/chrome-extension/inject-scripts/accessibility-tree-helper.js` (`rr_picker_start` overlay + capture listeners)

3. **Background-driven injection + context menu**

- `app/chrome-extension/entrypoints/background/element-marker/index.ts` (idempotent inject + overlay control)

### 1.2 Integration points (data-path)

- **Popup (Vue)** → `chrome.runtime.sendMessage` → **Background**
- **Background** → `chrome.scripting.executeScript` → **Injected Script** (ISOLATED world)
- **Injected Script** → `chrome.runtime.sendMessage` → **Background**
- **Background** → HTTP `POST /agent/chat/:sessionId/act` → **Native Server** → **AgentChatService** → **Engine** (Codex/Claude/…)

### 1.3 Tech stack + conventions

- Extension: Vue 3 + WXT + TS, injected scripts are plain JS under `app/chrome-extension/inject-scripts/`.
- Backend: Fastify (native server), AgentChat already exists.
- Formatting: Prettier + ESLint.
- Tests: Jest exists in `app/native-server` (extension has no automated tests today).

## 2) Key Questions (Prioritized)

High:

- What is the **minimum set of editing operations** to ship v1 end-to-end (visual edit → AI persists)?
- What is the **source localization contract** we can reliably provide (React/Vue dev metadata vs fallback fingerprint)?
- How do we ensure **Edit Mode does not trigger page actions** (navigation/form submit) while keeping scrolling usable?

Medium:

- Should we open the Side Panel (AgentChat) automatically after “Sync to Code”?
- How should we store per-tab editor state (ephemeral per page load vs persisted)?

Low:

- Cross-frame (same-origin iframe) support.
- Advanced overlay rendering (guides, spacing, multi-rect).

## 3) Target Contract (v1)

### 3.1 Background messages

- `BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_TOGGLE`
  - Called from Popup / commands / context menu
  - Effect: inject editor script if needed, then toggle edit mode on the active tab

- `BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_APPLY`
  - Called from injected script when the user clicks “Sync to Code”
  - Effect: build an AgentChat prompt and call `/agent/chat/:sessionId/act`

### 3.2 Injected script messages (tab → injected)

- `action: "web_editor_ping"` → `{ status: "pong" }`
- `action: "web_editor_toggle"` → `{ active: boolean }`
- (optional) `action: "web_editor_start" | "web_editor_stop"`

### 3.3 Apply payload schema (injected → background)

```ts
type WebEditorInstructionType = 'update_text' | 'update_style';

interface WebEditorFingerprint {
  tag: string;
  id?: string;
  classes: string[];
  text?: string; // short snippet
}

interface WebEditorApplyPayload {
  pageUrl: string;
  targetFile?: string; // best-effort (React/Vue dev metadata)
  fingerprint: WebEditorFingerprint;
  techStackHint?: string[];
  instruction: {
    type: WebEditorInstructionType;
    description: string;
    text?: string;
    style?: Record<string, string>;
  };
}
```

### 3.4 Prompt template (background → AgentChat)

The prompt MUST be deterministic, explicit, and tool-friendly:

- If `targetFile` is available: instruct to edit that file (and related CSS modules if needed).
- Else: instruct to `rg` search using `fingerprint.text` and/or stable classes.
- Prefer Tailwind class edits if Tailwind is detected; otherwise update CSS module / inline styles.
- Apply the requested change and keep other behavior unchanged.

## 4) Milestones & Tasks (Checklist)

### M1 — Edit Mode activation (toggle)

- [x] Add manifest command: `toggle_web_editor` (suggested key: `Ctrl+Shift+E`)
- [x] Add background module `web-editor` with:
  - [x] context menu item “Toggle Web Editor”
  - [x] `chrome.commands` listener for `toggle_web_editor`
  - [x] runtime message handler for Popup toggle
  - [x] idempotent injection + `web_editor_toggle` tab message
- [x] Add Popup section with a “Toggle Web Editor” button

### M2 — In-page overlay + selection (visual layer)

- [x] Add `inject-scripts/web-editor.js`:
  - [x] High-perf overlay using a fixed `<canvas>` (DPR-aware) + RAF loop
  - [x] Hover highlight + click-to-select
  - [x] Smart selection heuristics (skip transparent wrappers when appropriate)
  - [x] Capture-phase event interception (prevent page actions while editing)
  - [x] Exit via `Esc`

### M3 — Basic visual editing (v1)

- [x] Floating toolbar for selected element
- [x] Text edit (optimistic `textContent` update)
- [x] Inline style edit (CSS declarations → `style.setProperty`)

### M4 — Source localization (best-effort)

- [x] React dev metadata detection (Fiber `_debugSource.fileName`)
- [x] Vue 3 dev metadata detection (`instance.type.__file`)
- [x] `node_modules` escape: ignore and climb DOM parents
- [x] Fallback fingerprint capture (tag/id/classes/text snippet)

### M5 — Agent bridge (persist to code)

- [x] Read Agent project selection from `chrome.storage.local`:
  - `agent-selected-project-id`
  - `agent-project-root-override`
- [x] Background calls `POST /agent/chat/:sessionId/act` with `{ instruction, projectId, projectRoot }`
- [x] Injected UI shows success/error toast with returned `requestId`

### M6 — Verification

- [ ] `pnpm -r lint` (or scoped package lint) (blocked by pre-existing errors)
- [ ] `pnpm --filter mcp-chrome-bridge test` (native server regression) (currently failing in repo)
- [ ] Manual smoke:
  - Toggle Edit Mode via popup / context menu / hotkey
  - Select element, edit text/style, “Sync to Code”
  - Confirm AgentChat receives request (sidepanel) and code changes trigger HMR

## 5) Risks & Mitigations (v1)

- **React/Vue metadata missing in prod** → fallback fingerprint + `rg` search prompt.
- **Overlay intercepts too much** → allow scroll/wheel; allow toolbar interactions.
- **CORS / server unavailable** → do HTTP from background + show actionable error.

## 6) Progress Log

2025-12-17: Implemented M1–M5 end-to-end. Repo-wide lint/typecheck/tests are currently failing due to unrelated pre-existing issues; manual smoke test is the recommended verification step for this feature.
