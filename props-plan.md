# Props 面板源码位置展示与 VSCode 跳转 - 需求规划

## 需求概述

在 web-editor-v2 的 Props 面板中：

1. 展示 Vue/React 组件的源码文件路径（相对路径 + 行号列号）
2. 添加按钮，点击后用 VSCode 打开对应文件位置

## 用户澄清的关键问题

### 1. Vue 组件的定位信息来源

**问题**: Vue 3 的 `type.__file` 只有文件路径，没有行号列号。

**用户反馈**: 使用 `create-vue` 创建的项目会有 `data-v-inspector` 属性，格式如：

```html
<div data-v-inspector="src/components/HeroSection.vue:23:7"></div>
```

**解决方案**:

- 优先读取 `data-v-inspector` 属性（由 `@vitejs/plugin-vue-inspector` 注入）
- Fallback 到 `type.__file`（只有文件路径，无行列号）

### 2. 打开 VSCode 的方式

**问题**: 直接用 `vscode://file/...` 协议可能缺少项目根路径。

**用户反馈**: 复用 session 里打开 VSCode 的方式，因为那个有项目路径。

**解决方案**:

- 复用现有的 `/agent/sessions/:sessionId/open` 路由
- 扩展 `OpenProjectRequest` 支持 `{ target: 'vscode', file?, line?, column? }`
- 通过 `chrome.storage.local['agent-selected-session-id']` 获取当前 session

### 3. UI 位置

**用户选择**: 在 Props 面板 Meta 区域新增单独的 Source 行。

---

## 技术方案

### 数据流架构

```
[props-panel.ts UI (ISOLATED)]
  └─ propsBridge.probe/read()  (CustomEvent)
        └─ props-agent.js (MAIN)
              └─ Vue: 优先读取 data-v-inspector，fallback 到 __file
              └─ React: 读取 _debugSource (file/line/column)
              └─ 返回 PropsResponseData.debugSource
  └─ 点击 "Open in VSCode"
        └─ chrome.runtime.sendMessage({ type: WEB_EDITOR_OPEN_SOURCE, debugSource })
              └─ background/web-editor/index.ts
                    └─ 读取 nativeServerPort + agent-selected-session-id
                    └─ POST /agent/sessions/:sessionId/open (扩展 body)
                          └─ native-server open-project.ts
                                └─ code -r <root> -g <file>:<line>:<col>
```

### 关键改动点

| 文件                                                                              | 改动                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `app/chrome-extension/inject-scripts/props-agent.js`                              | VueAdapter/ReactAdapter 新增 getDebugSource 方法 |
| `app/chrome-extension/entrypoints/web-editor-v2/core/props-bridge.ts`             | PropsResponseData 添加 debugSource 字段          |
| `app/chrome-extension/entrypoints/web-editor-v2/ui/property-panel/props-panel.ts` | Meta 区新增 Source 行 + Open 按钮                |
| `app/chrome-extension/common/message-types.ts`                                    | 新增 WEB_EDITOR_OPEN_SOURCE 消息类型             |
| `app/chrome-extension/entrypoints/background/web-editor/index.ts`                 | 处理 WEB_EDITOR_OPEN_SOURCE 消息                 |
| `packages/shared/src/agent-types.ts`                                              | OpenProjectRequest 添加 file/line/column 字段    |
| `app/native-server/src/server/routes/agent.ts`                                    | 扩展 sessions/open 路由处理                      |
| `app/native-server/src/agent/open-project.ts`                                     | 新增 openFileInVSCode 函数                       |

---

## 实现细节

### 1. props-agent.js - VueAdapter.getDebugSource

```javascript
/**
 * 解析 data-v-inspector 属性值
 * 格式: "src/components/Foo.vue:23:7"
 * Windows 路径兼容: 用正则只匹配末尾的 :line:col
 */
parseVInspector(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  // 只匹配末尾的 :line 或 :line:col
  const m = raw.match(/:(\d+)(?::(\d+))?$/);
  if (!m) return { file: raw };
  return {
    file: raw.slice(0, m.index),
    line: parseInt(m[1], 10),
    column: m[2] ? parseInt(m[2], 10) : undefined,
  };
},

/**
 * 从 DOM 元素向上查找 data-v-inspector 属性
 */
findInspectorLocation(element, maxDepth = 15) {
  let node = element;
  for (let i = 0; i < maxDepth && node; i++) {
    if (node.getAttribute) {
      const attr = node.getAttribute('data-v-inspector');
      if (attr) return this.parseVInspector(attr);
    }
    node = node.parentElement;
  }
  return null;
},

/**
 * 获取 Vue 组件的 debugSource
 * 优先级: data-v-inspector > type.__file
 */
getDebugSource(instance, targetElement) {
  // 优先尝试 data-v-inspector
  const inspector = this.findInspectorLocation(targetElement);
  if (inspector?.file) {
    return {
      file: inspector.file,
      line: inspector.line,
      column: inspector.column,
      componentName: this.getComponentName(instance),
    };
  }
  // Fallback 到 __file
  const file = instance?.type?.__file;
  if (typeof file === 'string' && file.trim()) {
    return {
      file: file.trim(),
      componentName: this.getComponentName(instance),
    };
  }
  return null;
},
```

