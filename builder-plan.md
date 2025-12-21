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

| 序号 | 任务                                  | 预估工作量 | 依赖    | 功能点 |
| ---- | ------------------------------------- | ---------- | ------- | ------ |
| 4.2  | 智能对齐线与吸附                      | 4h         | Phase 2 | D3     |
| 4.3  | 测距标注                              | 3h         | 4.2     | B7     |
| 4.4  | 组件实例识别 (结构指纹 + Worker 计算) | 4h         | Phase 2 | A8     |
| 4.6  | CSS 面板 - 样式来源追踪               | 4h         | Phase 3 | C8     |
| 4.7  | CSS 面板 - class 编辑                 | 3h         | 4.6     | C9     |
| 4.8  | HMR 一致性校验 (依赖结果反馈)         | 3h         | 3.10    | F6     |
| 4.9  | 位置/尺寸手柄                         | 4h         | Phase 2 | D2     |
| 4.10 | 按需渲染优化 (静止时停止 tick)        | 2h         | Phase 1 | B6     |

### Phase 5: 工程化与增强 (P2-P3)

**目标**: 提升代码质量和可维护性，支持精准模式

| 序号 | 任务                                            | 预估工作量 | 依赖    | 功能点 |
| ---- | ----------------------------------------------- | ---------- | ------- | ------ |
| 5.1  | 注入脚本完全 TypeScript 化 (如 Phase 0 未完成)  | 6h         | Phase 3 | G1     |
| 5.2  | 核心逻辑单元测试 (scoring/fingerprint/geometry) | 4h         | 5.1     | G3     |
| 5.3  | 性能监控集成 (FPS/内存)                         | 3h         | Phase 4 | G4     |
| 5.4  | Design System Tokens 集成                       | 4h         | Phase 3 | C10    |
| 5.5  | Group/Stack 结构化操作                          | 4h         | Phase 2 | D5     |

### Phase 6: 精准模式 (P3，可选) ⏭️ 跳过

**目标**: 支持 Vite 插件实现精准定位

**状态**: 跳过 - 该阶段为可选功能，暂不实现

| 序号 | 任务                                       | 预估工作量 | 依赖    | 功能点 | 状态    |
| ---- | ------------------------------------------ | ---------- | ------- | ------ | ------- |
| 6.1  | Payload schema 增加 debugSource 版本化字段 | 2h         | Phase 1 | -      | ⏭️ 跳过 |
| 6.2  | Vite 插件开发 (注入 data-source-\*)        | 6h         | 6.1     | -      | ⏭️ 跳过 |
| 6.3  | 插件安装文档与 npm 发布                    | 2h         | 6.2     | -      | ⏭️ 跳过 |
| 6.4  | UI 检测 Vite 插件并提示安装                | 2h         | 6.2     | -      | ⏭️ 跳过 |

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

### Phase 1.1-1.2: 模块化结构与 Shadow DOM 隔离 ✅ 完成

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

---

### Phase 1.5: rAF 驱动的交互引擎 ✅ 完成

**文件**: `core/position-tracker.ts`

**功能**:

- 监听 `window.scroll`、`window.resize` 和 `document.scroll`（capture）
- rAF 合并位置更新请求
- 检测元素是否仍在 DOM 中（`isConnected`）
- 子像素容差过滤（`RECT_EPSILON = 0.5`）避免抖动
- 只在位置实际变化时触发回调

```

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
│ → forceUpdate() → onPositionUpdate()
│ → CanvasOverlay.setHoverRect()
│ → CanvasOverlay.render()
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


---

### Phase 1.8: Payload Builder ✅ 完成

**文件**: `core/payload-builder.ts`

**功能**:

- 从 Transaction 构建 Apply payload
- 提取 React/Vue 组件 debug 信息
- 检测技术栈 (Tailwind, React, Vue)
- 生成样式变更描述

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
2. ~~**DOM 变更后位置**: 只在 scroll/resize 时更新位置，DOM 变更（非 scroll）不会自动更新~~ (Phase 2.8 已解决)
3. **连续上钻**: Alt+Click 只在首次选择时生效，已选中状态下需先 ESC 再重新选择
4. **ESC 在 UI 内**: 焦点在编辑器 UI 内时按 ESC 不会取消选中（事件被 UI 拦截）

---

### Phase 2: 核心交互 (进行中)

**开始时间**: 2024-12

#### Phase 2.1: Shadow DOM 深度选择 ✅ 完成

**文件改动**:
- `selection/selection-engine.ts`: 新增 `findBestTargetFromEvent()` 方法
- `core/event-controller.ts`: 扩展 `findTargetForSelect` 签名支持 event 参数
- `core/editor.ts`: 使用新的 event-aware 方法

**核心功能**:
- 使用 `event.composedPath()` 访问 Shadow DOM 内部元素
- Ctrl/Cmd + Click: 穿透到最内层可见元素 (drill-in)
- Alt + Click: 上钻到父元素 (drill-up，Phase 1 已有)
- composedPath 候选与 elementsFromPoint 候选合并评分

**构建产物**: 89.65KB → 94KB (+4.35KB)

---

#### Phase 2.3: 修饰键交互 ✅ 完成 (与 2.1 合并实现)

**实现语义**:
- **Ctrl/Cmd + Click**: 选择 composedPath 中最内层可见元素
- **Alt + Click**: 选择当前最佳目标的第一个非 wrapper 父元素
- **同时按下**: Ctrl/Cmd 优先（更精确的命中）

---

#### Phase 2.8: Observer 同步 ✅ 完成

**文件改动**:
- `core/position-tracker.ts`: 新增 ResizeObserver 和 MutationObserver 支持

**核心功能**:
- **ResizeObserver**: 监听选中元素尺寸变化（CSS transitions、flex/grid reflow 等）
- **MutationObserver**: 监听 DOM 结构变化（元素移除、重排等）
- Shadow DOM 支持：同时观察 ShadowRoot（如果元素在 Shadow DOM 内）
- 性能优化：
  - 只观察选中元素（不观察 hover，因为变化太频繁）
  - MutationObserver 仅 `childList + subtree`，不观察 attributes
  - rAF 合并避免 observer 风暴

**构建产物**: 94KB → 95.39KB (+1.39KB)

---

#### Phase 2.2: 面包屑导航 UI ✅ 完成

**文件改动**:
- `ui/breadcrumbs.ts`: 新增面包屑组件
- `ui/shadow-host.ts`: 新增面包屑 CSS 样式
- `core/editor.ts`: 集成面包屑组件

**核心功能**:
- 显示选中元素的祖先链（从外到内）
- 跨 Shadow DOM 边界时显示 "⬡" 分隔符
- 普通父子关系显示 "›" 分隔符
- 点击面包屑项可选中对应祖先元素
- 每个面包屑显示 tag + id/class（自动截断）

**交互设计**:
- 固定在工具栏下方（top: 72px）
- 玻璃拟态背景，可水平滚动
- 当前选中项高亮显示
- 选择空或取消选中时自动隐藏

**构建产物**: 95.39KB → 102.93KB (+7.54KB)

---

#### Phase 2.9: Selector 候选生成器 ✅ 完成

**文件改动**:
- `core/locator.ts`: 增强 selector 候选生成逻辑

**核心功能**:
- **多候选采集**: 同一策略可产出多个候选（data-attr、class 组合等）
- **aria-label 支持**: 纳入 UNIQUE_DATA_ATTRS 以提高可访问性元素匹配率
- **anchor + relPath 策略**: 找到唯一祖先（id/data-*）+ 相对路径作为第 5 个候选
- **性能控制**: MAX_CANDIDATES = 5，early stop 策略

**候选优先级**:
1. ID 选择器（#id）
2. Data 属性选择器（[data-testid]、[aria-label] 等）
3. Class 选择器（.class、tag.class、.a.b 组合）
4. 结构路径选择器（body > div > span:nth-of-type(2)）
5. 锚点+相对路径选择器（[data-testid="panel"] div > button）

**新增常量**:
- `ANCHOR_DATA_ATTRS`: 用于祖先锚点的稳定数据属性
- `MAX_SELECTOR_CLASS_COUNT = 24`: 限制扫描的 class 数量
- `MAX_ANCHOR_DEPTH = 20`: 限制祖先搜索深度

**构建产物**: 102.93KB → 107.33KB (+4.4KB)

---

#### Phase 2.7: 文本直接编辑 ✅ 完成

**文件改动**:
- `core/event-controller.ts`: 新增 `editing` 模式、双击处理、编辑元素事件隔离
- `core/transaction-manager.ts`: 新增 `recordText()` 方法和文本事务支持
- `core/payload-builder.ts`: 扩展 `buildApplyPayload()` 支持文本事务
- `core/editor.ts`: 新增 EditSession 管理、文本编辑生命周期

**核心功能**:
- **双击进入编辑**: 双击文本元素进入 contentEditable 模式
- **ESC 取消编辑**: 按 ESC 恢复原始文本并退出编辑模式
- **Blur 提交编辑**: 失去焦点时提交文本变更
- **事务记录**: 文本变更记录为 `type: 'text'` 事务，支持 Undo/Redo
- **Apply 支持**: 文本事务可通过 Apply to Code 发送给 Agent

**编辑目标限制**:
- 仅支持 HTMLElement（非 input/textarea）
- 仅支持无子元素的文本节点（`childElementCount === 0`）
- 编辑后自动规范化为纯文本（`element.textContent = afterText`）

**事件隔离**:
- 编辑模式下允许编辑元素内的原生交互（键盘输入、文本选择等）
- 使用 `composedPath()` 进行 Shadow DOM 安全的事件来源检测
- TransactionManager 的 Ctrl/Cmd+Z 在编辑元素内失效，允许原生 contentEditable undo

**状态机扩展**:
```

