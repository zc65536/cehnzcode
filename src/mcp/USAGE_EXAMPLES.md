# MCP 使用示例

本文档提供 MCP 模块的实际使用示例。

## 前置条件

安装 `uv`（用于运行 MCP 服务器）：

```bash
# Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# 或使用 pip
pip install uv
```

验证安装：
```bash
uvx --version
```

## 示例 1：添加 fetch 服务器

### 1.1 启动应用

```bash
npm run dev
```

### 1.2 添加服务器

在应用中输入：

```
/mcp add fetch uvx mcp-server-fetch
```

输出：
```
✓ MCP server 'fetch' added to system config
```

### 1.3 查看服务器状态

```
/mcp list
```

输出：
```
MCP Servers:
  ✓ fetch (5 tools)
```

### 1.4 使用工具

在对话中：

```
用户: 帮我获取 https://example.com 的内容

助手: [自动调用 mcp__fetch__fetch 工具]
好的，我来获取该网页的内容...
[显示网页内容]
```

## 示例 2：配置文件方式

### 2.1 创建系统级配置

创建文件 `~/.cehnzcode/mcp.json`：

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

### 2.2 启动应用

```bash
npm run dev
```

服务器会自动连接，无需手动添加。

### 2.3 验证

```
/mcp list
```

## 示例 3：项目级配置

### 3.1 创建项目级配置

在项目根目录创建 `.cehnzcode/mcp.json`：

```json
{
  "mcpServers": {
    "fetch": {
      "env": {
        "FASTMCP_LOG_LEVEL": "DEBUG"
      },
      "autoApprove": ["fetch", "fetch_html"]
    },
    "project-tool": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "custom-mcp-server"],
      "disabled": false
    }
  }
}
```

### 3.2 配置合并

项目级配置会与系统级配置合并：

- `fetch` 服务器：
  - `env.FASTMCP_LOG_LEVEL` 被覆盖为 `DEBUG`
  - `autoApprove` 合并为 `["fetch", "fetch_html"]`
  - 其他字段保持系统级配置

- `project-tool` 服务器：
  - 仅在此项目中可用

### 3.3 重新加载

```
/mcp reload
```

## 示例 4：自动批准配置

### 4.1 场景

某些工具（如只读工具）可以自动执行，无需每次确认。

### 4.2 配置

```json
{
  "mcpServers": {
    "fetch": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "autoApprove": [
        "fetch",
        "fetch_html"
      ]
    }
  }
}
```

### 4.3 效果

- `mcp__fetch__fetch` 和 `mcp__fetch__fetch_html` 会自动执行
- 其他工具需要用户确认（当前版本临时自动批准）

## 示例 5：禁用服务器

### 5.1 临时禁用

编辑配置文件：

```json
{
  "mcpServers": {
    "fetch": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "disabled": true
    }
  }
}
```

### 5.2 重新加载

```
/mcp reload
```

### 5.3 验证

```
/mcp list
```

输出：
```
MCP Servers:
  (no servers connected)
```

## 示例 6：移除服务器

### 6.1 移除系统级服务器

```
/mcp remove fetch
```

### 6.2 移除项目级服务器

```
/mcp remove project-tool --project
```

### 6.3 验证

```
/mcp list
```

## 示例 7：错误处理

### 7.1 服务器连接失败

如果服务器无法连接：

```
/mcp list
```

输出：
```
MCP Servers:
  ✗ broken-server (0 tools)
    Error: MCP server process startup timeout
```

### 7.2 查看日志

设置环境变量：

```bash
export LOG_LEVEL=debug
npm run dev
```

### 7.3 修复

1. 检查命令是否可用：`uvx --version`
2. 检查配置文件格式
3. 尝试手动运行命令：`uvx mcp-server-fetch`

## 示例 8：多个服务器

### 8.1 配置

```json
{
  "mcpServers": {
    "fetch": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    },
    "filesystem": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["mcp-server-filesystem"]
    },
    "git": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["mcp-server-git"]
    }
  }
}
```

### 8.2 查看所有工具

```
/mcp list
```

输出：
```
MCP Servers:
  ✓ fetch (5 tools)
  ✓ filesystem (8 tools)
  ✓ git (12 tools)
```

### 8.3 工具命名空间

工具会自动添加命名空间前缀：

- `mcp__fetch__fetch`
- `mcp__filesystem__read_file`
- `mcp__git__commit`

避免了不同服务器的工具名冲突。

## 示例 9：环境变量

### 9.1 配置

```json
{
  "mcpServers": {
    "custom": {
      "transport": "stdio",
      "command": "node",
      "args": ["./custom-server.js"],
      "env": {
        "API_KEY": "your-api-key",
        "DEBUG": "true",
        "TIMEOUT": "30000"
      }
    }
  }
}
```

### 9.2 效果

服务器进程会继承这些环境变量。

## 示例 10：编程方式使用

### 10.1 在代码中使用

```typescript
import { getMCPManager } from "./mcp/index.js";

async function example() {
  // 获取 MCP Manager
  const mcpManager = getMCPManager(process.cwd());
  await mcpManager.initialize();

  // 获取所有工具
  const tools = mcpManager.getAllTools();
  console.log("Available tools:", tools.map(t => t.fullName));

  // 调用工具
  const result = await mcpManager.callTool("mcp__fetch__fetch", {
    url: "https://example.com"
  });
  console.log("Result:", result);

  // 检查自动批准
  const isApproved = mcpManager.isAutoApproved("mcp__fetch__fetch");
  console.log("Auto-approved:", isApproved);
}
```

### 10.2 监听事件

```typescript
import { eventBus } from "./events/index.js";

// 工具变化
eventBus.on("mcp:tools:changed", ({ tools }) => {
  console.log("Tools changed:", tools.length);
});

// 服务器连接
eventBus.on("mcp:server:connected", ({ serverName, tools }) => {
  console.log(`Server ${serverName} connected with ${tools.length} tools`);
});

// 服务器错误
eventBus.on("mcp:server:error", ({ serverName, error }) => {
  console.error(`Server ${serverName} error:`, error.message);
});
```

## 常见问题

### Q1: 如何查看可用的 MCP 服务器？

A: 访问 [MCP Servers Registry](https://github.com/modelcontextprotocol/servers) 查看官方服务器列表。

### Q2: 如何创建自定义 MCP 服务器？

A: 参考 [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) 文档。

### Q3: 工具调用失败怎么办？

A: 
1. 检查服务器状态：`/mcp list`
2. 查看日志：设置 `LOG_LEVEL=debug`
3. 验证参数格式是否符合工具的 inputSchema

### Q4: 如何更新 MCP 服务器？

A: 
```bash
# 重新加载会自动使用最新版本（uvx 会检查更新）
/mcp reload
```

### Q5: 配置文件在哪里？

A:
- 系统级：`~/.cehnzcode/mcp.json`
- 项目级：`<project>/.cehnzcode/mcp.json`

## 相关文档

- [MCP 模块 README](./README.md)
- [集成状态](./INTEGRATION_STATUS.md)
- [集成指南](./INTEGRATION_GUIDE.md)
- [实现总结](./IMPLEMENTATION.md)
