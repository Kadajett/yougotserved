# 可视化编辑器 (Visual Editor) 重构计划

## 一、项目概述

### 1.1 目标

基于 editor.md 中的需求讨论，将现有玩具级的可视化编辑器重写为企业级、Webflow/Figma 级丝滑体验的前端可视化工作台。

### 1.2 现状分析

- **入口**: `toggleEditorInTab` in `app/chrome-extension/entrypoints/background/web-editor/index.ts:205`
- **注入脚本**: `app/chrome-extension/inject-scripts/web-editor.js` (约 850 行单体 JS)
- **当前能力**:
  - 基础的 hover 高亮和 click 选中
  - Canvas 绘制选中框 (但性能有问题)
  - 简单的 Text/Style 编辑浮层
  - Sync to Code 发送给 Agent
- **主要问题**:
  - 无 Shadow DOM 隔离，样式易污染
  - mousemove 未节流，直接触发 layout
  - 不支持 Shadow DOM 内部元素选择
  - 不支持 iframe
  - payload fingerprint 过弱
  - 无拖拽重排能力
  - 无属性面板 (Design/CSS)
  - 无事务系统 (Undo/Redo)

### 1.3 技术决策

基于 codex 分析和 editor.md 方案，采用以下架构：

- **AR 架构**: Canvas 负责视觉反馈，DOM API 负责实际操作
- **Shadow DOM 隔离**: 所有编辑器 UI 在 ShadowRoot 内渲染
- **性能优先**: rAF 驱动、读写分离、按需渲染
- **渐进增强**: 基础模式 + 精准模式 (Vite 插件)
- **UI 技术栈**: Vue 3 (与项目保持一致，复用现有组件和构建链路)
- **事务系统**: 基于 Locator 而非 Element 引用 (支持 HMR/DOM 变更后恢复)(低优先级，先不考虑实现)

---

## 二、功能点清单

### A. 画布交互与选中系统

| ID  | 功能点                                                  | 优先级 | 复杂度 |
| --- | ------------------------------------------------------- | ------ | ------ |
| A0  | 事件拦截与编辑模式控制 (stopPropagation/preventDefault) | P0     | 低     |
| A1  | Hover 高亮 (60FPS)                                      | P0     | 中     |
| A2  | 智能去噪选中 (透明容器透传、视觉权重)                   | P0     | 高     |
| A3  | 单击选中 + 修饰键穿透/上钻                              | P0     | 中     |
| A4  | 面包屑导航 (composedPath)                               | P1     | 中     |
| A5  | Shadow DOM 内部元素支持                                 | P1     | 高     |
| A6  | iframe 内部元素支持                                     | P2     | 高     |
| A7  | 多选与框选                                              | P2     | 高     |
| A8  | 组件实例识别 (结构指纹聚类)                             | P2     | 高     |
| A9  | 编辑器自身元素过滤 (避免选中 overlay/toolbar)           | P0     | 低     |

### B. 视觉渲染引擎

| ID  | 功能点                               | 优先级 | 复杂度 |
| --- | ------------------------------------ | ------ | ------ |
| B1  | Shadow DOM 宿主隔离                  | P0     | 中     |
| B2  | Canvas Overlay 层 (选框/参考线)      | P0     | 高     |
| B3  | rAF 驱动渲染循环                     | P0     | 中     |
| B4  | 读写分离 (避免 layout thrash)        | P0     | 中     |
| B5  | ResizeObserver/MutationObserver 同步 | P1     | 中     |
| B6  | 按需渲染 (非常驻 tick)               | P1     | 低     |
| B7  | 智能对齐线与测距标注                 | P2     | 高     |
| B8  | 拖拽残影动画                         | P2     | 中     |
| B9  | Canvas DPR 适配 (高清屏支持)         | P0     | 低     |

### C. 属性面板 (Design/CSS)

| ID  | 功能点                                           | 优先级 | 复杂度 |
| --- | ------------------------------------------------ | ------ | ------ |
| C1  | Components 树 (DOM/组件层级)                     | P1     | 高     |
| C2  | Design 面板 - Position                           | P1     | 中     |
| C3  | Design 面板 - Layout (flex/grid)                 | P1     | 高     |
| C4  | Design 面板 - Size (W/H)                         | P1     | 中     |
| C5  | Design 面板 - Spacing (padding/margin)           | P1     | 中     |
| C6  | Design 面板 - Typography                         | P1     | 中     |
| C7  | Design 面板 - Appearance (opacity/radius/border) | P1     | 中     |
| C8  | CSS 面板 - 样式来源追踪                          | P2     | 高     |
| C9  | CSS 面板 - class 编辑                            | P2     | 中     |
| C10 | Design System Tokens 集成                        | P3     | 高     |

### D. 直接操控

| ID  | 功能点                           | 优先级 | 复杂度 |
| --- | -------------------------------- | ------ | ------ |
| D1  | 拖拽重排 (move node)             | P1     | 高     |
| D2  | 位置/尺寸手柄拖拽                | P2     | 高     |
| D3  | 智能吸附 (snap to edges/centers) | P2     | 高     |
| D4  | 文本直接编辑 (contentEditable)   | P1     | 中     |
| D5  | Group/Stack 结构化操作           | P3     | 高     |

### E. 变更事务系统(低优先级，先不考虑实现)

| ID  | 功能点                          | 优先级 | 复杂度 |
| --- | ------------------------------- | ------ | ------ |
| E1  | Transaction 记录 (before/after) | P0     | 高     |
| E2  | Undo/Redo 栈                    | P0     | 中     |
| E3  | 变更计数 UI (1 Edit)            | P1     | 低     |
| E4  | Apply 失败自动回滚              | P1     | 中     |
| E5  | 拖拽过程合并为单事务            | P1     | 中     |

### F. Apply 到代码同步链路