EventControllerMode: 'hover' | 'selecting' | 'editing'

hover --[click]--> selecting --[dblclick]--> editing
^ |
|----[blur/ESC/click outside]

````

**构建产物**: 107.33KB → 116.3KB (+8.97KB)

---

#### Phase 2.10: Apply 失败自动回滚 ✅ 完成

**文件改动**:
- `core/editor.ts`: 新增 ApplySnapshot 类型、checkApplyingTxStatus()、attemptRollbackOnFailure() 函数

**核心功能**:
- **同步失败检测**: 捕获 `sendTransactionToAgent()` 抛错或返回 `success: false`
- **自动回滚**: 失败时自动调用 `TransactionManager.undo()` 撤销 DOM 变更
- **并发保护**: 使用 `applyingSnapshot` 防止重复 Apply
- **新编辑检测**: 通过 txId + timestamp 双重校验，避免回滚用户的新编辑

**回滚状态检测**:
```typescript
type ApplyTxStatus = 'ok' | 'no_snapshot' | 'tm_unavailable' | 'stack_empty' | 'tx_changed';
````

**错误消息映射**:

- `no_snapshot` / `tm_unavailable` → `{原始错误} (unable to revert)`
- `stack_empty` → `{原始错误} (already reverted)`
- `tx_changed` → `{原始错误} (new edits detected, not reverted)`
- `ok` + undo 成功 → `{原始错误} (changes reverted)`
- `ok` + undo 失败 → `{原始错误} (revert failed)`

**设计决策**:

- 只处理同步失败（网络错误、Agent 返回失败），不处理异步执行失败（需要订阅 stream）
- 回滚后事务进入 redoStack，用户可 Redo 重试
- Apply 过程中用户做新编辑不会被回滚（保护用户操作）
- 使用 timestamp 检测合并场景（同属性连续编辑会合并）

**已知限制**:

- 异步执行失败（Agent 完成后代码修改失败）需要订阅 stream 事件，不在本期范围
- 用户手动 Undo 正在 Apply 的事务时，提示文案为 "new edits detected" 而非 "already reverted"（边界情况）

**构建产物**: 116.3KB → ~117KB (+约0.7KB)

---

#### Phase 2.4-2.6: 拖拽重排功能 ✅ 完成

**文件改动**:

- `constants.ts`: 新增拖拽相关常量 (DRAG_THRESHOLD_PX, DRAG_HYSTERESIS_PX, DRAG_MAX_HIT_ELEMENTS, INSERTION_LINE_WIDTH)
- `common/web-editor-types.ts`: 新增 MoveTransactionData 类型
- `overlay/canvas-overlay.ts`: 新增 `setDragGhostRect()` 和 `setInsertionLine()` 方法
- `core/transaction-manager.ts`: 新增 `beginMove()` 方法和 move 事务支持
- `core/event-controller.ts`: 新增 `dragging` 模式和拖拽相关回调
- `drag/drag-reorder-controller.ts` (新增): 核心拖拽逻辑
- `core/editor.ts`: 集成 DragReorderController

**核心功能**:

- **拖拽手势检测**: pointerdown → 移动超过阈值(5px) → 进入 dragging 模式
- **视觉反馈**:
  - Ghost 矩形 (半透明蓝色，跟随指针)
  - Insertion Line (橙色横线，指示插入位置)
  - 60FPS rAF 合帧渲染
- **命中测试**: 使用 elementsFromPoint 找到有效 drop 目标
- **边界约束**:
  - 禁止拖动 HTML/BODY/HEAD
  - 禁止移入自身子树
  - 禁止跨 ShadowRoot 移动
  - Phase 1 仅支持 block/flex-column 布局
- **事务集成**: 单一 move 事务，支持 Undo/Redo

**审查修复** (基于 Codex 代码审查):

1. **Shadow DOM 命中测试修复**:
   - 将 `getHitElements()` 改为 `getHitElementsFromRoot(root, x, y)`
   - 使用 `draggedElement.getRootNode()` 获取正确的 Document/ShadowRoot
   - 确保在 Shadow DOM 内拖拽时能正确命中元素

2. **Pointer/Mouse 事件冲突修复**:
   - 新增 `isPointerEventOrigin` 字段追踪 dragCandidate 来源类型
   - 新增 `draggingIsPointerOrigin` 追踪活动拖拽的来源
   - 只允许同类型事件操作拖拽状态，防止 PointerEvent/MouseEvent 串扰

3. **模式切换状态清理一致性**:
   - 重构 `setMode()` 函数，明确状态清理不变量
   - 离开 `selecting` 时清理 dragCandidate
   - 离开 `dragging` 时清理所有拖拽状态
   - 进入 `hover` 时额外调用 `clearDragState()` 确保干净

4. **窗口失焦拖拽取消**:
   - 新增 `handleWindowBlur()` 处理窗口失焦
   - 新增 `handleVisibilityChange()` 处理页面可见性变化
   - 扩展 `DragCancelReason` 类型添加 `blur` 和 `visibilitychange`
   - 防止 UI 状态卡在 pointer-events: none

**Undo/Redo 设计**:

- `beginMove()` 捕获初始位置 (parentLocator + index + sibling anchor)
- `commit()` 记录目标位置，生成单一 move 事务
- Apply 使用 anchor 优先 + index 兜底的定位策略
- 对跨 root / 插入自身子树的操作做 apply 层校验

**已知限制**:

- Phase 1 不支持 grid 布局和 flex-row 布局
- 不支持 "insert as child" (只支持 sibling 插入)
- Locator 漂移可能导致 Undo/Redo 失败 (会触发 onApplyError 并回滚栈)

**构建产物**: ~117KB → 145.16KB (+28KB，含拖拽功能)

---

### Phase 3: 属性面板 ✅ 完成

#### Phase 3.1: 面板容器与 Tab 切换 ✅ 完成

**文件改动**:

- `ui/property-panel/types.ts` (新增): 类型定义 (PropertyPanel, DesignControl 等)
- `ui/property-panel/property-panel.ts` (新增): 面板主组件
- `ui/property-panel/index.ts` (新增): 模块导出
- `ui/shadow-host.ts`: 新增 ~300 行 CSS 样式
- `core/editor.ts`: 集成 PropertyPanel

**核心功能**:

- **Tab 切换**: Design / DOM 两个标签页 (DOM 为占位)
- **可折叠控件组**: 6 个组 (Position/Layout/Size/Spacing/Typography/Appearance)
- **空状态**: 未选中元素时显示提示
- **与 selection 联动**: `setTarget()` 同步选中元素
- **Undo/Redo 刷新**: `handleTransactionChange` 触发 `propertyPanel.refresh()`

---

#### Phase 3.3-3.8: Design 控件 ✅ 完成

**文件结构**:

```
ui/property-panel/controls/
├── index.ts              # 统一导出
├── size-control.ts       # Width/Height
├── spacing-control.ts    # Margin/Padding (盒模型可视化)
├── position-control.ts   # position/top/right/bottom/left/z-index
├── layout-control.ts     # display/flex-direction/justify/align/gap
├── typography-control.ts # font-size/weight/line-height/text-align/color
└── appearance-control.ts # opacity/border-radius/border-width/color/bg-color
```

**共同模式 (DesignControl)**:

- `setTarget(element: Element | null)`: 更新目标元素
- `refresh()`: 刷新控件值 (Undo/Redo 后调用)
- `dispose()`: 清理资源

**交互设计**:

- **Inline style 优先**: 输入框显示 inline style 值，placeholder 显示 computed 值
- **实时预览**: 输入时使用 `beginStyle().set()` 即时应用
- **提交语义**: Blur 提交、Enter 提交并失焦、ESC 回滚
- **单位处理**: 纯数字默认加 px (line-height 除外，保持 unitless)
- **空值清除**: 输入空值清除 inline style

**事务集成**:

- 每个属性独立事务，支持连续编辑合并 (800ms 窗口)
- 切换选中元素时自动 commit 当前编辑
- Select 元素与 Input 采用相同的 begin/commit/rollback 模式

**Shadow DOM 兼容**:

- 使用 `getRootNode().activeElement` 判断焦点状态
- 避免 `document.activeElement` 在 Shadow DOM 中返回 host 的问题

---

#### Phase 3.9: 事务集成 ✅ 完成

- `TransactionManager.beginStyle()` / `applyStyle()` 完整集成
- Undo/Redo 后自动调用 `propertyPanel.refresh()`
- 选择新元素时自动 commit 当前控件的活动事务

---

---

#### Phase 3.2: Components 树 (DOM 层级) ✅ 完成

**文件改动**:

- `ui/property-panel/components-tree.ts` (新增)
- `ui/property-panel/property-panel.ts` (集成)
- `ui/shadow-host.ts` (CSS 扩展)

**实现特性**:

- 显示选中元素的祖先路径 (从 body 到选中元素)
- 显示选中元素的直接子元素
- 高亮当前选中元素
- 点击任意节点可切换选中
- Hover 时显示元素预览
- 最大深度/子元素限制避免性能问题

---

#### Phase 3.6: Spacing scrub (拖拽调数值) ✅ 完成

**文件改动**:

- `ui/property-panel/controls/spacing-control.ts` (添加 pointer events)
- `ui/shadow-host.ts` (CSS cursor 样式)

**实现特性**:

- 输入框未聚焦时显示 ew-resize cursor
- 按住输入框并水平拖拽可调整数值
- 阈值检测 (3px) 防止误触发
- 灵敏度: 每 2px 移动 = 1px 数值变化
- 拖拽中使用 setPointerCapture 保证追踪
- 拖拽完成后自动 commit 事务
- 点击不拖拽则聚焦输入框进入编辑模式

---

#### Phase 3.10: 执行结果反馈 UI ✅ 完成

**文件改动**:

- `core/execution-tracker.ts` (新增)
- `core/editor.ts` (集成 tracker)
- `ui/toolbar.ts` (扩展 status 类型)
- `ui/shadow-host.ts` (CSS pulse 动画)
- `background/web-editor/index.ts` (SSE 订阅 + 状态缓存)
- `common/message-types.ts` (新增 WEB_EDITOR_STATUS_QUERY)

**实现特性**:

- Apply 成功后自动建立 SSE 连接订阅 Agent 状态
- 状态阶段: pending → starting → running → locating → applying → completed/failed
- Toolbar 实时显示执行状态和消息
- Progress 状态带呼吸动画
- 2分钟超时保护
- Background 缓存状态供 content script 查询

---

#### Phase 3.11: Agent Prompt 优化 ✅ 完成

**文件改动**:

- `background/web-editor/index.ts` (重写 buildAgentPrompt)

**优化内容**:

- 扩展 WebEditorApplyPayload 支持 V2 字段 (selectorCandidates, debugSource, operation)
- 新增归一化函数处理 V2 字段
- 生成结构化 Markdown prompt:
  - Source Location (高置信度 debugSource)
  - Element Fingerprint
  - CSS Selectors (候选列表)
  - Requested Change (before/after diff)
  - How to Apply (分步指引)
  - Constraints (框架特定建议)
- 利用 debugSource 提供精确文件:行号定位

---

**已知限制 (后续迭代)**:

- Select 的"清空 inline"需要添加 Unset 选项
- 控件间大量重复代码 (normalizeLength/isFieldFocused 等)，可抽公共 utils
- 未支持 !important 优先级

**构建产物**: 145KB → 228KB (+83KB，含 Components 树 + Scrub + 执行反馈)

---

### Phase 4: 高级功能 (进行中)

#### Phase 4 准备工作 ✅ 完成

##### Task 0: 禁用 Apply on move 事务

**文件改动**:

- `ui/toolbar.ts`: 新增 `getApplyBlockReason` 选项
- `core/editor.ts`: 提供 `getApplyBlockReason` 实现

**实现特性**:

- Apply 按钮在最新事务为 move 类型时自动禁用
- 禁用时显示 tooltip 说明原因
- 在 renderButtons() 中检查，每次状态变化时更新

---

##### Task 1: 扩展 TransactionManager 支持 multi-style

**文件改动**:

- `core/transaction-manager.ts`:
  - 新增 `MultiStyleTransactionHandle` 接口
  - 新增 `createStyleTransactionFromStyles()` 通用工厂函数
  - 新增 `beginMultiStyle()` 方法

**实现特性**:

- 支持一次性修改多个 CSS 属性（为 4.9 位置/尺寸手柄做准备）
- 只记录实际变化的属性（避免噪音）
- 默认 merge=false 保证拖拽手势的撤销粒度
- 复用现有的 pushTransaction/applyStylesSnapshot 逻辑

---

#### Phase 4.9: 位置/尺寸手柄 ✅ 完成

**文件改动**:

- `overlay/handles-controller.ts` (新增): 完整的 resize handles 实现
- `ui/shadow-host.ts`: 添加 handles 相关 CSS 样式，给 overlayRoot 添加事件隔离
- `core/editor.ts`: 集成 HandlesController

**实现特性**:

- 8 方向 resize handles (nw, n, ne, e, se, s, sw, w)
- DOM 手柄 + pointer capture 实现可靠的拖拽追踪
- rAF 节流更新，60FPS 流畅体验
- `beginMultiStyle()` 事务集成，单次拖拽 = 单条 undo 步骤
- 拖拽阈值 (3px)，避免点击产生事务
- position mode 处理 (fixed/absolute/relative/static)
- box-sizing 处理 (border-box/content-box)
- absolute/fixed 定位考虑 margin
- static 模式下 margin: auto 检测，防止破坏居中布局
- ESC 取消 / blur 取消 / visibilitychange 取消
- transform 元素检测并禁用（矩阵计算待后续实现）
- Size HUD 显示 W × H

**CSS 样式**:

- `.we-handles-layer`: 手柄层容器
- `.we-selection-frame`: 选中框定位
- `.we-resize-handle`: 8px 圆角手柄，hover 高亮 + 缩放动画
- `.we-size-hud`: 玻璃拟态尺寸标签

**已知限制**:

- 不支持 transform 元素（需要矩阵逆变换）
- 不支持 inline `inset` shorthand（会被 left/top 覆盖）
- Move grip（移动手柄）未实现，当前只支持 resize

---

#### Phase 4 剩余任务

| 序号 | 任务                             | 状态   | 备注                          |
| ---- | -------------------------------- | ------ | ----------------------------- |
| 4.2  | 智能对齐线与吸附                 | ✅完成 | resize handles 集成完成       |
| 4.3  | 测距标注                         | ✅完成 | resize handles 集成完成       |
| 4.4  | 组件实例识别 (结构指纹 + Worker) | ⏭跳过 | 与 Phase 7 重合，改用框架 API |
| 4.6  | CSS 面板 - 样式来源追踪          | ✅完成 | CSSOM 收集+级联计算+继承追踪  |
| 4.7  | CSS 面板 - class 编辑            | ✅完成 | Chips UI + 事务系统集成       |
| 4.8  | HMR 一致性校验                   | ✅完成 | 状态机+静默窗口+4层fallback   |
| 4.9  | 位置/尺寸手柄                    | ✅完成 |                               |
| 4.10 | 按需渲染 (静止停止 tick)         | ✅完成 | 现有 rAF 实现已满足           |

---

#### Phase 4.2: 智能对齐线与吸附 ✅ 完成

**文件改动**:

- `core/snap-engine.ts` (新增): 纯函数模块，负责锚点采集和吸附计算
- `overlay/canvas-overlay.ts`: 新增 `setGuideLines()` 方法和 `drawGuideLines()` 渲染函数
- `overlay/handles-controller.ts`: 集成 snap-engine，在 resize 过程中应用吸附
- `constants.ts`: 新增吸附相关常量
- `core/editor.ts`: 传递 canvasOverlay 给 HandlesController

**核心功能**:

- **锚点采集**：
  - 同父容器 siblings（双向窗口扫描，最多 300 个元素，保留最近 30 个）
  - Viewport 边界（left/center/right × top/middle/bottom）
  - 采集仅在手势阈值通过后执行一次，避免 layout thrash
- **吸附计算**：
  - 纯函数设计（`computeResizeSnap`），无 DOM 访问，可测试
  - 支持 X/Y 轴独立吸附
  - Hysteresis 机制防止阈值边界抖动（threshold 6px + hysteresis 2px）
  - 最小尺寸约束检查
- **Guide Lines 渲染**：
  - Pink 颜色 (#ec4899)，1px 线宽
  - Sibling 锚点：线段从源元素到目标元素边缘
  - Viewport 锚点：全屏横线或竖线
  - 仅在状态变化时更新（性能优化）

**架构设计**:

```
ResizeSession
  ├─ anchors: SnapAnchors | null    # 阈值后采集一次
  ├─ lockX: SnapLockX | null        # X轴锁定（hysteresis）
  ├─ lockY: SnapLockY | null        # Y轴锁定（hysteresis）
  └─ hadGuidesLastFrame: boolean    # 渲染变化检测

