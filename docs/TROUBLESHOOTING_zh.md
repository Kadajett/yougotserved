# 故障排除指南 🔧

Chrome MCP Server 的常见问题和解决方案。

## 📋 目录

- [安装问题](#安装问题)
- [Chrome 扩展问题](#chrome-扩展问题)
- [原生服务器问题](#原生服务器问题)
- [MCP 协议问题](#mcp-协议问题)
- [AI/SIMD 问题](#aisimd-问题)
- [性能问题](#性能问题)
- [网络捕获问题](#网络捕获问题)

## 🚀 安装问题

### Node.js 版本兼容性

**问题**：构建失败，出现 Node.js 版本错误

```
Error: Unsupported Node.js version
```

**解决方案**：

```bash
# 检查 Node.js 版本
node --version

# 如需要，安装 Node.js 18+
# 使用 nvm（推荐）
nvm install 18
nvm use 18

# 或从 nodejs.org 下载
```

### pnpm 安装问题

**问题**：找不到 `pnpm` 命令

```
bash: pnpm: command not found
```

**解决方案**：

```bash
# 全局安装 pnpm
npm install -g pnpm

# 或使用 corepack（Node.js 16.10+）
corepack enable
corepack prepare pnpm@latest --activate
```

### 构建失败

**问题**：`pnpm build` 期间构建失败

```
Error: Build failed with exit code 1
```

**解决方案**：

```bash
# 清理并重新构建
pnpm clean
pnpm install
pnpm build

# 检查特定包问题
pnpm build:shared
pnpm build:wasm
pnpm build:native
pnpm build:extension
```

## 🔌 Chrome 扩展问题

### 扩展无法加载

**问题**：扩展在 Chrome 中加载失败

**症状**：

- "清单文件丢失或不可读"
- "无效清单"
- 扩展显示为灰色

**解决方案**：

1. **检查构建输出**：

```bash
cd app/chrome-extension
pnpm build
# 验证 dist/ 目录存在且包含 manifest.json
```

2. **验证 manifest.json**：

```bash
cat app/chrome-extension/dist/manifest.json
# 应包含有效的 JSON 和版本 3
```

3. **启用开发者模式**：
   - 转到 `chrome://extensions/`
   - 打开"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择 `app/chrome-extension/dist`

### 原生消息连接失败

**问题**：扩展无法连接到原生服务器

```
Error: Native host has exited
```

**解决方案**：

1. **检查原生服务器安装**：

```bash
# 验证全局安装
npm list -g mcp-chrome-bridge

# 如需要，重新安装
cd app/native-server
npm install -g .
```

2. **验证原生消息清单**：

```bash
# macOS
cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.chromemcp.nativehost.json

# Linux
cat ~/.config/google-chrome/NativeMessagingHosts/com.chromemcp.nativehost.json

# Windows
# 检查注册表：HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.chromemcp.nativehost
```

3. **检查权限**：

```bash
# 确保可执行权限
chmod +x /path/to/mcp-chrome-bridge
```

### 扩展权限被拒绝

**问题**：扩展缺少必要权限

**解决方案**：

1. **手动授予权限**：

   - 右键点击扩展图标
   - 选择"选项"或"管理扩展"
   - 启用所有必需权限

2. **检查清单权限**：

```json
{
  "permissions": [
    "nativeMessaging",
    "tabs",
    "activeTab",
    "scripting",
    "notifications",
    "downloads",
    "webRequest",
    "debugger",
    "history",
    "bookmarks",
    "offscreen",
    "storage"
  ],
  "host_permissions": ["<all_urls>"]
}
```

## 🖥️ 原生服务器问题

### 服务器无法启动

**问题**：原生服务器启动失败

```
Error: listen EADDRINUSE :::12306
```

**解决方案**：

1. **检查端口可用性**：

```bash
# 检查端口 12306 是否被占用
lsof -i :12306
netstat -an | grep 12306

# 终止占用端口的进程
kill -9 <PID>
```

2. **使用不同端口**：

```bash
# 设置自定义端口
export NATIVE_SERVER_PORT=12307
mcp-chrome-bridge
```

### 找不到原生消息主机

**问题**：Chrome 找不到原生消息主机

```
Error: Specified native messaging host not found
```

**解决方案**：

1. **重新安装原生主机**：

```bash
cd app/native-server
npm uninstall -g mcp-chrome-bridge
npm install -g .
```

2. **手动安装清单**：

```bash
# 创建清单目录
mkdir -p ~/.config/google-chrome/NativeMessagingHosts/

# 复制清单
cp native-messaging-manifest.json ~/.config/google-chrome/NativeMessagingHosts/com.chromemcp.nativehost.json
```

## 🔗 MCP 协议问题

### MCP 客户端连接问题

**问题**：Claude Desktop 无法连接到 MCP 服务器

```
Error: Failed to connect to MCP server
```

**解决方案**：

1. **检查 MCP 配置**：

```json
{
  "mcpServers": {
    "chrome-mcp-server": {
      "command": "mcp-chrome-bridge",
      "args": []
    }
  }
}
```

2. **验证服务器运行**：

```bash
# 检查服务器是否监听
curl http://localhost:12306/health
```

3. **检查日志**：

```bash
# 原生服务器日志
tail -f ~/.local/share/mcp-chrome-bridge/logs/server.log

# Chrome 扩展日志
# 打开 Chrome DevTools -> 扩展 -> 后台脚本
```

### 工具执行超时

**问题**：工具执行期间超时

```
Error: Tool execution timeout after 30000ms
```

**解决方案**：

1. **增加超时时间**：

```typescript
// 在原生服务器配置中
const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
  request,
  NativeMessageType.CALL_TOOL,
  60000, // 增加到 60 秒
);
```

2. **检查 Chrome 扩展响应性**：
   - 打开 Chrome DevTools
   - 检查 JavaScript 错误
   - 监控内存使用

## 🧠 AI/SIMD 问题

### SIMD 不可用

**问题**：SIMD 加速不工作

```
Warning: SIMD not supported, using JavaScript fallback
```

**解决方案**：

1. **检查浏览器支持**：

   - Chrome 91+（2021年5月）
   - Firefox 89+（2021年6月）
   - Safari 16.4+（2023年3月）
   - Edge 91+（2021年5月）

2. **启用 SIMD 标志**（如需要）：

```
# Chrome 标志
chrome://flags/#enable-webassembly-simd
```

3. **验证 WASM 构建**：

```bash
cd packages/wasm-simd
pnpm build
# 检查 pkg/ 中的 simd_math.js 和 simd_math_bg.wasm
```

### AI 模型加载失败

**问题**：语义相似度引擎初始化失败

```
Error: Failed to load AI model
```

**解决方案**：

1. **检查模型文件**：

```bash
# 验证模型文件存在
ls app/chrome-extension/public/models/
# 应包含 model.onnx、tokenizer.json 等
```

2. **清除浏览器缓存**：

   - 打开 Chrome DevTools
   - 应用程序标签 -> 存储 -> 清除存储

3. **检查内存使用**：
   - 监控 Chrome 任务管理器
   - 确保有足够的 RAM（推荐 >2GB）

### 向量数据库问题

**问题**：向量搜索不工作

```
Error: Vector database initialization failed
```

**解决方案**：

1. **清除 IndexedDB**：

   - Chrome DevTools -> 应用程序 -> IndexedDB
   - 删除"VectorDatabase"条目

2. **检查 WASM 加载**：

```javascript
// 在浏览器控制台中
console.log(typeof WebAssembly);
// 应返回 "object"
```

## ⚡ 性能问题

### 高内存使用

**问题**：扩展使用过多内存（>500MB）

**解决方案**：

1. **减少缓存大小**：

```typescript
// 在 semantic-similarity-engine.ts 中
const config = {
  cacheSize: 100, // 从默认 500 减少
  maxElements: 5000, // 减少向量数据库大小
};
```

2. **定期清除缓存**：

```javascript
// 清除嵌入缓存
semanticEngine.clearCache();

// 清除向量数据库
vectorDatabase.clear();
```

### 工具执行缓慢

**问题**：工具执行超过 5 秒

**解决方案**：

1. **检查内容脚本注入**：

```javascript
// 验证脚本已缓存
chrome.scripting.getRegisteredContentScripts();
```

2. **优化选择器**：

```javascript
// 使用高效选择器
'#specific-id'; // 好
'.class-name'; // 可以
'div > span.class'; // 比复杂选择器好
```

3. **监控性能**：

```javascript
// 添加计时日志
console.time('tool-execution');
// ... 工具代码 ...
console.timeEnd('tool-execution');
```

## 🌐 网络捕获问题

### 没有捕获到请求

**问题**：网络捕获返回空结果

**解决方案**：

1. **检查权限**：

   - 确保授予"webRequest"权限
   - 验证主机权限包含目标域

2. **验证捕获时机**：

```javascript
// 在导航前开始捕获
await callTool('chrome_network_capture_start');
await callTool('chrome_navigate', { url: 'https://example.com' });
// 等待页面加载
await new Promise((resolve) => setTimeout(resolve, 3000));
await callTool('chrome_network_capture_stop');
```

3. **检查过滤器**：
   - 如需要，禁用静态资源过滤
   - 验证 URL 模式匹配

### Debugger API 问题

**问题**：调试器捕获失败

```
Error: Cannot attach debugger to this target
```

**解决方案**：

1. **检查标签页状态**：

   - 确保标签页不是 Chrome 内部页面
   - 验证标签页已完全加载

2. **分离现有调试器**：

```javascript
// 在 Chrome DevTools 控制台中
chrome.debugger.getTargets().then((targets) => {
  targets.forEach((target) => {
    if (target.attached) {
      chrome.debugger.detach({ targetId: target.id });
    }
  });
});
```

## 🆘 获取帮助

如果您仍然遇到问题：

1. **检查 GitHub Issues**：[github.com/hangwin/chrome-mcp-server/issues](https://github.com/hangwin/chrome-mcp-server/issues)

2. **创建错误报告**，包含：

   - 操作系统和版本
   - Chrome 版本
   - Node.js 版本
   - 完整错误消息
   - 重现步骤

3. **启用调试日志**：

```bash
# 设置调试环境
export DEBUG=chrome-mcp-server:*
mcp-chrome-bridge
```

4. **收集日志**：

   - Chrome 扩展控制台日志
   - 原生服务器日志
   - MCP 客户端日志

5. **使用最小设置测试**：
   - 新的 Chrome 配置文件
   - 干净安装
   - 默认配置

报告问题时请记得包含相关日志和系统信息！