| ID  | 功能点                                     | 优先级 | 复杂度 |
| --- | ------------------------------------------ | ------ | ------ |
| F1  | Payload 规范化 (locator/operation/context) | P0     | 高     |
| F2  | 框架调试信息定位 (React/Vue)               | P0     | 中     |
| F3  | Selector 候选生成                          | P1     | 高     |
| F4  | Agent Prompt 优化                          | P1     | 中     |
| F5  | 执行结果反馈 UI                            | P1     | 中     |
| F6  | HMR 一致性校验                             | P2     | 高     |

### G. 工程化与兼容性

| ID  | 功能点                 | 优先级 | 复杂度 |
| --- | ---------------------- | ------ | ------ |
| G1  | 注入脚本 TypeScript 化 | P1     | 高     |
| G2  | 模块化架构 (分层清晰)  | P0     | 高     |
| G3  | 核心逻辑单元测试       | P2     | 中     |
| G4  | 性能监控 (FPS/内存)    | P2     | 中     |

---

## 三、技术架构设计

### 3.1 整体分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   Background                          │   │
│  │  - 注入控制 (toggleEditorInTab)                       │   │
│  │  - Agent Prompt 构建                                  │   │
│  │  - Native Server 通信                                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                            ↕ Message                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Inject Script (web-editor)               │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │              Shadow DOM Host                    │  │   │
│  │  │  ┌─────────────┐  ┌─────────────────────────┐  │  │   │
│  │  │  │   Canvas    │  │      UI Panel           │  │   │
│  │  │  │  Overlay    │  │  (Toolbar/Sidebar/Tree) │  │  │   │
│  │  │  │  (Renderer) │  │         (Vue 3)         │  │  │   │
│  │  │  └─────────────┘  └─────────────────────────┘  │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │              Core Logic Layer                   │  │   │
│  │  │  - InteractionEngine (事件/状态机)              │  │   │
│  │  │  - SelectionEngine (智能选中/指纹)              │  │   │
│  │  │  - TransactionManager (Undo/Redo)              │  │   │
│  │  │  - PayloadBuilder (上下文构建)                  │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↕ HTTP/SSE
┌─────────────────────────────────────────────────────────────┐
│                    Native Server                             │
│  - Agent 执行引擎 (Codex/Claude)                             │
│  - 代码定位与修改                                            │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 核心模块划分

#### 3.2.1 渲染层 (Renderer)

```typescript
// renderer/CanvasOverlay.ts
class CanvasOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dirty: boolean = false;

  // 绘制元素
  drawSelectionBox(rect: DOMRect, style: BoxStyle): void;
  drawHoverBox(rect: DOMRect): void;
  drawAlignmentGuides(guides: Guide[]): void;
  drawDistanceLabels(labels: DistanceLabel[]): void;
  drawDragGhost(rect: DOMRect, opacity: number): void;
  drawInsertionLine(position: InsertPosition): void;

  // 渲染控制
  markDirty(): void;
  render(): void; // 由 rAF 调用
  startRenderLoop(): void;
  stopRenderLoop(): void;
}
```

#### 3.2.2 交互层 (Interaction)

```typescript
// interaction/InteractionEngine.ts
type EditorState = 'idle' | 'hovering' | 'selected' | 'dragging' | 'editing';

class InteractionEngine {
  private state: EditorState = 'idle';
  private lastPointer: Point | null = null;

  // 事件处理 (只记录，不直接处理)
  handlePointerMove(e: PointerEvent): void;
  handlePointerDown(e: PointerEvent): void;
  handlePointerUp(e: PointerEvent): void;
  handleKeyDown(e: KeyboardEvent): void;

  // rAF 中调用的处理逻辑
  processFrame(): void {
    // 1. 读取阶段: elementFromPoint, getBoundingClientRect
    // 2. 计算阶段: 智能选中、拖拽位置
    // 3. 写入阶段: 更新 Canvas, 必要时更新 DOM
  }
}
```

#### 3.2.3 选中层 (Selection)

```typescript
// selection/SelectionEngine.ts
interface SelectionCandidate {
  element: Element;
  score: number;
  reasons: string[];
}

class SelectionEngine {
  // 智能选中
  findBestTarget(point: Point, modifiers: Modifiers): Element | null;

  // 候选评分
  private scoreCandidates(candidates: Element[]): SelectionCandidate[];

  // 启发式规则
  private hasVisualBoundary(el: Element): boolean;
  private isWrapperOnly(el: Element): boolean;
  private getInteractivityScore(el: Element): number;

  // 结构指纹
  computeFingerprint(el: Element): string;
  findSimilarElements(fingerprint: string): Element[];

  // Shadow DOM 支持
  getDeepElementFromPoint(x: number, y: number): Element | null;
}
```

#### 3.2.4 事务层 (Transaction)

```typescript
// transaction/TransactionManager.ts

// 使用 Locator 而非 Element 引用，支持 HMR/DOM 变更后恢复
interface ElementLocator {
  selectors: string[]; // CSS selector 候选列表
  fingerprint: string; // 结构指纹
  debugSource?: DebugSource; // React/Vue 调试信息
  path: number[]; // DOM 树路径 (childIndex 序列)
  // iframe/Shadow DOM 上下文 (Phase 2/4 需要)
  frameChain?: string[]; // iframe selector 链 (从 top 到目标 frame)
  shadowHostChain?: string[]; // Shadow DOM host selector 链
}

interface TransactionSnapshot {
  locator: ElementLocator;
  html?: string; // innerHTML 快照 (仅结构变更)
  styles?: Record<string, string>; // 变更的样式
  text?: string; // 文本内容
}

// move/structure 操作的详细数据结构
interface MoveOperationData {
  parentLocator: ElementLocator; // 目标父元素
  insertIndex: number; // 插入位置索引
  anchorLocator?: ElementLocator; // 锚点兄弟元素 (insertBefore 的参考)
  anchorPosition: 'before' | 'after';
}

interface StructureOperationData {
  action: 'wrap' | 'unwrap' | 'delete' | 'duplicate';
  wrapperTag?: string; // wrap 时的包装标签
  wrapperStyles?: Record<string, string>;
}

interface Transaction {
  id: string;
  type: 'style' | 'text' | 'move' | 'structure';
  targetLocator: ElementLocator; // 使用 Locator 而非 Element
  before: TransactionSnapshot;
  after: TransactionSnapshot;
  // move/structure 操作的额外数据
  moveData?: MoveOperationData;
  structureData?: StructureOperationData;
  timestamp: number;
  merged: boolean; // 是否已合并到上一个事务
}

class TransactionManager {
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];

  // 事务操作
  begin(type: Transaction['type'], target: Element): TransactionHandle;
  commit(handle: TransactionHandle): void;
  rollback(handle: TransactionHandle): void;

  // Undo/Redo (通过 Locator 重新定位元素)
  undo(): Transaction | null;
  redo(): Transaction | null;

  // 元素定位
  private locateElement(locator: ElementLocator): Element | null;

  // 合并策略 (连续的同类型操作合并)
  mergeIfContinuous(tx: Transaction): boolean;

  // 状态查询
  getPendingCount(): number;
  getHistory(): Transaction[];
}
```