每帧流程:
  proposedRect → computeResizeSnap() → snappedRect
                                     → guideLines
                                     → 更新 lockX/lockY
```

**常量配置** (`constants.ts`):

- `WEB_EDITOR_V2_SNAP_THRESHOLD_PX = 6`: 吸附激活阈值
- `WEB_EDITOR_V2_SNAP_HYSTERESIS_PX = 2`: 稳定锁定的额外距离
- `WEB_EDITOR_V2_SNAP_MAX_ANCHOR_ELEMENTS = 30`: 参与吸附的最大兄弟元素数
- `WEB_EDITOR_V2_SNAP_MAX_SIBLINGS_SCAN = 300`: 扫描的最大兄弟元素数
- `WEB_EDITOR_V2_GUIDE_LINE_WIDTH = 1`: 对齐线宽度
- `WEB_EDITOR_V2_COLORS.guideLine = '#ec4899'`: 对齐线颜色

**已知限制**:

- 仅支持 resize handles，拖拽移动待 move grip 实现后集成
- 锚点在手势开始时快照，resize 导致的 reflow 不会更新锚点
- 不跨 Shadow DOM 边界对齐

**构建产物**: 270KB → 271.56KB (+1.56KB)

---

#### Phase 4.3: 测距标注 ✅ 完成

**文件改动**:

- `core/snap-engine.ts`: 新增 `ComputeDistanceLabelsParams` 接口和 `computeDistanceLabels()` 纯函数
- `overlay/canvas-overlay.ts`: 新增 `DistanceLabel` 类型、`setDistanceLabels()` 方法和 `drawDistanceLabels()` 渲染函数
- `overlay/handles-controller.ts`: 集成 distance labels，在 resize 过程中显示间距标注
- `constants.ts`: 新增 distance label 相关常量和颜色

**核心功能**:

- **间距计算**（`computeDistanceLabels`）：
  - **Sibling gaps**: lockX（垂直对齐线）显示 Y 方向间距，lockY（水平对齐线）显示 X 方向间距
  - **Viewport margins**: 显示元素到视口边缘的距离（根据对齐类型自动选择）
  - 纯函数设计，无 DOM 访问，可测试
  - 间距 ≤ 0 时自动隐藏（重叠/接触状态）
- **测距线渲染**（`drawDistanceLabels`）：
  - 测量线：Pink 颜色 (#ec4899)，1px 线宽
  - 端点 tick：垂直于测量方向，4px 长度
  - 文字 pill：深色半透明背景 + 白色文字，圆角矩形
  - 位置智能调整：优先线上方/右侧，越界自动翻转
  - 视口边界 clamp（处理超小视口边界情况）

**架构设计**:

```
DistanceLabel {
  kind: 'sibling' | 'viewport'   # 间距来源
  axis: 'x' | 'y'                # 测量方向
  value: number                  # 间距值 (px)
  text: string                   # 显示文本 (e.g. "12px")
  line: ViewportLine             # 测量线段坐标
}

