# MCP (Model Context Protocol) 模块

## 概述

MCP 模块为 cehnzcode 提供了与外部 MCP 服务器通信的能力，允许动态扩展工具集。

## 架构

```
src/mcp/
├── types.ts          # 类型定义
├── config.ts         # 配置管理
├── registry.ts       # 服务器注册表
├── client.ts         # MCP 客户端（JSON-RPC）
├── index.ts          # MCPManager 主入口
├── installer.ts      # 环境检查和安装指引
└── transports/       # 传输层
    ├── index.ts      # 传输层工厂
    ├── stdio.ts      # stdio 传输
    └── sse.ts        # SSE 传输（预留）
```

## 核心概念

### 1. 命名空间

为避免不同 MCP 服务器的工具名冲突，所有 MCP 工具都会添加命名空间前缀：

```
格式：mcp__{serverName}__{toolName}
示例：mcp__fetch__read_file
```

### 2. 配置合并

支持系统级和项目级配置，项目级配置会覆盖系统级配置（字段级深度合并）：

- **系统级配置**：`~/.cehnzcode/mcp.json`
- **项目级配置**：`<project>/.cehnzcode/mcp.json`

特殊字段处理：
- `env`: 对象合并，项目级覆盖同名键
- `autoApprove`: 数组合并，去重

### 3. 自动批准

通过 `autoApprove` 字段配置哪些工具可以自动执行，无需用户确认：

```json
{
  "mcpServers": {
    "fetch": {
      "autoApprove": ["read_file", "list_files"]
    }
  }
}
```

注意：`autoApprove` 中使用原始工具名（不带命名空间）。

## 使用方法

### 初始化

```typescript
import { getMCPManager } from "./mcp/index.js";

const mcpManager = getMCPManager(process.cwd());
await mcpManager.initialize();
```

### 添加服务器

```typescript
await mcpManager.addServer(
  "fetch",
  {
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    env: {
      FASTMCP_LOG_LEVEL: "ERROR",
    },
    disabled: false,
    autoApprove: ["read_file"],
  },
  "system"
);
```

### 获取所有工具

```typescript
const tools = mcpManager.getAllTools();
console.log(tools);
// [
//   {
//     name: "read_file",
//     fullName: "mcp__fetch__read_file",
//     description: "Read a file from the filesystem",
//     inputSchema: { ... },
//     serverName: "fetch"
//   },
//   ...
// ]
```

### 调用工具

```typescript
const result = await mcpManager.callTool("mcp__fetch__read_file", {
  path: "/path/to/file",
});
console.log(result);
```

### 检查自动批准

```typescript
const isApproved = mcpManager.isAutoApproved("mcp__fetch__read_file");
if (!isApproved) {
  // 需要用户确认
}
```

### 重新加载配置

```typescript
await mcpManager.reload();
```

## 配置文件示例

### 系统级配置 (~/.cehnzcode/mcp.json)

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
      "autoApprove": ["read_file"]
    }
  }
}
```

### 项目级配置 (<project>/.cehnzcode/mcp.json)

```json
{
  "mcpServers": {
    "fetch": {
      "env": {
        "FASTMCP_LOG_LEVEL": "DEBUG"
      },
      "autoApprove": ["write_file"]
    },
    "project-specific": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "custom-mcp-server"],
      "disabled": false
    }
  }
}
```

### 合并后的最终配置

```json
{
  "mcpServers": {
    "fetch": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "env": {
        "FASTMCP_LOG_LEVEL": "DEBUG"
      },
      "disabled": false,
      "autoApprove": ["read_file", "write_file"]
    },
    "project-specific": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "custom-mcp-server"],
      "disabled": false
    }
  }
}
```

## 事件

MCP 模块会发出以下事件：

```typescript
// 工具列表变化
eventBus.on("mcp:tools:changed", ({ tools }) => {
  console.log("MCP tools changed:", tools);
});

// 服务器连接成功
eventBus.on("mcp:server:connected", ({ serverName, tools }) => {
  console.log(`Server ${serverName} connected with ${tools.length} tools`);
});

// 服务器断开连接
eventBus.on("mcp:server:disconnected", ({ serverName }) => {
  console.log(`Server ${serverName} disconnected`);
});

// 服务器错误
eventBus.on("mcp:server:error", ({ serverName, error }) => {
  console.error(`Server ${serverName} error:`, error);
});
```

## 测试

运行配置管理器测试：

```bash
tsx src/mcp/test-config.ts
```

## 环境要求

### stdio 传输

需要安装 `uv`（推荐）或 `npx`：

```bash
# 使用 pip
pip install uv

# 使用 Homebrew (macOS/Linux)
brew install uv

# 使用 curl (Linux/macOS)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 使用 PowerShell (Windows)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

安装 `uv` 后，`uvx` 会自动可用。MCP 服务器会在首次使用时自动下载。

### SSE 传输

当前版本暂不支持，预留接口。

## 故障排查

### 服务器连接失败

1. 检查命令是否可用：`uvx --version` 或 `npx --version`
2. 检查配置文件格式是否正确
3. 查看日志输出：设置 `logLevel: "debug"` 在主配置中

### 工具调用失败

1. 确认服务器状态：`mcpManager.getAllServers()`
2. 检查工具名是否正确（带命名空间）
3. 检查参数格式是否符合 inputSchema

### 配置合并问题

1. 分别查看系统级和项目级配置文件
2. 使用 `loadMergedConfig()` 查看合并结果
3. 注意 `env` 和 `autoApprove` 的合并规则

## 未来扩展

- [ ] SSE 传输支持
- [ ] 工具权限管理
- [ ] MCP 服务器市场
- [ ] 工具使用统计
- [ ] 增量重载（只重连变化的服务器）

## 参考资料

- [MCP 协议规范](https://modelcontextprotocol.io/)
- [JSON-RPC 2.0](https://www.jsonrpc.org/specification)
- [uv 安装指南](https://docs.astral.sh/uv/getting-started/installation/)