#### 3.2.5 Payload 构建层

```typescript
// payload/PayloadBuilder.ts

// Payload 字段限制 (避免消息过大)
const PAYLOAD_LIMITS = {
  MAX_SELECTOR_COUNT: 5,
  MAX_SKELETON_DEPTH: 3,
  MAX_SKELETON_CHILDREN: 10,
  MAX_SIBLING_ANCHORS: 3,
  MAX_STYLE_PROPERTIES: 20,
  MAX_TEXT_LENGTH: 500,
  STYLE_WHITELIST: [
    'display',
    'position',
    'width',
    'height',
    'margin',
    'padding',
    'color',
    'background',
    'font-size',
    'font-weight',
    'flex',
    'grid',
    'gap',
  ],
};

interface EditorPayload {
  version: '1.0'; // Schema 版本，便于后续升级
  locator: {
    selectors: SelectorCandidate[];
    debugSource?: { file: string; line: number; column: number };
    fingerprint: ElementFingerprint;
  };
  operation: {
    type: 'update_text' | 'update_style' | 'move_node';
    before: any;
    after: any;
  };
  context: {
    parentSkeleton: string; // 精简版 HTML 骨架
    siblingAnchors: string[]; // 兄弟节点锚点
    computedStyles: Record<string, string>; // 白名单样式
    techStack: TechStackHint;
  };
}

class PayloadBuilder {
  build(transaction: Transaction): EditorPayload;

  // 定位信息
  private generateSelectors(el: Element): SelectorCandidate[];
  private extractDebugSource(el: Element): DebugSource | null;
  private buildFingerprint(el: Element): ElementFingerprint;

  // 上下文 (带限制)
  private extractParentSkeleton(el: Element, depth: number): string;
  private extractSiblingAnchors(el: Element): string[];
  private getRelevantStyles(el: Element): Record<string, string>;

  // 校验
  private validatePayload(payload: EditorPayload): boolean;
}
```

### 3.3 状态机设计

```
                    ┌──────────────┐
                    │    IDLE      │
                    └──────┬───────┘
                           │ pointermove (enter element)
                           ▼
                    ┌──────────────┐
              ┌─────│   HOVERING   │─────┐
              │     └──────┬───────┘     │
              │            │ click       │ pointermove (leave)
              │            ▼             │
              │     ┌──────────────┐     │
              │     │   SELECTED   │◄────┘
              │     └──────┬───────┘
              │            │
        ┌─────┼────────────┼────────────┐
        │     │            │            │
        │ pointerdown  dblclick    Escape/click outside
        │ + drag          │            │
        ▼                 ▼            ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   DRAGGING   │  │   EDITING    │  │    IDLE      │
└──────┬───────┘  └──────┬───────┘  └──────────────┘
       │                 │
       │ pointerup       │ blur/Enter/Escape
       ▼                 ▼
┌──────────────┐  ┌──────────────┐
│   SELECTED   │  │   SELECTED   │
│ (commit tx)  │  │ (commit tx)  │
└──────────────┘  └──────────────┘
```

### 3.4 消息协议设计

#### 3.4.1 注入脚本 ↔ Background

```typescript
// 控制消息
type ControlMessage =
  | { action: 'web_editor_ping' }
  | { action: 'web_editor_toggle' }
  | { action: 'web_editor_start' }
  | { action: 'web_editor_stop' };

// Apply 消息
interface ApplyMessage {
  type: 'web_editor_apply';
  payload: EditorPayload;
  sessionId: string;
}

// 结果回调 (F5 执行结果反馈链路)
interface ApplyResult {
  success: boolean;
  diff?: string;
  error?: string;
  suggestions?: string[];
}

// F5 执行结果订阅协议
interface ApplyStatusUpdate {
  type: 'web_editor_status';
  requestId: string;
  status: 'pending' | 'locating' | 'applying' | 'completed' | 'failed' | 'timeout';
  progress?: number; // 0-100
  message?: string; // 状态描述
  result?: ApplyResult; // 完成时的结果
  timestamp: number;
}

// Background 订阅 Agent SSE 事件后转发给 inject
// inject 通过 chrome.runtime.onMessage 接收状态更新
```

#### 3.4.2 iframe 跨帧通信

```typescript
// Top → Child
interface FrameHitTestRequest {
  type: 'web_editor_hit_test';
  x: number; // 相对于 iframe viewport
  y: number;
  requestId: string;
}

// Child → Top
interface FrameHitTestResponse {
  type: 'web_editor_hit_test_result';
  requestId: string;
  element: SerializedElement | null;
  rect: DOMRect | null;
}
```

---

## 四、任务拆分与执行计划

### Phase 0: 工程准备 (前置)

**目标**: 确定构建方式，准备开发环境