每帧流程:
  snappedRect + lockX/lockY → computeDistanceLabels() → DistanceLabel[]
                                                       → canvas 渲染
```

**常量配置** (`constants.ts`):

- `WEB_EDITOR_V2_DISTANCE_LABEL_MIN_PX = 1`: 最小显示间距
- `WEB_EDITOR_V2_DISTANCE_LINE_WIDTH = 1`: 测量线宽度
- `WEB_EDITOR_V2_DISTANCE_TICK_SIZE = 4`: 端点 tick 大小
- `WEB_EDITOR_V2_DISTANCE_LABEL_FONT`: 系统字体，600 粗细，11px
- `WEB_EDITOR_V2_DISTANCE_LABEL_PADDING_X/Y`: Pill 内边距
- `WEB_EDITOR_V2_DISTANCE_LABEL_RADIUS = 4`: Pill 圆角
- `WEB_EDITOR_V2_COLORS.distanceLabelBg`: 深色半透明背景
- `WEB_EDITOR_V2_COLORS.distanceLabelText`: 白色文字

**代码审查修复**（Codex 发现的问题）:

- **参数名不匹配 bug**: 修复 `computeDistanceLabels` 调用参数（`snappedRect` → `rect`, `minDisplayPx` → `minGapPx`）
- **gap > 0 规则一致性**: `shouldShowGap()` 函数增加 `gap > 0` 条件，确保 0px 间距不显示
- **viewport NaN 兜底**: 对 `viewport.width/height` 增加 `isFiniteNumber` 检查
- **pill clamp 边界修复**: 处理 `pillWidth > viewportWidth` 导致 `max < min` 的边界情况

**构建产物**: 271.56KB → 281.84KB (+10.28KB)

---

#### Phase 4.8: HMR 一致性校验 ✅ 完成

**文件改动**:

- `core/css-compare.ts` (新增): CSS 值比较工具模块
- `core/hmr-consistency.ts` (新增): HMR 一致性校验器状态机
- `ui/toolbar.ts`: 扩展 ToolbarStatus 类型
- `core/editor.ts`: 集成 HMR 验证器

**核心功能**:

- **问题解决**: Apply 后 HMR 触发，验证编辑是否真正持久化到代码
- **静默窗口策略**: 等待 DOM 变更稳定后再校验（默认 300ms quiet window）
- **校验结果**: `verified | mismatch | lost | uncertain | skipped`

**状态机设计**:

```
idle → executing → settling → verifying → final
           ↓              ↓              ↓
       (skipped)      (skipped)     (verified/mismatch/lost/uncertain)
