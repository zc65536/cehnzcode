# MCP 模块集成指南

本文档说明如何将 MCP 模块集成到 cehnzcode 的现有系统中。

## 集成步骤

### 1. 集成到 ToolRegistry

修改 `src/tools/registry.ts`，在工具注册表中集成 MCP 工具：

```typescript
import { getMCPManager } from "../mcp/index.js";
import { eventBus } from "../events/index.js";

class ToolRegistry {
  private mcpToolNames = new Set<string>(); // 跟踪 MCP 工具

  async initialize(projectRoot?: string) {
    // 1. 扫描内置工具
    await this.scanBuiltins();
    
    // 2. 初始化 MCP 并同步工具
    const mcpManager = getMCPManager(projectRoot);
    await mcpManager.initialize();
    await this.syncMCPTools();
    
    // 3. 监听 MCP 工具变化
    eventBus.on('mcp:tools:changed', async ({ tools }) => {
      await this.syncMCPTools();
    });
  }

  private async syncMCPTools() {
    const mcpManager = getMCPManager();
    const mcpTools = mcpManager.getAllTools();

    // 移除旧的 MCP 工具
    for (const toolName of this.mcpToolNames) {
      this.remove(toolName);
    }
    this.mcpToolNames.clear();

    // 注册新的 MCP 工具
    for (const mcpTool of mcpTools) {
      this.register({
        name: mcpTool.fullName, // 使用带命名空间的名称
        description: `[MCP:${mcpTool.serverName}] ${mcpTool.description}`,
        parameters: mcpTool.inputSchema,
        execute: async (args, ctx) => {
          return await mcpManager.callTool(mcpTool.fullName, args);
        }
      });
      this.mcpToolNames.add(mcpTool.fullName);
    }
  }
}
```

### 2. 集成到 ToolExecutor

修改 `src/tools/executor.ts`，添加 autoApprove 检查：

```typescript
import { getMCPManager } from "../mcp/index.js";

export class ToolExecutor {
  async run(call: ToolCall): Promise<ToolResult> {
    const tool = toolRegistry.get(call.name);
    if (!tool) {
      return { callId: call.id, output: "", error: `Unknown tool: ${call.name}` };
    }

    // 检查是否需要用户批准
    if (this.needsApproval(call.name)) {
      // TODO: 实现用户确认提示
      // const approved = await ctx.ui.promptApproval(
      //   `Tool ${call.name} wants to execute. Approve?`
      // );
      // if (!approved) {
      //   return { callId: call.id, output: "", error: 'User denied tool execution' };
      // }
      
      // 临时：自动批准所有工具
      logger.warn({ tool: call.name }, "Tool requires approval but auto-approving for now");
    }

    await eventBus.emit("tool:before", { call });

    try {
      const output = await tool.execute(call.arguments, this.ctx);
      const result: ToolResult = { callId: call.id, output };
      await eventBus.emit("tool:after", { call, result });
      logger.debug({ tool: call.name }, "Tool executed successfully");
      return result;
    } catch (err) {
      const error = err as Error;
      await eventBus.emit("tool:error", { call, error });
      logger.error({ tool: call.name, error: error.message }, "Tool execution failed");
      return { callId: call.id, output: "", error: error.message };
    }
  }

  private needsApproval(toolName: string): boolean {
    // 如果是 MCP 工具，检查 autoApprove 列表
    if (toolName.startsWith('mcp__')) {
      const mcpManager = getMCPManager();
      return !mcpManager.isAutoApproved(toolName);
    }
    
    // 内置工具默认自动批准
    return false;
  }
}
```

### 3. 添加 /mcp 命令

创建 `src/commands/builtins/mcp.ts`：

```typescript
import { getMCPManager } from "../../mcp/index.js";
import type { CommandDefinition, CommandContext } from "../types.js";
import type { MCPServerConfig } from "../../mcp/types.js";

export const mcpCommand: CommandDefinition = {
  name: 'mcp',
  description: 'Manage MCP servers (add/list/remove/reload)',
  
  async execute(args: string, ctx: CommandContext) {
    const [subcommand, ...rest] = args.trim().split(/\s+/);
    const mcpManager = getMCPManager();

    switch (subcommand) {
      case 'add':
        await handleAdd(rest, ctx, mcpManager);
        break;
        
      case 'list':
        await handleList(ctx, mcpManager);
        break;
        
      case 'remove':
        await handleRemove(rest, ctx, mcpManager);
        break;
        
      case 'reload':
        await handleReload(ctx, mcpManager);
        break;
        
      default:
        console.log(
          'Usage: /mcp <add|list|remove|reload> [args]\n' +
          'Examples:\n' +
          '  /mcp add fetch uvx mcp-server-fetch\n' +
          '  /mcp add fetch uvx mcp-server-fetch --project\n' +
          '  /mcp list\n' +
          '  /mcp remove fetch\n' +
          '  /mcp reload'
        );
    }
  }
};

async function handleAdd(
  args: string[], 
  ctx: CommandContext, 
  mcpManager: ReturnType<typeof getMCPManager>
) {
  const isProject = args.includes('--project');
  const cleanArgs = args.filter(a => a !== '--project');
  
  if (cleanArgs.length < 2) {
    console.error('Usage: /mcp add <name> <command> [...args] [--project]');
    return;
  }

  const [name, command, ...cmdArgs] = cleanArgs;
  const level = isProject ? 'project' : 'system';

  const config: MCPServerConfig = {
    transport: 'stdio',
    command,
    args: cmdArgs,
    disabled: false
  };

  try {
    await mcpManager.addServer(name, config, level);
    console.log(`✓ MCP server '${name}' added to ${level} config`);
  } catch (error) {
    console.error(`✗ Failed to add MCP server: ${(error as Error).message}`);
  }
}

async function handleList(
  ctx: CommandContext, 
  mcpManager: ReturnType<typeof getMCPManager>
) {
  const servers = mcpManager.getAllServers();
  
  if (servers.length === 0) {
    console.log('No MCP servers configured');
    return;
  }

  console.log('MCP Servers:');
  for (const server of servers) {
    const status = server.status === 'connected' ? '✓' : '✗';
    const toolCount = server.tools.length;
    console.log(`  ${status} ${server.name} (${toolCount} tools)`);
    
    if (server.status === 'error' && server.error) {
      console.log(`    Error: ${server.error.message}`);
    }
  }
}

async function handleRemove(
  args: string[], 
  ctx: CommandContext, 
  mcpManager: ReturnType<typeof getMCPManager>
) {
  const isProject = args.includes('--project');
  const cleanArgs = args.filter(a => a !== '--project');
  
  if (cleanArgs.length !== 1) {
    console.error('Usage: /mcp remove <name> [--project]');
    return;
  }

  const [name] = cleanArgs;
  const level = isProject ? 'project' : 'system';

  try {
    await mcpManager.removeServer(name, level);
    console.log(`✓ MCP server '${name}' removed from ${level} config`);
  } catch (error) {
    console.error(`✗ Failed to remove MCP server: ${(error as Error).message}`);
  }
}

async function handleReload(
  ctx: CommandContext, 
  mcpManager: ReturnType<typeof getMCPManager>
) {
  try {
    console.log('Reloading MCP servers (disconnecting all connections)...');
    await mcpManager.reload();
    console.log('✓ MCP servers reloaded');
  } catch (error) {
    console.error(`✗ Failed to reload MCP servers: ${(error as Error).message}`);
  }
}
```