| 序号 | 任务                                                | 预估工作量 | 依赖 | 功能点 |
| ---- | --------------------------------------------------- | ---------- | ---- | ------ |
| 0.1  | 确定注入脚本构建方式 (IIFE vs TS 构建)              | 1h         | -    | G1     |
| 0.2  | 如选 TS 构建: 修改 WXT 配置支持 inject-scripts 编译 | 3h         | 0.1  | G1     |
| 0.3  | 创建 web-editor-v2 目录结构和模块骨架               | 1h         | 0.1  | G2     |

### Phase 1: 基础架构 (P0)

**目标**: 建立可工作的分层架构，替换现有实现

| 序号 | 任务                                       | 预估工作量 | 依赖     | 功能点           |
| ---- | ------------------------------------------ | ---------- | -------- | ---------------- |
| 1.1  | 创建新的模块化注入脚本结构                 | 2h         | Phase 0  | G2               |
| 1.2  | 实现 Shadow DOM 隔离宿主                   | 2h         | 1.1      | B1               |
| 1.3  | 实现 Canvas Overlay 基础渲染 (含 DPR 适配) | 4h         | 1.2      | B2, B9           |
| 1.4  | 实现事件拦截与模式控制                     | 2h         | 1.2      | A0, A9           |
| 1.5  | 实现 rAF 驱动的交互引擎                    | 4h         | 1.3, 1.4 | B3, B4           |
| 1.6  | 实现智能选中引擎 (基础版含单击选中)        | 4h         | 1.5      | A1, A2, A3(基础) |
| 1.7  | 实现 Transaction Manager (基于 Locator)    | 3h         | 1.5      | E1, E2           |
| 1.8  | 实现 Payload Builder (带限制)              | 3h         | 1.7      | F1, F2           |
| 1.9  | 对接现有 Background 通信                   | 2h         | 1.8      | -                |
| 1.10 | 基础 Toolbar UI (Apply/Undo/变更计数)      | 3h         | 1.9      | E3               |

### Phase 2: 核心交互 (P1)

**目标**: 实现 Figma 级的选中和编辑体验

| 序号 | 任务                                   | 预估工作量 | 依赖    | 功能点   |
| ---- | -------------------------------------- | ---------- | ------- | -------- |
| 2.1  | Shadow DOM 元素深度选择 (composedPath) | 3h         | Phase 1 | A5       |
| 2.2  | 面包屑导航 UI                          | 2h         | 2.1     | A4       |
| 2.3  | 修饰键交互 (Ctrl穿透/Shift上钻)        | 2h         | 2.1     | A3(高级) |
| 2.4  | 拖拽重排 - Canvas 部分 (ghost/插入线)  | 4h         | Phase 1 | B8       |
| 2.5  | 拖拽重排 - DOM 操作部分                | 3h         | 2.4     | D1       |
| 2.6  | 拖拽重排 - 事务集成 (合并连续操作)     | 2h         | 2.5     | E5       |
| 2.7  | 文本直接编辑 (contentEditable)         | 3h         | Phase 1 | D4       |
| 2.8  | Observer 同步 (Resize/Mutation)        | 2h         | Phase 1 | B5       |
| 2.9  | Selector 候选生成器                    | 3h         | Phase 1 | F3       |
| 2.10 | Apply 失败自动回滚                     | 2h         | 1.7     | E4       |

### Phase 3: 属性面板 (P1)

**目标**: 实现右侧 Design/CSS 面板

| 序号 | 任务                                          | 预估工作量 | 依赖    | 功能点 |
| ---- | --------------------------------------------- | ---------- | ------- | ------ |
| 3.1  | 面板容器与 Tab 切换 (Vue)                     | 2h         | Phase 1 | -      |
| 3.2  | Components 树 (DOM 层级)                      | 4h         | 3.1     | C1     |
| 3.3  | Position 控件                                 | 2h         | 3.1     | C2     |
| 3.4  | Layout 控件 (display/flex/grid)               | 4h         | 3.1     | C3     |
| 3.5  | Size 控件 (W/H)                               | 2h         | 3.1     | C4     |
| 3.6  | Spacing 控件 (padding/margin，支持拖拽 scrub) | 3h         | 3.1     | C5     |
| 3.7  | Typography 控件                               | 3h         | 3.1     | C6     |
| 3.8  | Appearance 控件 (opacity/radius/border)       | 3h         | 3.1     | C7     |
| 3.9  | 即时 DOM 应用 + 事务集成                      | 3h         | 3.2-3.8 | -      |
| 3.10 | 执行结果反馈 UI (requestId → 状态订阅)        | 3h         | 1.9     | F5     |
| 3.11 | Agent Prompt 优化 (利用新 payload)            | 2h         | 1.8     | F4     |

### Phase 4: 高级功能 (P2)

**目标**: 完善体验，增加高级能力

| 序号 | 任务                                            | 预估工作量 | 依赖    | 功能点 |
| ---- | ----------------------------------------------- | ---------- | ------- | ------ |
| 4.1  | iframe 支持 (allFrames 注入 + postMessage 桥接) | 6h         | Phase 2 | A6     |
| 4.2  | 智能对齐线与吸附                                | 4h         | Phase 2 | D3     |
| 4.3  | 测距标注                                        | 3h         | 4.2     | B7     |
| 4.4  | 组件实例识别 (结构指纹 + Worker 计算)           | 4h         | Phase 2 | A8     |
| 4.5  | 多选与框选                                      | 4h         | Phase 2 | A7     |
| 4.6  | CSS 面板 - 样式来源追踪                         | 4h         | Phase 3 | C8     |
| 4.7  | CSS 面板 - class 编辑                           | 3h         | 4.6     | C9     |
| 4.8  | HMR 一致性校验 (依赖结果反馈)                   | 3h         | 3.10    | F6     |
| 4.9  | 位置/尺寸手柄                                   | 4h         | Phase 2 | D2     |
| 4.10 | 按需渲染优化 (静止时停止 tick)                  | 2h         | Phase 1 | B6     |

### Phase 5: 工程化与增强 (P2-P3)

**目标**: 提升代码质量和可维护性，支持精准模式