```

**元素重定位策略**（4 层 fallback）:

1. **current**: 使用 Apply 时的 DOM 引用（如果仍 connected）
2. **strict**: 使用 locator 精确匹配（唯一 selector + fingerprint）
3. **relaxed**: 放宽唯一性约束，使用评分算法
4. **geometric**: 几何位置 fallback（低置信度，只产出 uncertain）

**CSS 值比较**:

- 比较 computed style（避免 "1rem" vs "16px" 假 mismatch）
- px 值数值容差: 0.5px
- matrix/matrix3d 数值容差: 1e-3
- 结构相同检测（避免 "10px solid" vs "10px" 误匹配）

**DOM 观察**:

- 监听 `<head>` 的 style/link 变更
- 监听目标元素所在 root 的结构/属性/文本变更
- characterData 支持（text 事务校验）
- 祖先节点移除检测

**Codex 代码审查修复**:

- **buildResult 参数丢失 bug**: 修复 active=null 后构建结果时丢失 session 数据
- **Toolbar 状态覆盖**: 只在 verifier 曾接管时才重置 idle
- **characterData 支持**: DOM observer 增加 characterData 监听
- **祖先节点移除**: isDomMutationRelevant 增加 removedNode.contains(target) 检测
- **低置信度降级**: geometric fallback 强制输出 uncertain
- **deselection 处理**: 用户取消选中时正确取消校验

**Toolbar 状态扩展**:

- `verifying`: 正在等待 HMR 或校验中
- `verified`: 校验通过（HMR 成功应用）
- `mismatch`: 值不匹配
- `lost`: 无法定位目标元素
- `uncertain`: 无法确定（无 HMR 信号/低置信度/超时）

**已知限制**:

- relaxedLocate 不支持 Shadow DOM 内元素（需要下钻到正确 queryRoot）
- 对 style/link 以外的 head 变更可能产生假阳性信号
- 快速 HMR 场景可能在首次校验时就落到 uncertain

**构建产物**: 281.84KB → 315.28KB (+33.44KB)

---

#### Phase 4.6: CSS 面板 - 样式来源追踪 ✅ 完成

**文件改动**:

- `core/cssom-styles-collector.ts` (新增): CSSOM 样式收集器，~1100 行
- `ui/property-panel/css-panel.ts` (新增): CSS 面板 UI 组件
- `ui/property-panel/types.ts`: 添加 'css' tab 类型
- `ui/property-panel/property-panel.ts`: 集成 CSS tab
- `ui/shadow-host.ts`: 添加 CSS 面板样式 (~190 行)

**核心功能**:

- **样式收集**: CSSOM 遍历 + element.matches() 匹配
- **特异性计算**: Selectors Level 4 规范（支持 :where/:is/:not/:has）
- **级联决策**: !important > specificity > source order
- **继承追踪**: 沿祖先链最多 10 层，只收集可继承属性
- **Shorthand 展开**: margin/padding/border/font 等常用 shorthand → longhands

**CSS 面板 UI**:

- **Tab 切换**: Design | CSS | DOM 三个 tab
- **Inline styles**: element.style 区块，黄色高亮
- **Matched rules**: 按特异性 + 源顺序排序
- **Inherited sections**: "Inherited from div.foo" 折叠区块
- **Overridden 划线**: 被覆盖的声明显示删除线 + 灰色

**特异性算法**:

- (inline, id, class, type) 四元组
- :where(...) 零特异性
- :is/:not/:has 取参数 max
- :nth-child(... of selector) 正确处理
- Legacy pseudo-elements (:before/:after) 计入 type

**性能优化**:

- **延迟加载**: 只在 CSS tab 可见时才收集数据
- **Per-root 缓存**: 同一 root 的规则索引复用
- **@import 正确遍历**: 避免循环依赖，跨域 stylesheet 跳过

**Codex 代码审查修复**:

- **WeakMap 不可迭代 bug**: 改用 indexList 数组收集 stats
- **@import 栈逻辑错误**: 先检测循环再 push，内联展开逻辑
- **延迟加载**: setVisible(visible) 控制 CSS 收集时机

**已知限制**:

- CSSOM 无法获取精确文件行号（只有 href/label）
- @container/@scope 规则暂不支持（输出 warning）
- @layer 顺序近似处理（按源顺序）
- :host/:host-context 特异性为近似值
- logical shorthands (margin-inline 等) 未展开

**构建产物**: 315.28KB → 363.43KB (+48.15KB)

---

#### Phase 4.7: CSS 面板 - class 编辑 ✅ 完成

**文件改动**:

- `common/web-editor-types.ts`: 添加 'class' 到 TransactionType，添加 classes 字段
- `core/transaction-manager.ts`: 新增 recordClass() 方法和 class 事务支持
- `ui/property-panel/class-editor.ts` (新增): ClassEditor UI 组件
- `ui/property-panel/css-panel.ts`: 集成 ClassEditor，添加 class 建议提取
- `ui/property-panel/property-panel.ts`: 传递 TransactionManager 给 CSS 面板
- `ui/shadow-host.ts`: 新增 ~130 行 class editor CSS 样式

**核心功能**:

- **Chips UI**: 每个 class 显示为可删除的 chip
- **输入框**: Enter/Space 提交，Backspace 删除最后一个
- **建议列表**: 从当前 CSS 规则提取 class 名，按前缀过滤
- **事务系统**: class 编辑支持 Undo/Redo
- **SVG 兼容**: 使用 setAttribute/removeAttribute

**CSS selector 解析**:

- 支持简单转义（`\:`, `\/`, `\.` 等）
- 支持 hex 转义（`\31 23` 等）
- 正确提取 Tailwind 类名（`sm:bg-red-500`）
- Unicode 范围防护（避免 RangeError）

**Undo/Redo 定位策略**:

- 使用方向性 locator（before/after）
- 与 move 事务一致的 fallback 策略
- class 变更后重新采集 locator

**已知限制**:

- Apply to Code 暂不支持 class 事务（与 move 事务类似）
- 粘贴多个 class 合并为单次事务（可接受的 UX）
- 建议仅从当前匹配规则提取，不扫描全量 stylesheet

---

### Phase 5: 工程化与增强 (进行中)

#### Phase 5.2: 核心逻辑单元测试 ✅ 完成

**文件改动**:

- `app/chrome-extension/vitest.config.ts` (新增): Vitest 测试配置
- `app/chrome-extension/tests/web-editor-v2/test-utils/dom.ts` (新增): DOM mock 工具库
- `app/chrome-extension/tests/web-editor-v2/snap-engine.test.ts` (新增): 吸附引擎测试
- `app/chrome-extension/tests/web-editor-v2/locator.test.ts` (新增): 定位器测试
- `app/chrome-extension/tests/web-editor-v2/selection-engine.test.ts` (新增): 选择引擎测试

**测试统计**:

- snap-engine.test.ts: 39 tests (纯函数测试，无需 DOM mock)
- locator.test.ts: 34 tests (jsdom 环境，含 Shadow DOM 条件测试)
- selection-engine.test.ts: 15 tests (完整 DOM mock)
- **总计**: 88 tests 全部通过

**DOM Mock 工具** (`test-utils/dom.ts`):

- `mockBoundingClientRect()`: 固定元素尺寸
- `mockElementsFromPoint()`: mock 命中测试
- `mockGetComputedStyle()`: mock 样式查询
- `mockViewport()`: mock 视口尺寸
- `createMockEvent()`: 创建带 composedPath 的事件
- `installDomMocks()`: 批量安装 + restore

**测试覆盖重点**:

- snap-engine: threshold/hysteresis/minSize/center-middle锚点/lock失效/sibling guide/viewport labels
- locator: fingerprint/DOM path/selector candidates/locator create+locate/shadowHostChain
- selection-engine: 候选收集/overlay过滤/interactive评分/visual boundary/size惩罚/modifiers处理

---

#### Phase 5.3: 性能监控集成 ✅ 完成

**文件改动**:

- `app/chrome-extension/entrypoints/web-editor-v2/core/perf-monitor.ts` (新增): FPS/内存监控 HUD
- `app/chrome-extension/entrypoints/web-editor-v2/ui/shadow-host.ts` (修改): 添加 `.we-perf-hud` CSS 样式
- `app/chrome-extension/entrypoints/web-editor-v2/core/editor.ts` (修改): 集成 perf monitor + 热键

**功能特性**:

- FPS 监控：rAF 驱动，500ms 更新频率
- 内存监控：Chrome `performance.memory` API，1s 采样频率
- 热键：Ctrl/Cmd+Shift+P 切换显示
- 自动暂停：页面隐藏时停止 rAF 循环

---

#### Phase 5.4: Design System Tokens 集成 ✅ 核心完成

**文件改动**:

- `app/chrome-extension/entrypoints/web-editor-v2/core/design-tokens/types.ts` (新增): 类型定义
- `app/chrome-extension/entrypoints/web-editor-v2/core/design-tokens/token-detector.ts` (新增): CSSOM 扫描
- `app/chrome-extension/entrypoints/web-editor-v2/core/design-tokens/token-resolver.ts` (新增): 值解析
- `app/chrome-extension/entrypoints/web-editor-v2/core/design-tokens/design-tokens-service.ts` (新增): 统一服务
- `app/chrome-extension/entrypoints/web-editor-v2/core/design-tokens/index.ts` (新增): 模块导出
- `app/chrome-extension/tests/web-editor-v2/design-tokens.test.ts` (新增): 39 tests

**核心功能**:

- TokenDetector: CSSOM 扫描收集 CSS 变量声明，支持 @import/@media/@supports
- TokenResolver: var() 解析/格式化，computed value 读取
- DesignTokensService: 缓存管理、失效事件、TransactionManager 集成

**性能优化**:

- 按需扫描：仅在 token picker 打开时触发 CSSOM 扫描
- 单次 getComputedStyle：getContextTokens() 优化为单次调用
- WeakMap 缓存：根据 Document/ShadowRoot 缓存索引

**测试覆盖**:

- token-resolver: var() 解析/格式化 (18 tests)
- token-detector: inline token 收集 (8 tests)
- design-tokens-service: 缓存/失效/查询 (13 tests)
- **总计**: 127 tests (含原有 88 tests)

**UI 组件** (已完成):

- `app/chrome-extension/entrypoints/web-editor-v2/ui/property-panel/controls/token-picker.ts` (新增)
- `app/chrome-extension/entrypoints/web-editor-v2/ui/shadow-host.ts` (添加 token-picker CSS)
- `app/chrome-extension/entrypoints/web-editor-v2/ui/property-panel/controls/typography-control.ts` (集成 token picker 到 color 字段)

**Token Picker 功能**:

- 下拉显示可用 tokens
- 支持过滤搜索
- 显示 token 名称和计算值
- 颜色类 token 显示色块预览
- 键盘导航 (↑↓ Enter Escape)
- "Show all root tokens" 切换选项

---

## Phase 7: React/Vue Props 实时编辑（规划中）

### 7.0 功能概述与可行性分析

#### 需求背景

实现类似 Cursor Visual Editor 的 React/Vue 组件 Props 实时编辑功能：

- 选中一个组件后，在侧边栏显示其 Props
- 用户可以直接修改 Props 并实时预览效果
- **纯 Runtime Hacking**，不涉及源码修改，主要用于开发调试
- **仅支持 Dev 构建**，生产构建不在支持范围内

#### 关键设计决策

| 决策           | 结论              | 理由                                                    |
| -------------- | ----------------- | ------------------------------------------------------- |
| Undo/Redo      | ❌ 不需要         | Props 编辑是调试功能，不影响源码，提供 "Reset" 按钮即可 |
| 生产构建支持   | ❌ 不需要         | 功能定位是开发调试，生产构建检测到后直接提示不支持      |
| React 更新机制 | 复用 DevTools API | 使用 `renderer.overrideProps()` 官方 API，而非手动 hack |

#### 技术方案：复用 React DevTools API

**关键发现**：React 从 16.7+ 开始通过 `__REACT_DEVTOOLS_GLOBAL_HOOK__` 暴露了官方 Props 编辑 API：

```javascript
// React renderer 暴露的能力 (来自 react-devtools-shared/src/backend/types.js)
renderer.overrideProps(fiber, path, value); // 16.7+，修改 Props 并触发更新
renderer.overrideHookState(fiber, id, path, value); // 修改 Hook state
renderer.scheduleUpdate(fiber); // 16.9+，调度更新
renderer.findFiberByHostInstance(dom); // 通过 DOM 找 fiber
```

**React DevTools 的 Props 编辑实现**（`fiber/renderer.js:7918-7929`）：

```javascript
case 'props':
  switch (fiber.tag) {
    case ClassComponent:
      // Class Component: 修改 pendingProps + forceUpdate
      fiber.pendingProps = copyWithSet(instance.props, path, value);
      instance.forceUpdate();
      break;
    default:
      // Function Component: 使用 renderer 提供的 overrideProps
      if (typeof overrideProps === 'function') {
        overrideProps(fiber, path, value);  // ← 官方 API，内部处理更新
      }
      break;
  }
