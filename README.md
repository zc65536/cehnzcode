# cehnzcode

一个自己随便写的 mini Claude Code，支持 OpenAI 兼容接口和 MCP (Model Context Protocol) 扩展。

## 特性

- ✅ **OpenAI 兼容接口**：支持任何 OpenAI 兼容的 API
- ✅ **内置工具**：文件读写、编辑、bash 命令、glob、grep、项目结构探索等
- ✅ **项目结构探索**：AI 可以自主探索项目目录结构，智能过滤和折叠显示
- ✅ **MCP 支持**：通过 MCP 协议动态扩展工具集
- ✅ **上下文管理**：智能压缩和截断策略
- ✅ **会话持久化**：保存和恢复对话历史
- ✅ **插件系统**：支持自定义插件扩展
- ✅ **命令系统**：内置命令（/help、/clear、/exit、/mcp）

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置环境变量

复制 `.env.example` 到 `.env` 并配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
API_KEY=your-api-key
API_BASE_URL=https://api.openai.com/v1
MODEL=gpt-4
MAX_TOKENS=4096
CONTEXT_LIMIT=100000
LOG_LEVEL=info
```

### 运行

```bash
# 开发模式
npm run dev

# 或者先编译再运行
npm run build
npm start
```

## MCP 支持

cehnzcode 支持 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)，可以动态扩展工具集。

### 安装 uv（MCP 服务器运行环境）

```bash
# Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# 或使用 pip
pip install uv
```

### 添加 MCP 服务器

在应用中使用 `/mcp` 命令：

```bash
# 添加 fetch 服务器（系统级）
/mcp add fetch uvx mcp-server-fetch

# 添加服务器（项目级）
/mcp add fetch uvx mcp-server-fetch --project

# 查看所有服务器
/mcp list

# 移除服务器
/mcp remove fetch

# 重新加载配置
/mcp reload
```

### 配置文件方式

创建配置文件 `~/.cehnzcode/mcp.json`（系统级）或 `<project>/.cehnzcode/mcp.json`（项目级）：

```json
{
  "mcpServers": {
    "fetch": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "env": {
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "disabled": false,
      "autoApprove": ["fetch"]
    }
  }
}
```

### MCP 工具使用

添加 MCP 服务器后，AI 会自动看到并使用这些工具：

```
用户: 帮我获取 https://example.com 的内容
助手: [自动调用 mcp__fetch__fetch 工具]
```

更多 MCP 使用示例，请参考 [MCP 使用示例](./src/mcp/USAGE_EXAMPLES.md)。

## 内置命令

- `/help` - 显示帮助信息
- `/clear` - 清空对话历史
- `/exit` - 退出应用
- `/mcp <add|list|remove|reload>` - 管理 MCP 服务器

## 内置工具

- `read_file` - 读取文件内容
- `write_file` - 写入文件
- `edit_file` - 编辑文件（搜索替换）
- `bash` - 执行 bash 命令
- `glob` - 文件路径匹配
- `grep` - 文本搜索
- `get_project_structure` - 获取项目目录结构（支持智能过滤和折叠）

## 项目结构

```
src/
├── commands/       # 命令系统
├── config/         # 配置管理
├── context/        # 上下文管理
├── events/         # 事件系统
├── logger/         # 日志系统
├── mcp/            # MCP 模块
├── model/          # AI 模型接口
├── orchestrator/   # 主控制器
├── plugins/        # 插件系统
├── prompts/        # 提示词管理
├── session/        # 会话管理
├── tools/          # 工具系统
└── ui/             # 用户界面
```

## 开发

### 运行测试

```bash
# MCP 集成测试
npx tsx src/mcp/test-integration.ts

# MCP 真实服务器测试（需要安装 uv）
npx tsx src/mcp/test-real-server.ts

# 工具注册表测试
npx tsx src/tools/test-registry.ts
```

### 启用调试日志

在 `.env` 文件中设置：

```env
LOG_LEVEL=debug
DEBUG_API_LOG=true
```

## 文档

- [项目计划](./plan.md) - 完整的架构设计和实现计划
- [代码规范](./CLAUDE.md) - 代码风格和开发规范
- [项目结构探索实现](./PROJECT_EXPLORER_IMPLEMENTATION.md) - Project Explorer 功能说明
- [Context 模块 README](./src/context/README.md) - Context 模块文档
- [MCP 模块 README](./src/mcp/README.md) - MCP 模块文档
- [MCP 集成状态](./src/mcp/INTEGRATION_STATUS.md) - MCP 集成完成情况
- [MCP 使用示例](./src/mcp/USAGE_EXAMPLES.md) - MCP 实际使用示例

## 许可证

MIT