| 序号 | 任务                                            | 预估工作量 | 依赖    | 功能点 |
| ---- | ----------------------------------------------- | ---------- | ------- | ------ |
| 5.1  | 注入脚本完全 TypeScript 化 (如 Phase 0 未完成)  | 6h         | Phase 3 | G1     |
| 5.2  | 核心逻辑单元测试 (scoring/fingerprint/geometry) | 4h         | 5.1     | G3     |
| 5.3  | 性能监控集成 (FPS/内存)                         | 3h         | Phase 4 | G4     |
| 5.4  | Design System Tokens 集成                       | 4h         | Phase 3 | C10    |
| 5.5  | Group/Stack 结构化操作                          | 4h         | Phase 2 | D5     |
| 5.6  | 文档与示例                                      | 3h         | Phase 4 | -      |

### Phase 6: 精准模式 (P3，可选)

**目标**: 支持 Vite 插件实现精准定位

| 序号 | 任务                                       | 预估工作量 | 依赖    | 功能点 |
| ---- | ------------------------------------------ | ---------- | ------- | ------ |
| 6.1  | Payload schema 增加 debugSource 版本化字段 | 2h         | Phase 1 | -      |
| 6.2  | Vite 插件开发 (注入 data-source-\*)        | 6h         | 6.1     | -      |
| 6.3  | 插件安装文档与 npm 发布                    | 2h         | 6.2     | -      |
| 6.4  | UI 检测 Vite 插件并提示安装                | 2h         | 6.2     | -      |

---

## 4.1 功能点 → 任务追踪表

| 功能点 ID | 功能点描述                      | 任务编号             |
| --------- | ------------------------------- | -------------------- |
| A0        | 事件拦截与编辑模式控制          | 1.4                  |
| A1        | Hover 高亮 (60FPS)              | 1.6                  |
| A2        | 智能去噪选中                    | 1.6                  |
| A3        | 单击选中 + 修饰键               | 1.6(基础), 2.3(高级) |
| A4        | 面包屑导航                      | 2.2                  |
| A5        | Shadow DOM 内部元素支持         | 2.1                  |
| A6        | iframe 内部元素支持             | 4.1                  |
| A7        | 多选与框选                      | 4.5                  |
| A8        | 组件实例识别                    | 4.4                  |
| A9        | 编辑器自身元素过滤              | 1.4                  |
| B1        | Shadow DOM 宿主隔离             | 1.2                  |
| B2        | Canvas Overlay 层               | 1.3                  |
| B3        | rAF 驱动渲染循环                | 1.5                  |
| B4        | 读写分离                        | 1.5                  |
| B5        | ResizeObserver/MutationObserver | 2.8                  |
| B6        | 按需渲染                        | 4.10                 |
| B7        | 智能对齐线与测距标注            | 4.3                  |
| B8        | 拖拽残影动画                    | 2.4                  |
| B9        | Canvas DPR 适配                 | 1.3                  |
| C1        | Components 树                   | 3.2                  |
| C2        | Design 面板 - Position          | 3.3                  |
| C3        | Design 面板 - Layout            | 3.4                  |
| C4        | Design 面板 - Size              | 3.5                  |
| C5        | Design 面板 - Spacing           | 3.6                  |
| C6        | Design 面板 - Typography        | 3.7                  |
| C7        | Design 面板 - Appearance        | 3.8                  |
| C8        | CSS 面板 - 样式来源追踪         | 4.6                  |
| C9        | CSS 面板 - class 编辑           | 4.7                  |
| C10       | Design System Tokens 集成       | 5.4                  |
| D1        | 拖拽重排                        | 2.5                  |
| D2        | 位置/尺寸手柄拖拽               | 4.9                  |
| D3        | 智能吸附                        | 4.2                  |
| D4        | 文本直接编辑                    | 2.7                  |
| D5        | Group/Stack 结构化操作          | 5.5                  |
| E1        | Transaction 记录                | 1.7                  |
| E2        | Undo/Redo 栈                    | 1.7                  |
| E3        | 变更计数 UI                     | 1.10                 |
| E4        | Apply 失败自动回滚              | 2.10                 |
| E5        | 拖拽过程合并为单事务            | 2.6                  |
| F1        | Payload 规范化                  | 1.8                  |
| F2        | 框架调试信息定位                | 1.8                  |
| F3        | Selector 候选生成               | 2.9                  |
| F4        | Agent Prompt 优化               | 3.11                 |
| F5        | 执行结果反馈 UI                 | 3.10                 |
| F6        | HMR 一致性校验                  | 4.8                  |
| G1        | 注入脚本 TypeScript 化          | 0.2, 5.1             |
| G2        | 模块化架构                      | 0.3, 1.1             |
| G3        | 核心逻辑单元测试                | 5.2                  |
| G4        | 性能监控                        | 5.3                  |

---

## 五、可复用资源

### 5.1 来自 element-marker

- Shadow DOM 隔离模式: `element-marker.js:833`
- 深度元素选择 (composedPath): `element-marker.js:1714`
- Selector 唯一性校验: `element-marker.js:1479`
- 高亮器移动逻辑: `element-marker.js:1585`

### 5.2 来自 accessibility-tree-helper

- 跨 frame 桥接模式: `accessibility-tree-helper.js:1013`
- DOM 遍历上限控制: `accessibility-tree-helper.js:10`

### 5.3 来自现有 web-editor

- 视觉启发式选中 (部分): `web-editor.js:122`
- React/Vue 调试信息提取: `web-editor.js:62`, `web-editor.js:96`
- 技术栈检测: `web-editor.js:39`
- Background 通信协议: `background/web-editor/index.ts`

---

## 六、风险与缓解