### 2. props-agent.js - ReactAdapter.getDebugSource

```javascript
/**
 * 获取 React 组件的 debugSource
 */
getDebugSource(fiber) {
  for (let current = fiber, i = 0; i < 40 && current; i++, current = current.return) {
    // 检查 _debugSource
    const src = current._debugSource;
    if (src?.fileName) {
      return {
        file: src.fileName,
        line: typeof src.lineNumber === 'number' ? src.lineNumber : undefined,
        column: typeof src.columnNumber === 'number' ? src.columnNumber : undefined,
        componentName: this.getComponentName(current),
      };
    }
    // 检查 owner 的 _debugSource
    const ownerSrc = current._debugOwner?._debugSource;
    if (ownerSrc?.fileName) {
      return {
        file: ownerSrc.fileName,
        line: typeof ownerSrc.lineNumber === 'number' ? ownerSrc.lineNumber : undefined,
        column: typeof ownerSrc.columnNumber === 'number' ? ownerSrc.columnNumber : undefined,
        componentName: this.getComponentName(current._debugOwner),
      };
    }
  }
  return null;
},
```

### 3. native-server - openFileInVSCode

```typescript
export async function openFileInVSCode(
  projectRoot: string,
  filePath: string,
  line?: number,
  column?: number,
): Promise<OpenProjectResponse> {
  // 1. 安全校验: 确保文件在项目目录内
  const absoluteFile = path.resolve(projectRoot, filePath);
  const relative = path.relative(projectRoot, absoluteFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { success: false, error: 'File path escapes project directory' };
  }

  // 2. 构建 -g 参数
  let gotoArg = absoluteFile;
  if (typeof line === 'number' && line > 0) {
    gotoArg += `:${line}`;
    if (typeof column === 'number' && column > 0) {
      gotoArg += `:${column}`;
    }
  }

  // 3. 执行 code -r <root> -g <file>:<line>:<col>
  const attempts = [
    { cmd: 'code', args: ['-r', projectRoot, '-g', gotoArg] },
    // Windows fallback
    { cmd: 'code.cmd', args: ['-r', projectRoot, '-g', gotoArg] },
    // macOS fallback
    {
      cmd: 'open',
      args: ['-b', 'com.microsoft.VSCode', '--args', '-r', projectRoot, '-g', gotoArg],
    },
  ];
  // ... 执行逻辑
}
```

---

## 边界情况处理

| 场景                       | 处理方式                          |
| -------------------------- | --------------------------------- |
| Vue/React 都无 debugSource | Source 行隐藏                     |
| 只有 file，无 line/column  | 展示文件路径，VSCode 打开文件开头 |
| Session 未选中             | background 返回错误提示           |
| 文件路径是绝对路径         | native-server resolve 后校验      |
| 文件不存在                 | native-server 返回错误            |

---

## 实现顺序

1. **Phase 1**: props-agent.js - 收集 debugSource (VueAdapter + ReactAdapter)
2. **Phase 2**: 类型扩展 (props-bridge.ts, agent-types.ts)
3. **Phase 3**: props-panel.ts - UI 展示与跳转
4. **Phase 4**: 消息通道 (message-types.ts, background/web-editor)
5. **Phase 5**: native-server (routes/agent.ts, open-project.ts)
6. **Phase 6**: 测试验证

---

## 参考资料

### 现有代码位置

- Props 数据流: `props-bridge.ts` ↔ `props-agent.js` (CustomEvent 通信)
- 现有 debugSource 类型: `common/web-editor-types.ts:132` (`DebugSource` 接口)
- 现有 VSCode 打开能力: `native-server/src/agent/open-project.ts` (只支持打开目录)
- Session 存储 key: `chrome.storage.local['agent-selected-session-id']`

### Vue DevTools 参考

- Vue DevTools 使用 `@vitejs/plugin-vue-inspector` 注入 `data-v-inspector` 属性
- Vite 的 `/__open-in-editor` 端点格式: `/__open-in-editor?file=path:line:col`
