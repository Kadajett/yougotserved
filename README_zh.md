# Chrome MCP Server 🚀

[![许可证: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)
[![Chrome 扩展](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://developer.chrome.com/docs/extensions/)

> 🌟 **让chrome浏览器变成你的智能助手** - 让AI接管你的浏览器，将您的浏览器转变为强大的 AI 控制自动化工具。

**📖 文档**: [English](README.md) | [中文](README_zh.md)

---

## 🎯 什么是 Chrome MCP Server？

Chrome MCP Server 是一个基于chrome插件的 **模型上下文协议 (MCP) 服务器**，它将您的 Chrome 浏览器功能暴露给 Claude 等 AI 助手，实现复杂的浏览器自动化、内容分析和语义搜索等。与传统的浏览器自动化工具（如playwright）不同，**Chrome MCP server**直接使用您日常使用的chrome浏览器，基于现有的用户习惯和配置、登录态，让各种大模型或者各种chatbot都可以接管你的浏览器，真正成为你的如常助手

## ✨ 核心特性

- 😁 **chatbot/模型无关**：让任意你喜欢的llm或chatbot客户端或agent来自动化操作你的浏览器
- ⭐️ **使用你原本的浏览器**：无缝集成用户本身的浏览器环境（你的配置、登录态等）
- 💻 **完全本地运行**：纯本地运行的mcp server，保证用户隐私
- 🚄 **Streamable http**：Streamable http的连接方式
- 🏎 **跨标签页** 跨标签页的上下文
- 🧠 **语义搜索**：内置向量数据库和本地小模型，智能发现浏览器标签页内容
- 🔍 **智能内容分析**：AI 驱动的文本提取和相似度匹配
- 🌐 **20+ 工具**：支持截图、网络监控、交互操作、书签管理、浏览历史等20多种工具
- 🚀 **SIMD 加速 AI**：自定义 WebAssembly SIMD 优化，向量运算速度提升 4-8 倍

## 🆚 与同类项目对比

| 对比维度           | 基于Playwright的MCP Server                                          | 基于Chrome插件的MCP Server                                    |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| **资源占用**       | ❌ 需启动独立浏览器进程，需要安装Playwright依赖，下载浏览器二进制等 | ✅ 无需启动独立的浏览器进程，直接利用用户已打开的Chrome浏览器 |
| **用户会话复用**   | ❌ 需重新登录                                                       | ✅ 自动使用已登录状态                                         |
| **浏览器环境保持** | ❌ 干净环境缺少用户设置                                             | ✅ 完整保留用户环境                                           |
| **API访问权限**    | ⚠️ 受限于Playwright API                                             | ✅ Chrome原生API全访问                                        |
| **启动速度**       | ❌ 需启动浏览器进程                                                 | ✅ 只需激活插件                                               |
| **响应速度**       | 50-200ms进程间通信                                                  | ✅ 更快                                                       |

## 🚀 快速开始

### 环境要求

- Node.js 18+ 和 pnpm
- Chrome/Chromium 浏览器

### 安装步骤

1. **从github上下载最新的chrome扩展**

下载地址：https://github.com/hangwin/chrome-mcp-server/releases

2. **全局安装mcp-chrome-bridge**

npm

```bash
npm install -g mcp-chrome-bridge
```

pnpm

```bash
pnpm install -g mcp-chrome-bridge
```

3. **加载 Chrome 扩展**
   - 打开 Chrome 并访问 `chrome://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序"，选择 `your/dowloaded/extension/folder`
   - 点击插件图标打开插件，点击连接即可看到mcp的配置
     <img width="475" alt="截屏2025-06-09 15 52 06" src="https://github.com/user-attachments/assets/241e57b8-c55f-41a4-9188-0367293dc5bc" />

### 在 Claude Desktop 中使用

将以下配置添加到 Claude Desktop 的 MCP 配置中：

```json
{
  "mcpServers": {
    "streamable-mcp-server": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

## 🛠️ 可用工具

完整工具列表：[完整工具列表](docs/TOOLS_zh.md)

<details>
<summary><strong>📊 浏览器管理 (4个工具)</strong></summary>

- `get_windows_and_tabs` - 列出所有浏览器窗口和标签页
- `chrome_navigate` - 导航到 URL 并控制视口
- `chrome_close_tabs` - 关闭特定标签页或窗口
- `chrome_go_back_or_forward` - 浏览器导航控制
</details>

<details>
<summary><strong>📸 截图和视觉 (1个工具)</strong></summary>

- `chrome_screenshot` - 高级截图捕获，支持元素定位、全页面和自定义尺寸
</details>

<details>
<summary><strong>🌐 网络监控 (4个工具)</strong></summary>

- `chrome_network_capture_start/stop` - webRequest API 网络捕获
- `chrome_network_debugger_start/stop` - Debugger API 包含响应体
- `chrome_network_request` - 发送自定义 HTTP 请求
</details>

<details>
<summary><strong>🔍 内容分析 (3个工具)</strong></summary>

- `search_tabs_content` - AI 驱动的浏览器标签页语义搜索
- `chrome_get_web_content` - 从页面提取 HTML/文本内容
- `chrome_get_interactive_elements` - 查找可点击元素
</details>

<details>
<summary><strong>🎯 交互操作 (3个工具)</strong></summary>

- `chrome_click_element` - 使用 CSS 选择器点击元素
- `chrome_fill_or_select` - 填充表单和选择选项
- `chrome_keyboard` - 模拟键盘输入和快捷键
</details>

<details>
<summary><strong>📚 数据管理 (5个工具)</strong></summary>

- `chrome_history` - 搜索浏览器历史记录，支持时间过滤
- `chrome_bookmark_search` - 按关键词查找书签
- `chrome_bookmark_add` - 添加新书签，支持文件夹
- `chrome_bookmark_delete` - 删除书签
</details>

## 🧪 使用示例

### ai自动帮你捕获网络请求

指令：我想知道小红书的搜索接口是哪个，响应体结构是什么样的

https://github.com/user-attachments/assets/063f44ae-1754-46b6-b141-5988c86e4d96

### ai帮你分析你的浏览记录

指令：分析一下我近一个月的浏览记录

https://github.com/user-attachments/assets/e7a35118-e50e-4b1c-a790-0878aa2505ab

### 网页对话

指令：翻译并总结当前网页

https://github.com/user-attachments/assets/08aa86aa-7706-4df2-b400-576e2c7fcc7f

### ai帮你自动截图（网页截图）

指令：把huggingface的首页截个图

https://github.com/user-attachments/assets/b081e41b-6309-40d6-885b-0da01691b12e

### ai帮你自动截图（元素截图）

指令：把huggingface首页的图标截取下来

https://github.com/user-attachments/assets/25657076-b84b-4459-a72f-90f896f06364

### ai帮你管理书签

指令：将当前页面添加到书签中，放到合适的文件夹

https://github.com/user-attachments/assets/73c1ea26-65fb-4b5e-b537-e32fa9bcfa52

### 自动关闭网页

指令：关闭所有shadcn相关的网页

https://github.com/user-attachments/assets/ff160f48-58e0-4c76-a6b0-c4e1f91370c8

## 🤝 贡献指南

我们欢迎贡献！请查看 [CONTRIBUTING_zh.md](docs/CONTRIBUTING_zh.md) 了解详细指南。

## 🚧 未来发展路线图

我们对 Chrome MCP Server 的未来发展有着激动人心的计划：

### 🔐 身份验证与安全
- **用户身份验证**：实现安全的用户身份验证系统
- **API 密钥管理**：支持基于 API 密钥的访问控制
- **权限系统**：对不同工具和操作进行细粒度权限控制
- **安全存储**：增强敏感数据存储的安全性

### 📹 录制与回放
- **操作录制**：记录用户交互和浏览器操作
- **回放引擎**：使用可自定义参数重放录制的操作
- **脚本生成**：从录制的会话自动生成自动化脚本
- **会话管理**：保存、组织和分享录制的会话

### 🔄 工作流自动化
- **可视化工作流构建器**：拖拽式界面创建复杂工作流
- **条件逻辑**：支持工作流中的 if/else 条件和循环
- **工作流模板**：为常见自动化任务提供预构建模板
- **调度功能**：基于时间和事件触发的工作流执行
- **工作流共享**：用户间导入/导出工作流

### 🧪 测试与质量保证
- **单元测试框架**：为 Chrome 扩展组件提供全面的测试套件
- **集成测试**：在真实浏览器环境中进行端到端测试
- **性能监控**：内置性能指标和优化工具
- **错误报告**：高级错误跟踪和调试功能

### 🌐 增强浏览器支持
- **Firefox 扩展**：扩展对 Firefox 浏览器的支持
- **Safari 扩展**：支持 Safari 浏览器（在技术可行的情况下）
- **移动浏览器支持**：探索移动浏览器自动化的可能性

### 🤖 人工智能与机器学习
- **智能元素检测**：AI 驱动的元素识别和交互
- **预测性操作**：基于用户行为模式建议下一步操作
- **自然语言处理**：增强自然语言命令解释能力
- **计算机视觉**：高级截图分析和视觉元素检测

### 🔧 开发者体验
- **插件系统**：用于自定义工具的可扩展插件架构
- **CLI 工具**：为高级用户提供命令行界面
- **API 文档**：交互式 API 文档和测试工具
- **开发套件**：用于构建自定义 MCP 工具和扩展的 SDK

### 📊 分析与洞察
- **使用分析**：工具使用和性能的详细洞察
- **浏览器行为分析**：理解和优化浏览器交互模式
- **性能指标**：扩展性能的实时监控
- **用户体验指标**：跟踪和改善用户满意度

---

**想要为这些功能中的任何一个做贡献？** 查看我们的[贡献指南](docs/CONTRIBUTING_zh.md)并加入我们的开发社区！

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 📚 更多文档

- [架构设计](docs/ARCHITECTURE_zh.md) - 详细的技术架构说明
- [工具列表](docs/TOOLS_zh.md) - 完整的工具 API 文档
- [故障排除](docs/TROUBLESHOOTING_zh.md) - 常见问题解决方案