| 风险                   | 影响 | 缓解措施                              |
| ---------------------- | ---- | ------------------------------------- |
| 复杂页面性能问题       | 高   | rAF 节流、按需渲染、Web Worker 计算   |
| Shadow DOM closed mode | 中   | 降级到 host 级别选中，给出提示        |
| 跨域 iframe            | 高   | 检测并提示"无法编辑跨域内容"          |
| Agent 定位失败         | 中   | 多候选 selector、LLM rerank、手动确认 |
| 注入脚本包体积         | 中   | 按需加载、代码分割                    |

---

## 七、验收标准

### Phase 1 验收

- [ ] 新架构可正常注入和卸载
- [ ] Hover 高亮流畅 (60FPS)
- [ ] 点击选中功能正常
- [ ] Undo/Redo 可用
- [ ] Apply to Code 可触发 Agent

### Phase 2 验收

- [ ] Shadow DOM 内元素可选中
- [ ] 拖拽重排功能完整
- [ ] 文本可直接编辑
- [ ] 交互响应 < 16ms

### Phase 3 验收

- [ ] 属性面板全部控件可用
- [ ] 样式修改即时生效
- [ ] Components 树与选中联动

### 最终验收

- [ ] 对标 Cursor Visual Editor 截图功能
- [ ] 复杂页面 (10000+ 节点) 可用
- [ ] 主流框架 (React/Vue/Next/Nuxt) 兼容
- [ ] 无明显样式污染

---

## 八、实现进度记录

### Phase 0: 工程准备 ✅ 完成

**完成时间**: 2024-12

**决策记录**:

- 采用 WXT 的 `defineUnlistedScript` 进行 TypeScript 构建
- 输出为独立的 `web-editor-v2.js` 文件（当前 47.75KB）
- 使用 V2 版本化 action 名称（后缀 `_v2`）实现 V1/V2 共存

**创建的文件**:

- `common/web-editor-types.ts` - 共享类型定义，包含 `WEB_EDITOR_V2_ACTIONS`、`WebEditorV2Api` 等

---

### Phase 1.1-1.2: 模块化结构与 Shadow DOM 隔离 ✅ 完成

**目录结构**:

```
entrypoints/
├── web-editor-v2.ts                    # 入口点 (defineUnlistedScript)
└── web-editor-v2/
    ├── constants.ts                    # 常量配置
    ├── utils/
    │   └── disposables.ts              # 资源清理工具 (Disposer 类)
    ├── ui/
    │   └── shadow-host.ts              # Shadow DOM 隔离宿主
    ├── core/
    │   ├── editor.ts                   # 主协调器 (生命周期管理)
    │   ├── message-listener.ts         # Background 通信
    │   ├── event-controller.ts         # 事件拦截与模式控制
    │   └── position-tracker.ts         # 滚动/resize 位置同步
    ├── overlay/
    │   └── canvas-overlay.ts           # Canvas 渲染层
    └── selection/
        └── selection-engine.ts         # 智能选中引擎
```

**关键实现**:

#### `constants.ts`

