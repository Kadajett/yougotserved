# Troubleshooting Guide 🔧

Common issues and solutions for Chrome MCP Server.

## 📋 Table of Contents

- [Installation Issues](#installation-issues)
- [Chrome Extension Problems](#chrome-extension-problems)
- [Native Server Issues](#native-server-issues)
- [MCP Protocol Problems](#mcp-protocol-problems)
- [AI/SIMD Issues](#aisimd-issues)
- [Performance Problems](#performance-problems)
- [Network Capture Issues](#network-capture-issues)

## 🚀 Installation Issues

### Node.js Version Compatibility

**Problem**: Build fails with Node.js version errors

```
Error: Unsupported Node.js version
```

**Solution**:

```bash
# Check Node.js version
node --version

# Install Node.js 18+ if needed
# Using nvm (recommended)
nvm install 18
nvm use 18

# Or download from nodejs.org
```

### pnpm Installation Issues

**Problem**: `pnpm` command not found

```
bash: pnpm: command not found
```

**Solution**:

```bash
# Install pnpm globally
npm install -g pnpm

# Or using corepack (Node.js 16.10+)
corepack enable
corepack prepare pnpm@latest --activate
```

### Build Failures

**Problem**: Build fails during `pnpm build`

```
Error: Build failed with exit code 1
```

**Solutions**:

```bash
# Clean and rebuild
pnpm clean
pnpm install
pnpm build

# Check for specific package issues
pnpm build:shared
pnpm build:wasm
pnpm build:native
pnpm build:extension
```

## 🔌 Chrome Extension Problems

### Extension Not Loading

**Problem**: Extension fails to load in Chrome

**Symptoms**:

- "Manifest file is missing or unreadable"
- "Invalid manifest"
- Extension appears grayed out

**Solutions**:

1. **Check build output**:

```bash
cd app/chrome-extension
pnpm build
# Verify dist/ directory exists and contains manifest.json
```

2. **Verify manifest.json**:

```bash
cat app/chrome-extension/dist/manifest.json
# Should contain valid JSON with version 3
```

3. **Enable Developer Mode**:
   - Go to `chrome://extensions/`
   - Toggle "Developer mode" ON
   - Click "Load unpacked"
   - Select `app/chrome-extension/dist`

### Native Messaging Connection Failed

**Problem**: Extension can't connect to native server

```
Error: Native host has exited
```

**Solutions**:

1. **Check native server installation**:

```bash
# Verify global installation
npm list -g mcp-chrome-bridge

# Reinstall if needed
cd app/native-server
npm install -g .
```

2. **Verify native messaging manifest**:

```bash
# macOS
cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.chromemcp.nativehost.json

# Linux
cat ~/.config/google-chrome/NativeMessagingHosts/com.chromemcp.nativehost.json

# Windows
# Check Registry: HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.chromemcp.nativehost
```

3. **Check permissions**:

```bash
# Ensure executable permissions
chmod +x /path/to/mcp-chrome-bridge
```

### Extension Permissions Denied

**Problem**: Extension lacks necessary permissions

**Solutions**:

1. **Grant permissions manually**:

   - Right-click extension icon
   - Select "Options" or "Manage extension"
   - Enable all required permissions

2. **Check manifest permissions**:

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

## 🖥️ Native Server Issues

### Server Won't Start

**Problem**: Native server fails to start

```
Error: listen EADDRINUSE :::12306
```

**Solutions**:

1. **Check port availability**:

```bash
# Check if port 12306 is in use
lsof -i :12306
netstat -an | grep 12306

# Kill process using the port
kill -9 <PID>
```

2. **Use different port**:

```bash
# Set custom port
export NATIVE_SERVER_PORT=12307
mcp-chrome-bridge
```

### Native Messaging Host Not Found

**Problem**: Chrome can't find native messaging host

```
Error: Specified native messaging host not found
```

**Solutions**:

1. **Reinstall native host**:

```bash
cd app/native-server
npm uninstall -g mcp-chrome-bridge
npm install -g .
```

2. **Manual manifest installation**:

```bash
# Create manifest directory
mkdir -p ~/.config/google-chrome/NativeMessagingHosts/

# Copy manifest
cp native-messaging-manifest.json ~/.config/google-chrome/NativeMessagingHosts/com.chromemcp.nativehost.json
```

## 🔗 MCP Protocol Problems

### MCP Client Connection Issues

**Problem**: Claude Desktop can't connect to MCP server

```
Error: Failed to connect to MCP server
```

**Solutions**:

1. **Check MCP configuration**:

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

2. **Verify server is running**:

```bash
# Check if server is listening
curl http://localhost:12306/health
```

3. **Check logs**:

```bash
# Native server logs
tail -f ~/.local/share/mcp-chrome-bridge/logs/server.log

# Chrome extension logs
# Open Chrome DevTools -> Extensions -> Background Script
```

### Tool Execution Timeouts

**Problem**: Tools timeout during execution

```
Error: Tool execution timeout after 30000ms
```

**Solutions**:

1. **Increase timeout**:

```typescript
// In native server configuration
const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
  request,
  NativeMessageType.CALL_TOOL,
  60000, // Increase to 60 seconds
);
```

2. **Check Chrome extension responsiveness**:
   - Open Chrome DevTools
   - Check for JavaScript errors
   - Monitor memory usage

## 🧠 AI/SIMD Issues

### SIMD Not Available

**Problem**: SIMD acceleration not working

```
Warning: SIMD not supported, using JavaScript fallback
```

**Solutions**:

1. **Check browser support**:

   - Chrome 91+ (May 2021)
   - Firefox 89+ (June 2021)
   - Safari 16.4+ (March 2023)
   - Edge 91+ (May 2021)

2. **Enable SIMD flags** (if needed):

```
# Chrome flags
chrome://flags/#enable-webassembly-simd
```

3. **Verify WASM build**:

```bash
cd packages/wasm-simd
pnpm build
# Check for simd_math.js and simd_math_bg.wasm in pkg/
```

### AI Model Loading Failures

**Problem**: Semantic similarity engine fails to initialize

```
Error: Failed to load AI model
```

**Solutions**:

1. **Check model files**:

```bash
# Verify model files exist
ls app/chrome-extension/public/models/
# Should contain model.onnx, tokenizer.json, etc.
```

2. **Clear browser cache**:

   - Open Chrome DevTools
   - Application tab -> Storage -> Clear storage

3. **Check memory usage**:
   - Monitor Chrome task manager
   - Ensure sufficient RAM available (>2GB recommended)

### Vector Database Issues

**Problem**: Vector search not working

```
Error: Vector database initialization failed
```

**Solutions**:

1. **Clear IndexedDB**:

   - Chrome DevTools -> Application -> IndexedDB
   - Delete "VectorDatabase" entries

2. **Check WASM loading**:

```javascript
// In browser console
console.log(typeof WebAssembly);
// Should return "object"
```

## ⚡ Performance Problems

### High Memory Usage

**Problem**: Extension uses excessive memory (>500MB)

**Solutions**:

1. **Reduce cache sizes**:

```typescript
// In semantic-similarity-engine.ts
const config = {
  cacheSize: 100, // Reduce from default 500
  maxElements: 5000, // Reduce vector DB size
};
```

2. **Clear caches periodically**:

```javascript
// Clear embedding cache
semanticEngine.clearCache();

// Clear vector database
vectorDatabase.clear();
```

### Slow Tool Execution

**Problem**: Tools take >5 seconds to execute

**Solutions**:

1. **Check content script injection**:

```javascript
// Verify scripts are cached
chrome.scripting.getRegisteredContentScripts();
```

2. **Optimize selectors**:

```javascript
// Use efficient selectors
'#specific-id'; // Good
'.class-name'; // OK
'div > span.class'; // Better than complex selectors
```

3. **Monitor performance**:

```javascript
// Add timing logs
console.time('tool-execution');
// ... tool code ...
console.timeEnd('tool-execution');
```

## 🌐 Network Capture Issues

### No Requests Captured

**Problem**: Network capture returns empty results

**Solutions**:

1. **Check permissions**:

   - Ensure "webRequest" permission is granted
   - Verify host permissions include target domain

2. **Verify capture timing**:

```javascript
// Start capture before navigation
await callTool('chrome_network_capture_start');
await callTool('chrome_navigate', { url: 'https://example.com' });
// Wait for page load
await new Promise((resolve) => setTimeout(resolve, 3000));
await callTool('chrome_network_capture_stop');
```

3. **Check filters**:
   - Disable static resource filtering if needed
   - Verify URL patterns match

### Debugger API Issues

**Problem**: Debugger capture fails

```
Error: Cannot attach debugger to this target
```

**Solutions**:

1. **Check tab state**:

   - Ensure tab is not a Chrome internal page
   - Verify tab is fully loaded

2. **Detach existing debuggers**:

```javascript
// In Chrome DevTools console
chrome.debugger.getTargets().then((targets) => {
  targets.forEach((target) => {
    if (target.attached) {
      chrome.debugger.detach({ targetId: target.id });
    }
  });
});
```

## 🆘 Getting Help

If you're still experiencing issues:

1. **Check GitHub Issues**: [github.com/hangwin/chrome-mcp-server/issues](https://github.com/hangwin/chrome-mcp-server/issues)

2. **Create a Bug Report** with:

   - Operating system and version
   - Chrome version
   - Node.js version
   - Complete error messages
   - Steps to reproduce

3. **Enable Debug Logging**:

```bash
# Set debug environment
export DEBUG=chrome-mcp-server:*
mcp-chrome-bridge
```

4. **Collect Logs**:

   - Chrome extension console logs
   - Native server logs
   - MCP client logs

5. **Test with Minimal Setup**:
   - Fresh Chrome profile
   - Clean installation
   - Default configuration

Remember to include relevant logs and system information when reporting issues!