```

#### Hook 可用性策略

**策略：检测 DevTools Hook，没有则自己注入**

```
用户点击启用 Web Editor
  ↓
检测 __REACT_DEVTOOLS_GLOBAL_HOOK__
  ↓
├─ READY: hook 存在 + renderer 有 overrideProps → 直接使用
│
├─ HOOK_PRESENT_NO_RENDERERS: hook 存在但无 renderer
│    → 监听 hook.on('renderer', ...) 或轮询（短超时）
│    → 超时后若页面有 React fiber → 提示"需要刷新页面"
│
├─ RENDERERS_NO_EDITING: 有 renderer 但无 overrideProps
│    → 可能是生产构建，提示"需要 Development 构建"
│
└─ HOOK_MISSING: hook 不存在
     → 注入我们的最小 hook
     → 等待 renderer 注册（短超时）
     → 无 renderer 且页面有 React → 提示"需要刷新页面"
```

**注入时机问题**：

- React DevTools 在 `document_start` + MAIN world 注入 hook
- 我们是"按需启用"，页面可能已加载完成
- **解决方案**：首次发现需要刷新时，注册 `document_start` content script，后续导航自动生效

#### 最小 Hook 实现

参考 `react-devtools-shared/src/hook.js`，最小需要提供：

```javascript
// React 会调用的方法 (hook.js:655-662)
window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  renderers: new Map(),
  inject(renderer) {
    const id = this.renderers.size + 1;
    this.renderers.set(id, renderer);
    // 通知监听者
    this.emit('renderer', { id, renderer });
    return id;
  },
  // React 调用的生命周期方法（必须提供，可以是 no-op）
  onCommitFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {}, // React 18+
  setStrictMode() {},
  checkDCE() {},
  // 事件系统
  _listeners: {},
  on(event, fn) {
    /* ... */
  },
  off(event, fn) {
    /* ... */
  },
  emit(event, data) {
    /* ... */
  },
};
```

#### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    ISOLATED World                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Shadow DOM (Property Panel)              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │   │
│  │  │ Design Tab  │  │  DOM Tab    │  │ Props Tab   │   │   │
│  │  │  (现有)     │  │  (现有)     │  │  (新增)     │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                            ↕                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Props Bridge (core/props-bridge.ts)      │   │
│  │  - 发送请求：web-editor-props:request                 │   │
│  │  - 接收响应：web-editor-props:response                │   │
│  │  - ElementLocator 序列化/定位                         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↕ CustomEvent
┌─────────────────────────────────────────────────────────────┐
│                     MAIN World                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Props Agent (inject-scripts/props-agent.js) │   │
│  │  - 检测/注入 DevTools Hook                            │   │
│  │  - React: renderer.overrideProps() (官方 API)         │   │
│  │  - Vue: __vueParentComponent → $forceUpdate           │   │
│  │  - 发送 web-editor-props:response                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                            ↕                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              React/Vue Runtime (页面)                 │   │
│  │  - __REACT_DEVTOOLS_GLOBAL_HOOK__.renderers           │   │
│  │  - renderer.overrideProps / overrideHookState         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### 技术风险评估（更新版）

| 风险                          | 影响 | 概率 | 缓解措施                                        |
| ----------------------------- | ---- | ---- | ----------------------------------------------- |
| Hook 注入太晚（页面已加载）   | 高   | 高   | 检测到需要时提示刷新 + 注册 early-injection     |
| renderer.overrideProps 不存在 | 中   | 低   | 检测后提示"需要 Dev 构建"或 Class 组件 fallback |
| Props 非可序列化              | 中   | 中   | 序列化时标记类型，只允许编辑原始值              |
| Vue 无官方 DevTools API       | 中   | -    | 使用 `$forceUpdate()` best-effort 方案          |

#### 与现有模块的集成点

| 集成点                 | 文件位置                                      | 改动说明                                   |
| ---------------------- | --------------------------------------------- | ------------------------------------------ |
| PropertyPanel Tab 扩展 | `ui/property-panel/types.ts:15`               | 添加 `'props'` 到 `PropertyPanelTab` 类型  |
| Tab UI 渲染            | `ui/property-panel/property-panel.ts:213-227` | 新增 Props Tab 按钮                        |
| Tab 面板渲染           | `ui/property-panel/property-panel.ts:257-274` | 新增 propsPanel 容器                       |
| renderTabs 逻辑        | `ui/property-panel/property-panel.ts:384-395` | 三态切换逻辑                               |
| 选中联动               | `core/editor.ts:278`                          | `handleSelect → propsPanel.setTarget()`    |
| ElementLocator 复用    | `core/locator.ts:642`                         | 跨 world 元素定位                          |
| MAIN World 注入        | `background/web-editor/index.ts`              | 新增 props-agent.js 注入逻辑               |
| Early injection 注册   | `background/index.ts`                         | 可选：注册 `document_start` content script |

---

### Phase 7.1: 基础设施与 Hook 管理 (P0)

**目标**: 建立通信基础设施 + DevTools Hook 检测/注入机制

| 序号  | 任务                     | 预估工作量 | 依赖  | 说明                                             |
| ----- | ------------------------ | ---------- | ----- | ------------------------------------------------ |
| 7.1.1 | 创建 Props Agent 骨架    | 2h         | -     | `inject-scripts/props-agent.js`，MAIN world 运行 |
| 7.1.2 | 实现 Hook 检测逻辑       | 2h         | 7.1.1 | 4 种状态：READY/NO_RENDERERS/NO_EDITING/MISSING  |
| 7.1.3 | 实现最小 Hook 注入       | 3h         | 7.1.2 | 参考 DevTools hook.js，提供 React 必需的方法     |
| 7.1.4 | 创建 Props Bridge 通信层 | 3h         | 7.1.1 | `core/props-bridge.ts`，CustomEvent 请求/响应    |
| 7.1.5 | Background 注入逻辑      | 2h         | 7.1.1 | Editor start 时注入，stop 时清理                 |
| 7.1.6 | Early-injection 注册     | 2h         | 7.1.3 | 可选：注册 `document_start` content script       |

**Hook 状态检测逻辑**:

```javascript
function detectHookStatus() {
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;

  // 1. Hook 不存在
  if (!hook || typeof hook.inject !== 'function') {
    return { status: 'HOOK_MISSING' };
  }

  // 2. Hook 存在但无 renderer
  if (!hook.renderers || hook.renderers.size === 0) {
    return { status: 'HOOK_PRESENT_NO_RENDERERS', hook };
  }

  // 3. 找一个有 overrideProps 的 renderer
  for (const [id, renderer] of hook.renderers) {
    if (typeof renderer.overrideProps === 'function') {
      return {
        status: 'READY',
        hook,
        renderer,
        rendererId: id,
        capabilities: {
          overrideProps: true,
          overrideHookState: typeof renderer.overrideHookState === 'function',
          findFiberByHostInstance: typeof renderer.findFiberByHostInstance === 'function',
          scheduleUpdate: typeof renderer.scheduleUpdate === 'function',
        },
      };
    }
  }

  // 4. 有 renderer 但无编辑能力（可能是生产构建）
  return { status: 'RENDERERS_NO_EDITING', hook };
}
```

**通信协议设计**:

```typescript
// Request (ISOLATED → MAIN)
interface PropsRequest {
  v: 1; // 协议版本
  requestId: string; // 唯一请求 ID
  op: 'probe' | 'read' | 'write' | 'reset' | 'cleanup';
  locator?: ElementLocator; // 目标元素定位
  payload?: {
    propPath?: (string | number)[]; // 属性路径，如 ['style', 'color']
    propValue?: unknown;
  };
}