- `WEB_EDITOR_V2_VERSION = 2`
- `WEB_EDITOR_V2_HOST_ID = '__mcp_web_editor_v2_host__'`
- `WEB_EDITOR_V2_Z_INDEX = 2147483647` (最大 z-index)
- 颜色定义: hover (#3b82f6), selected (#8b5cf6)

#### `utils/disposables.ts` - Disposer 类

```typescript
class Disposer {
  add(dispose: DisposeFn): void; // 注册清理函数
  listen(target, type, listener, options); // 自动移除的事件监听
  observeResize(target, callback); // 自动断开的 ResizeObserver
  observeMutation(target, callback); // 自动断开的 MutationObserver
  requestAnimationFrame(callback); // 自动取消的 rAF
  dispose(): void; // LIFO 顺序清理
  get isDisposed(): boolean;
}
```

#### `ui/shadow-host.ts` - Shadow DOM 宿主

- 创建固定定位的 host 元素，挂载到 `document.documentElement`
- 使用 `attachShadow({ mode: 'open' })` 创建 Shadow Root
- 提供 `overlayRoot`（用于 Canvas）和 `uiRoot`（用于 UI 面板）
- 事件隔离：阻止 UI 事件冒泡到页面（pointer/mouse/keyboard/touch/focus 等）
- 提供 `isOverlayElement(node)` 判断节点是否属于编辑器
- 内置简单的状态面板 UI（标题 + Exit 按钮 + 状态指示）

---

### Phase 1.3: Canvas Overlay 基础渲染 ✅ 完成

**文件**: `overlay/canvas-overlay.ts`

**功能**:

- DPR 感知渲染（`devicePixelRatio` 适配高清屏）
- markDirty/render 模式实现 rAF 合并渲染
- ResizeObserver 自动调整画布尺寸
- 绘制 hover 矩形（蓝色虚线 + 8% 填充）
- 绘制 selection 矩形（紫色实线 + 12% 填充）
- 像素对齐实现清晰线条

**接口**:

```typescript
interface CanvasOverlay {
  canvas: HTMLCanvasElement;
  markDirty(): void; // 标记需要重绘
  render(): void; // 立即渲染
  clear(): void; // 清除所有
  setHoverRect(rect: ViewportRect | null); // 设置 hover 框
  setSelectionRect(rect: ViewportRect | null); // 设置选中框
  dispose(): void;
}
```

---

### Phase 1.4: 事件拦截与模式控制 ✅ 完成

**文件**: `core/event-controller.ts`

**功能**:

- Capture 阶段拦截 document 级事件
- 两种模式状态机: `hover` ↔ `selecting`
- 支持 PointerEvents（现代浏览器）和 MouseEvents（兼容）
- Touch 事件拦截（移动端）
- ESC 键取消选中
- rAF 节流 hover 更新（避免高频 `elementFromPoint` 导致性能问题）
- 事件回调: `onHover(element)`, `onSelect(element, modifiers)`, `onDeselect()`
- 可插拔的智能选中: `findTargetForSelect` 选项

**事件拦截列表**:

- pointer: move, down, up, cancel, over, out, enter, leave
- mouse: move, down, up, click, dblclick, contextmenu, auxclick, over, out, enter, leave
- keyboard: down, up, press
- touch: start, move, end, cancel

**修饰键支持**:

```typescript
interface EventModifiers {
  alt: boolean; // Alt + Click 触发上钻
  shift: boolean; // 预留多选
  ctrl: boolean;
  meta: boolean;
}
```

---

### Phase 1.5: rAF 驱动的交互引擎 ✅ 完成

**文件**: `core/position-tracker.ts`

**功能**:

- 监听 `window.scroll`、`window.resize` 和 `document.scroll`（capture）
- rAF 合并位置更新请求
- 检测元素是否仍在 DOM 中（`isConnected`）
- 子像素容差过滤（`RECT_EPSILON = 0.5`）避免抖动
- 只在位置实际变化时触发回调

**接口**:

```typescript
interface PositionTracker {
  setHoverElement(element: Element | null): void;
  setSelectionElement(element: Element | null): void;
  forceUpdate(): void; // 立即同步更新
  dispose(): void;
}
```

**性能优化**:

- 在 `editor.ts` 中设置元素后调用 `forceUpdate()` 避免额外 rAF 延迟
- 在位置更新回调中调用 `canvasOverlay.render()` 合并到同一帧

---

### Phase 1.6: 智能选中引擎 ✅ 完成

**文件**: `selection/selection-engine.ts`

**评分系统** (正分优先，负分降级):

| 类别         | 规则                                    | 分数 |
| ------------ | --------------------------------------- | ---- |
| **交互性**   | `<button>`, `<a>`, `<input>` 等标签     | +6   |
|              | ARIA role (button, link, checkbox 等)   | +4   |
|              | `contenteditable`                       | +5   |
|              | `tabIndex >= 0`                         | +2   |
|              | `cursor: pointer`                       | +2   |
|              | `href` 属性                             | +2   |
| **视觉边界** | 有 background-color/image               | +2   |
|              | 有 border                               | +3   |
|              | 有 box-shadow                           | +2   |
|              | 有 outline                              | +1   |
|              | 媒体元素 (img/video/canvas/svg)         | +2   |
|              | SVG 子元素                              | -1   |
| **尺寸**     | 宽/高 < 4px                             | -6   |
|              | 面积 < 16x16                            | -4   |
|              | 面积 < 44x44 (低于 tap target)          | -1   |
|              | 占视口 > 85%                            | -8   |
|              | 占视口 > 60%                            | -4   |
| **容器**     | wrapper-only (单子元素、无视觉、无交互) | -8   |
|              | 泛型 `<span>` 无交互无视觉              | -2   |
|              | 大型 fixed 元素 (占视口 > 30%)          | -2   |

**不可见检测**:

- `display: none`
- `visibility: hidden/collapse`
- `opacity <= 0.01`
- `contentVisibility: hidden`
- 宽度或高度 <= 0.5px

**候选收集**:

- 使用 `elementsFromPoint` 获取命中元素（最多 8 个）
- 每个命中元素向上遍历祖先（最多 6 层）
- 总候选数限制 60 个
- 跨 Shadow DOM 边界（`getRootNode()` → `ShadowRoot.host`）

**修饰键**:

- Alt + Click: 上钻到父元素（找第一个非 wrapper 的祖先）

**性能策略**:

- Hover 使用快速的 `elementFromPoint`（保持 60FPS）
- Click 选择使用完整评分（可接受更高计算开销）

**接口**:

```typescript
interface SelectionEngine {
  findBestTarget(x, y, modifiers): Element | null;
  getCandidatesAtPoint(x, y): SelectionCandidate[];
  getParentCandidate(current): Element | null;
  dispose(): void;
}
```

---

### 主协调器: `core/editor.ts`

**生命周期管理**:

```
start() 初始化顺序:
1. mountShadowHost() → shadowHost
2. createCanvasOverlay() → canvasOverlay
3. createSelectionEngine() → selectionEngine
4. createEventController() → eventController (注入 selectionEngine.findBestTarget)
5. createPositionTracker() → positionTracker
6. createTransactionManager() → transactionManager
7. createToolbar() → toolbar

stop() 清理顺序 (逆序):
1. toolbar.dispose()
2. transactionManager.dispose()
3. positionTracker.dispose()
4. eventController.dispose()
5. selectionEngine.dispose()
6. canvasOverlay.dispose()
7. shadowHost.dispose()
```

**数据流**:

```
用户操作 → EventController
           ├─ onHover(element) → PositionTracker.setHoverElement()
           │                     → forceUpdate() → onPositionUpdate()
           │                                       → CanvasOverlay.setHoverRect()
           │                                       → CanvasOverlay.render()
           │
           └─ onSelect(element, modifiers) → PositionTracker.setSelectionElement()
                                            → forceUpdate() → onPositionUpdate()
                                                              → CanvasOverlay.setSelectionRect()
                                                              → CanvasOverlay.render()

滚动/Resize → PositionTracker
              → rAF 节流
              → getBoundingClientRect()
              → onPositionUpdate()
              → CanvasOverlay.setHoverRect/setSelectionRect()
              → CanvasOverlay.render()

Toolbar Apply → applyLatestTransaction()
                → sendTransactionToAgent(tx)
                → chrome.runtime.sendMessage(WEB_EDITOR_APPLY)

TransactionManager onChange → Toolbar.setHistory(undoCount, redoCount)
```

---

### 构建产物

| 版本       | 文件大小 | 包含模块                                  |
| ---------- | -------- | ----------------------------------------- |
| Phase 1.3  | 21.05 KB | shadow-host, canvas-overlay               |
| Phase 1.4  | 28.21 KB | + event-controller                        |
| Phase 1.5  | 33.36 KB | + position-tracker                        |
| Phase 1.6  | 47.75 KB | + selection-engine                        |
| Phase 1.7  | 68.81 KB | + locator, transaction-manager            |
| Phase 1.10 | 89.65 KB | + payload-builder, toolbar (Phase 1 完成) |

---

### Phase 1.7: Transaction Manager ✅ 完成

**文件**: `core/locator.ts`, `core/transaction-manager.ts`

**Locator 模块功能**:

- CSS selector 生成策略（优先级: ID > data-attr > class > path）
- 多候选 selector 生成（最多 5 个）
- 结构指纹计算（tag + id + classes + text）
- DOM 路径计算（child indices）
- Shadow DOM host chain 追踪
- CSS.escape polyfill 支持
- 元素定位时的唯一性和指纹验证

**Transaction Manager 功能**:

- Locator-based 事务记录（使用 CSS selector 而非 DOM 引用）
- Undo/Redo 栈管理（可配置 maxHistory，默认 100）
- 连续编辑合并（同元素+同属性+时间窗口内，默认 800ms）
- Handle-based API 支持批量操作（如 slider drag）
- 键盘快捷键支持（Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z/Y 重做）
- 失败安全的 Undo/Redo（apply 失败不移动栈）

**接口**:

```typescript
// Locator
interface ElementLocator {
  selectors: string[]; // 多候选 CSS selector
  fingerprint: string; // 结构指纹
  path: number[]; // DOM 树路径
  shadowHostChain?: string[]; // Shadow DOM host chain
}

function createElementLocator(element: Element): ElementLocator;
function locateElement(locator: ElementLocator): Element | null;

// Transaction Manager
interface StyleTransactionHandle {
  id: string;
  property: string;
  targetLocator: ElementLocator;
  set(value: string): void; // 实时预览
  commit(options?): Transaction | null;
  rollback(): void; // 回滚到原值
}

interface TransactionManager {
  beginStyle(target, property): StyleTransactionHandle | null;
  applyStyle(target, property, value, options?): Transaction | null;
  recordStyle(locator, property, before, after, options?): Transaction | null;
  undo(): Transaction | null;
  redo(): Transaction | null;
  canUndo(): boolean;
  canRedo(): boolean;
  getUndoStack(): readonly Transaction[];
  getRedoStack(): readonly Transaction[];
  clear(): void;
  dispose(): void;
}
```

**事件回调**:

```typescript
interface TransactionChangeEvent {
  action: 'push' | 'merge' | 'undo' | 'redo' | 'clear' | 'rollback';
  transaction: Transaction | null;
  undoCount: number;
  redoCount: number;
}
```

**安全验证**:

1. 唯一性验证: locateElement 时检查 selector 是否仍唯一匹配
2. 指纹验证: 确认找到的元素 tag/id 与存储的一致
3. 失败回滚: Undo/Redo 失败时恢复栈状态，不改变历史

---

### Phase 1.8: Payload Builder ✅ 完成

**文件**: `core/payload-builder.ts`

**功能**:

- 从 Transaction 构建 Apply payload
- 提取 React/Vue 组件 debug 信息
- 检测技术栈 (Tailwind, React, Vue)
- 生成样式变更描述

**接口**:

```typescript
interface ApplyPayload {
  pageUrl: string;
  targetFile?: string; // 组件源文件路径
  fingerprint: ElementFingerprint;
  techStackHint?: string[]; // ['React', 'Tailwind', etc.]
  instruction: ApplyInstruction;
  locator?: ElementLocator;
  selectorCandidates?: string[];
  debugSource?: DebugSource; // React/Vue 组件信息
  operation?: StyleOperation; // 样式变更详情
}

function buildApplyPayload(tx: Transaction, options?): ApplyPayload | null;
function sendApplyPayload(payload: ApplyPayload): Promise<unknown>;
function sendTransactionToAgent(tx: Transaction, options?): Promise<unknown>;
```

**技术栈检测**:

- React: 通过 `__reactFiber$` / `__reactInternalInstance$` 属性
- Vue: 通过 `__vueParentComponent` 属性
- Tailwind: 通过类名模式匹配 (bg-_, text-_, p-_, m-_, flex, grid, etc.)

---

### Phase 1.9: Background 通信 ✅ 完成

**复用现有消息类型**: `BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_APPLY`

Payload Builder 直接调用 `chrome.runtime.sendMessage()` 发送到 background，
无需新增消息类型，与现有 V1 Apply to Code 流程兼容。

---

### Phase 1.10: Toolbar UI ✅ 完成

**文件**: `ui/toolbar.ts`, `ui/shadow-host.ts` (CSS 扩展)

**功能**:

- 固定在视口顶部的工具栏
- Apply/Undo/Redo/Close 按钮
- 实时显示 undo/redo 计数
- 操作状态反馈 (idle/applying/success/error)
- 自动重置状态提示 (2.4s 后)

**接口**:

```typescript
type ToolbarStatus = 'idle' | 'applying' | 'success' | 'error';

interface Toolbar {
  setHistory(undoCount: number, redoCount: number): void;
  setStatus(status: ToolbarStatus, message?: string): void;
  dispose(): void;
}

function createToolbar(options: ToolbarOptions): Toolbar;
```

**集成**:

- 与 TransactionManager.onChange 事件绑定更新计数
- Apply 按钮调用 `sendTransactionToAgent()`
- Undo/Redo 按钮调用 TransactionManager 对应方法
- Close 按钮调用 `editor.stop()`

**样式** (CSS-in-Shadow-DOM):

- `.we-toolbar`: 居中固定定位，玻璃拟态背景
- `.we-btn--primary`: 深色主按钮
- `.we-btn--danger`: 红色关闭按钮
- `.we-toolbar-status`: 状态指示器 (颜色编码)

---

### 已知限制 (Phase 1)

1. **祖先不可见检测**: 当前只检查元素自身的 visibility/opacity，不检查祖先链
2. **DOM 变更后位置**: 只在 scroll/resize 时更新位置，DOM 变更（非 scroll）不会自动更新
3. **连续上钻**: Alt+Click 只在首次选择时生效，已选中状态下需先 ESC 再重新选择
4. **ESC 在 UI 内**: 焦点在编辑器 UI 内时按 ESC 不会取消选中（事件被 UI 拦截）