然后在 `src/commands/index.ts` 中注册命令：

```typescript
import { mcpCommand } from './builtins/mcp.js';

// 在命令注册处添加
commandRegistry.register(mcpCommand);
```

### 4. 在主入口初始化

修改 `src/index.ts` 或主入口文件：

```typescript
import { getMCPManager } from "./mcp/index.js";

async function main() {
  // ... 其他初始化代码
  
  // 初始化 MCP（传入项目根目录）
  const mcpManager = getMCPManager(process.cwd());
  await mcpManager.initialize();
  
  // ... 其他代码
}
```

## 测试集成

### 1. 测试配置管理

```bash
tsx src/mcp/test-config.ts
```

### 2. 测试完整流程

```bash
# 1. 启动应用
npm run dev

# 2. 添加 MCP 服务器
/mcp add fetch uvx mcp-server-fetch

# 3. 列出服务器
/mcp list

# 4. 使用 MCP 工具（在对话中）
用户: 帮我读取 https://example.com 的内容
助手: [应该能看到 mcp__fetch__read_url 工具被调用]

# 5. 移除服务器
/mcp remove fetch

# 6. 重新加载
/mcp reload
```

## 注意事项

### 1. 用户确认提示

当前 `needsApproval()` 检查已实现，但用户确认提示需要根据 UI 层实现。如果 `UIAdapter` 没有 `promptApproval()` 方法，需要添加：

```typescript
interface UIAdapter {
  // ... 其他方法
  promptApproval(message: string): Promise<boolean>;
}
```

### 2. 错误处理

MCP 服务器连接失败不会阻塞应用启动，但会记录错误。可以通过监听 `mcp:server:error` 事件来处理：

```typescript
eventBus.on('mcp:server:error', ({ serverName, error }) => {
  console.error(`MCP server ${serverName} error:`, error.message);
  // 可以在 UI 上显示通知
});
```

### 3. 工具命名冲突

所有 MCP 工具都有 `mcp__` 前缀，不会与内置工具冲突。但如果有多个 MCP 服务器提供同名工具，会通过服务器名称区分：
- `mcp__fetch__read_file`
- `mcp__filesystem__read_file`

### 4. 性能考虑

- MCP 工具调用是异步的，可能比内置工具慢
- 如果有大量 MCP 工具，可以考虑延迟加载或按需连接
- `reload()` 会断开所有连接，在生产环境中应谨慎使用

## 配置示例

### 最小配置

```json
{
  "mcpServers": {
    "fetch": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
}
```

### 完整配置

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
      "autoApprove": ["read_file", "list_files"]
    }
  }
}
```

## 故障排查

### 问题：服务器连接失败

**检查：**
1. 命令是否可用：`uvx --version`
2. 配置文件路径是否正确
3. 查看日志：设置 `logLevel: "debug"`

**解决：**
```bash
# 安装 uv
pip install uv

# 或使用其他方式（见 README.md）
```

### 问题：工具调用失败

**检查：**
1. 服务器状态：`/mcp list`
2. 工具名是否正确（带命名空间）
3. 参数格式是否符合 schema

**解决：**
```typescript
// 查看工具定义
const tools = mcpManager.getAllTools();
console.log(tools.find(t => t.fullName === 'mcp__fetch__read_file'));
```

### 问题：配置不生效

**检查：**
1. 配置文件位置：
   - 系统级：`~/.cehnzcode/mcp.json`
   - 项目级：`<project>/.cehnzcode/mcp.json`
2. JSON 格式是否正确
3. 是否需要 reload

**解决：**
```bash
# 重新加载配置
/mcp reload
```

## 下一步

1. 实现用户确认提示（如果需要）
2. 添加更多 MCP 服务器
3. 编写集成测试
4. 完善错误处理
5. 优化性能（如增量重载）

## 参考

- [MCP 模块 README](./README.md)
- [实现总结](./IMPLEMENTATION.md)
- [设计方案](./plan.md)