// Response (MAIN → ISOLATED)
interface PropsResponse {
  v: 1;
  requestId: string;
  success: boolean;
  data?: {
    hookStatus?: 'READY' | 'HOOK_PRESENT_NO_RENDERERS' | 'RENDERERS_NO_EDITING' | 'HOOK_MISSING';
    needsRefresh?: boolean; // 是否需要刷新页面
    framework?: 'react' | 'vue' | 'unknown';
    componentName?: string;
    props?: SerializedProps;
    capabilities?: {
      canRead: boolean;
      canWrite: boolean;
      canWriteHooks: boolean;
    };
  };
  error?: string;
}
```

**注入时机**:

- Editor `start()` 时，background 调用 `chrome.scripting.executeScript({ world: 'MAIN', files: ['inject-scripts/props-agent.js'] })`
- 如果检测到 `HOOK_MISSING`：注入最小 hook + 提示需要刷新
- 如果用户同意 early-injection：注册 `document_start` content script
- Editor `stop()` 时，发送 `web-editor-props:cleanup` 事件

---

### Phase 7.2: Props 读取 (P0)

**目标**: 实现 React/Vue Props 的可靠读取

| 序号  | 任务                         | 预估工作量 | 依赖  | 说明                                          |
| ----- | ---------------------------- | ---------- | ----- | --------------------------------------------- |
| 7.2.1 | 框架检测（per-element）      | 1h         | 7.1   | 检测 `__reactFiber$` / `__vueParentComponent` |
| 7.2.2 | React Fiber Props 提取       | 3h         | 7.2.1 | 从 fiber 读取 `memoizedProps`                 |
| 7.2.3 | Vue Instance Props 提取      | 1h         | 7.2.1 | 从 instance 读取 `props`（比 React 简单）     |
| 7.2.4 | Props 序列化器               | 3h         | -     | 处理函数、Symbol、循环引用、ReactElement      |
| 7.2.5 | ElementLocator 跨 world 解析 | 2h         | 7.1.4 | 复用现有 `locateElement()` 逻辑               |

**框架检测策略（per-element，支持混用）**:

```javascript
// 在 MAIN world 执行，针对选中元素检测
function detectFramework(element, maxDepth = 15) {
  let node = element;

  for (let depth = 0; depth < maxDepth && node; depth++) {
    // 1. 检测 React（优先，因为更常见）
    const reactKey = Object.keys(node).find(
      (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
    );
    if (reactKey) {
      return { framework: 'react', data: node[reactKey], node };
    }

    // 2. 检测 Vue 3
    if (node.__vueParentComponent) {
      return { framework: 'vue', data: node.__vueParentComponent, node };
    }

    node = node.parentElement;
  }

  return { framework: 'unknown', data: null, node: null };
}
```

**为什么 per-element 检测**：

- 同一页面可能混用 React + Vue（micro-frontend 场景）
- 选中不同元素可能属于不同框架
- 现有 `payload-builder.ts:323` 已采用此策略

**React vs Vue 处理分流**:

```
detectFramework(element)
  ↓
├─ framework: 'react'
│    → 检查 Hook 状态（READY/MISSING/...）
│    → 使用 renderer.overrideProps() 或 fallback
│
├─ framework: 'vue'
│    → 直接读写 instance.props（无需 Hook）
│    → 调用 $forceUpdate()
│
└─ framework: 'unknown'
     → 显示 "Not a React/Vue component"
```

**React Fiber 遍历策略**:

```javascript
function findReactComponent(fiber) {
  // 向上找最近的 Function/Class Component
  while (fiber) {
    // tag: 0 = FunctionComponent, 1 = ClassComponent, 11 = ForwardRef
    if (fiber.tag === 0 || fiber.tag === 1 || fiber.tag === 11) {
      return {
        fiber,
        name: fiber.type?.displayName || fiber.type?.name || 'Anonymous',
        props: fiber.memoizedProps,
      };
    }
    fiber = fiber.return;
  }
  return null;
}
```

**Vue 3 Instance 访问（比 React 简单）**:

```javascript
function findVueComponent(instance) {
  // Vue 3 的 __vueParentComponent 直接就是组件实例
  return {
    instance,
    name: instance.type?.name || instance.type?.__name || 'Anonymous',
    props: instance.props, // 直接可读写
  };
}
```

**Props 序列化规则**:
| 类型 | 序列化结果 | 可编辑 |
|------|-----------|--------|
| string | `{ type: 'string', value: 'xxx' }` | ✅ |
| number | `{ type: 'number', value: 123 }` | ✅ |
| boolean | `{ type: 'boolean', value: true }` | ✅ |
| null/undefined | `{ type: 'null' }` | ✅ |
| function | `{ type: 'function', name: 'onClick' }` | ❌ |
| ReactElement | `{ type: 'element', name: 'Button' }` | ❌ |
| Array | `{ type: 'array', length: 5 }` | ❌ (Phase 2) |
| Object | `{ type: 'object', keys: [...] }` | ❌ (Phase 2) |

---

### Phase 7.3: Props Tab UI (P1)

**目标**: 在 Property Panel 中添加 Props Tab

| 序号  | 任务                       | 预估工作量 | 依赖  | 说明                               |
| ----- | -------------------------- | ---------- | ----- | ---------------------------------- |
| 7.3.1 | 扩展 PropertyPanelTab 类型 | 0.5h       | -     | 添加 `'props'` 到 union type       |
| 7.3.2 | Tab 按钮与面板容器         | 1h         | 7.3.1 | 三态切换逻辑                       |
| 7.3.3 | 创建 PropsPanel 组件       | 3h         | 7.2   | `ui/property-panel/props-panel.ts` |
| 7.3.4 | 能力状态显示               | 1h         | 7.1.4 | 顶部显示 framework/capabilities    |
| 7.3.5 | Props 列表渲染             | 3h         | 7.2.3 | 根据类型渲染不同控件               |
| 7.3.6 | 编辑控件实现               | 4h         | 7.3.5 | Input/Toggle/Select 等             |
| 7.3.7 | 与 selection 联动          | 1h         | 7.3.3 | `setTarget()` / `refresh()`        |

**PropsPanel 接口设计**:

```typescript
interface PropsPanel {
  setTarget(element: Element | null): void;
  refresh(): void;
  dispose(): void;
}

interface PropsPanelOptions {
  container: HTMLElement;
  propsBridge: PropsBridge;
  onError?: (error: string) => void;
}
```

**UI 布局**:

```
┌────────────────────────────────────────┐
│ Props                          [Close] │
│ ─────────────────────────────────────  │
│ [Design] [DOM] [Props]                 │
├────────────────────────────────────────┤
│ ⚛️ React · ButtonComponent             │ ← 框架 + 组件名
│ ─────────────────────────────────────  │
│ ⚡ Can read | ⚡ Can write | ⚠️ Update  │ ← 能力状态
├────────────────────────────────────────┤
│ ▾ Props                                │
│   variant    [primary    ▼]            │ ← enum → Select
│   disabled   [  ] Toggle               │ ← boolean → Toggle
│   size       [medium    ]              │ ← string → Input
│   onClick    ƒ onClick()               │ ← function → 只读
│   children   <Icon />                  │ ← element → 只读
└────────────────────────────────────────┘
```

---

### Phase 7.4: Props 写入与更新 (P1)

**目标**: 实现 Props 修改并触发 React/Vue 重渲染

| 序号  | 任务                             | 预估工作量 | 依赖        | 说明                            |
| ----- | -------------------------------- | ---------- | ----------- | ------------------------------- |
| 7.4.1 | React Props 写入（使用官方 API） | 2h         | 7.2.1       | 调用 `renderer.overrideProps()` |
| 7.4.2 | React Class Component fallback   | 1h         | 7.4.1       | `pendingProps + forceUpdate`    |
| 7.4.3 | Vue Props 写入                   | 2h         | 7.2.2       | 修改 `instance.props`           |
| 7.4.4 | Vue 强制更新                     | 1h         | 7.4.3       | `proxy.$forceUpdate()`          |
| 7.4.5 | Reset 功能                       | 1h         | 7.4.1-7.4.4 | 重置所有 Props 修改             |
| 7.4.6 | Debounce 输入                    | 1h         | 7.4.5       | 避免高频写入                    |

**React Props 写入（复用 DevTools 官方 API）**:

```javascript
// 主路径：使用 renderer.overrideProps()（DevTools 官方 API）
function writeReactProps(fiber, path, value) {
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook?.renderers?.size) {
    return { success: false, error: 'No renderer available' };
  }

  // 找到有 overrideProps 能力的 renderer
  for (const [id, renderer] of hook.renderers) {
    if (typeof renderer.overrideProps === 'function') {
      // 官方 API：内部处理 props 修改 + 触发更新
      renderer.overrideProps(fiber, path, value);
      return { success: true, method: 'overrideProps' };
    }
  }

  // Fallback: Class Component 手动处理
  if (fiber.tag === 1 && fiber.stateNode) {
    const instance = fiber.stateNode;
    fiber.pendingProps = copyWithSet(fiber.memoizedProps, path, value);
    instance.forceUpdate();
    return { success: true, method: 'classForceUpdate' };
  }

  return { success: false, error: 'No write capability' };
}
```

**Vue 更新策略**:

```javascript
function writeVueProps(instance, propName, value) {
  // 1. 修改 props
  if (instance.props) {
    instance.props[propName] = value;
  }
  if (instance.vnode?.props) {
    instance.vnode.props[propName] = value;
  }

  // 2. 强制更新
  if (instance.proxy?.$forceUpdate) {
    instance.proxy.$forceUpdate();
    return { success: true, method: 'vueForceUpdate' };
  }

  if (instance.update) {
    instance.update();
    return { success: true, method: 'vueInstanceUpdate' };
  }

  return { success: false, error: 'No update method' };
}
```

**Reset 功能**:

- 刷新页面是最可靠的 reset 方式
- Props Tab 提供 "Refresh to Reset" 按钮
- 明确告知用户：修改是临时的，刷新即可恢复

---

### Phase 7 功能点追踪表

| 功能点 ID | 功能点描述                   | 任务编号    | 优先级 |
| --------- | ---------------------------- | ----------- | ------ |
| P1        | Props Agent + Hook 检测/注入 | 7.1.1-7.1.3 | P0     |
| P2        | Props Bridge 通信层          | 7.1.4       | P0     |
| P3        | Early-injection 机制         | 7.1.6       | P0     |
| P4        | React Props 读取             | 7.2.1       | P0     |
| P5        | Vue Props 读取               | 7.2.2       | P0     |
| P6        | Props 序列化                 | 7.2.3       | P0     |
| P7        | Props Tab UI                 | 7.3.1-7.3.7 | P1     |
| P8        | React Props 写入（官方 API） | 7.4.1-7.4.2 | P1     |
| P9        | Vue Props 写入               | 7.4.3-7.4.4 | P1     |
| P10       | Reset 功能                   | 7.4.5       | P1     |

---

### Phase 7 验收标准

#### Phase 7.1 验收 (基础设施 + Hook 管理)

- [ ] Props Agent 成功注入到 MAIN world
- [ ] 正确检测 4 种 Hook 状态：READY/NO_RENDERERS/NO_EDITING/MISSING
- [ ] Hook 不存在时成功注入最小 hook
- [ ] 需要刷新时正确提示用户
- [ ] Early-injection 注册后，后续导航自动生效

#### Phase 7.2 验收 (Props 读取)

- [ ] 选中 React 组件时能读取到 Props
- [ ] 选中 Vue 组件时能读取到 Props
- [ ] `renderer.findFiberByHostInstance` 可用时优先使用
- [ ] 非可序列化值（函数、Element）正确标记为只读

#### Phase 7.3 验收 (UI)

- [ ] Props Tab 正常切换
- [ ] Props 列表正确渲染
- [ ] 不同类型 Props 使用正确的控件
- [ ] 只读 Props 禁用编辑
- [ ] 状态提示清晰（需要刷新/需要 Dev 构建/正常可用）

#### Phase 7.4 验收 (写入 + 更新)

- [ ] 修改 Props 后 React Function Component 刷新（使用 overrideProps）
- [ ] 修改 Props 后 React Class Component 刷新（forceUpdate fallback）
- [ ] 修改 Props 后 Vue 组件刷新
- [ ] 更新失败时 UI 有明确提示
- [ ] "Refresh to Reset" 按钮工作正常

#### 最终验收

- [ ] React (Function Component) Dev 构建页面可用
- [ ] React (Class Component) Dev 构建页面可用
- [ ] Vue 3 Dev 构建页面可用
- [ ] 生产构建检测后提示"需要 Development 构建"
- [ ] 无内存泄漏（Editor stop 后正确清理）
- [ ] Hook 早注入后，后续页面自动可用（无需再刷新）
