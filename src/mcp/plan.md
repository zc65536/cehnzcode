# MCP (Model Context Protocol) 实现方案

## 概述

为 cehnzcode 添加 MCP 支持，允许用户通过配置文件和命令行添加外部 MCP 服务器，动态扩展工具能力。

## 目录结构

```
src/mcp/
├── plan.md                   # 本文档
├── types.ts                  # MCP 相关类型定义
├── config.ts                 # 配置加载/保存/合并
├── registry.ts               # MCP 服务器注册表
├── client.ts                 # MCP 客户端（JSON-RPC 通信）
├── index.ts                  # MCPManager 主入口
├── installer.ts              # 服务器安装/检查逻辑
└── transports/               # 传输层（模块化）
    ├── index.ts              # 传输层工厂
    ├── stdio.ts              # stdio 传输（uvx/npx）
    └── sse.ts                # SSE 传输（HTTP，预留）
```

## 核心类型定义

```typescript
// src/mcp/types.ts

/**
 * MCP 服务器配置项
 * 注意：服务器名称由配置文件中 mcpServers 的 key 决定，不在此结构中存储
 */
interface MCPServerConfig {
  transport: 'stdio' | 'sse';      // 传输方式
  command?: string;                // stdio: 命令（如 uvx, npx）
  args?: string[];                 // stdio: 参数
  url?: string;                    // sse: 服务器 URL
  env?: Record<string, string>;    // 环境变量
  disabled?: boolean;              // 是否禁用
  autoApprove?: string[];          // 自动批准的工具列表（原始工具名，如 "read_file"）
}

/**
 * MCP 配置文件结构
 */
interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * MCP 工具定义（从服务器获取后添加命名空间）
 */
interface MCPTool {
  name: string;                    // 原始工具名（如 read_file）
  fullName: string;                // 带命名空间（如 mcp__fetch__read_file）
  description: string;
  inputSchema: JsonSchema;
  serverName: string;              // 来自哪个 MCP 服务器
}

/**
 * MCP 服务器实例
 */
interface MCPServer {
  name: string;
  config: MCPServerConfig;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  tools: MCPTool[];
  client: MCPClient | null;
  error?: Error;
}

/**
 * MCP 事件类型
 */
type MCPEvents = {
  'mcp:tools:changed': { tools: MCPTool[] };
  'mcp:server:connected': { serverName: string; tools: MCPTool[] };
  'mcp:server:disconnected': { serverName: string };
  'mcp:server:error': { serverName: string; error: Error };
};

/**
 * 传输层接口
 */
interface MCPTransport {
  connect(): Promise<void>;
  send(message: any): Promise<void>;
  receive(): AsyncIterable<any>;
  disconnect(): Promise<void>;
}
```

## 模块职责

### 1. config.ts - 配置管理

**职责**：
- 读取/写入系统级和项目级配置文件
- 实现配置合并策略（字段级深度合并）
- 提供配置增删改查接口

**配置文件位置**：
- 系统级：`~/.cehnzcode/mcp.json`
- 项目级：`<project>/.cehnzcode/mcp.json`

**合并规则**：
1. 系统级定义的服务器作为基础
2. 项目级可以覆盖同名服务器的部分字段（深度合并）
3. 项目级可以新增项目专属服务器
4. 特殊字段处理：
   - `env`: 合并对象，项目级覆盖同名键
   - `autoApprove`: 合并数组，去重

**接口**：
```typescript
class MCPConfigManager {
  async loadMergedConfig(): Promise<MCPConfig>
  async saveConfig(config: Partial<MCPConfig>, level: 'system' | 'project'): Promise<void>
  async removeServer(name: string, level: 'system' | 'project'): Promise<void>
  private mergeServerConfig(base: MCPServerConfig, override: MCPServerConfig): MCPServerConfig
}
```

### 2. registry.ts - 服务器注册表

**职责**：
- 维护所有 MCP 服务器实例
- 管理工具到服务器的反向索引（解决命名冲突）
- 提供服务器生命周期管理

**关键设计**：
- 工具命名空间：`mcp__{serverName}__{toolName}`
- 反向索引：`Map<fullName, serverName>` 用于快速路由

**接口**：
```typescript
class MCPRegistry {
  private servers: Map<string, MCPServer>
  private toolToServer: Map<string, string>  // fullName -> serverName

  async connectServer(name: string, config: MCPServerConfig): Promise<void>
  async disconnectServer(name: string): Promise<void>
  get(name: string): MCPServer | undefined
  getAll(): MCPServer[]
  getServerByTool(toolFullName: string): MCPServer | undefined
  getAllTools(): MCPTool[]
}
```

### 3. client.ts - MCP 客户端

**职责**：
- 实现 MCP 协议（基于 JSON-RPC 2.0）
- 通过传输层与 MCP 服务器通信
- 提供工具列表获取和工具调用接口

**接口**：
```typescript
class MCPClient {
  constructor(transport: MCPTransport)
  
  async connect(): Promise<void>
  async listTools(): Promise<MCPTool[]>
  async callTool(name: string, args: Record<string, unknown>): Promise<string>
  async disconnect(): Promise<void>
}
```

### 4. transports/ - 传输层

**职责**：
- 抽象不同的通信方式
- stdio: 通过子进程 stdin/stdout
- sse: 通过 HTTP Server-Sent Events（预留）

**接口**：
```typescript
// transports/index.ts
function createTransport(config: MCPServerConfig): MCPTransport

// transports/stdio.ts
class StdioTransport implements MCPTransport {
  constructor(command: string, args: string[], env?: Record<string, string>)
  // ... 实现接口
}

// transports/sse.ts (预留)
class SSETransport implements MCPTransport {
  constructor(url: string)
  // ... 实现接口
}
```

### 5. installer.ts - 安装器

**职责**：
- 检查运行环境（uvx/npx 是否可用）
- 提供安装指引（uvx 会自动下载，无需手动安装）

**接口**：
```typescript
class MCPInstaller {
  async checkEnvironment(transport: 'stdio' | 'sse'): Promise<boolean>
  async getInstallInstructions(command: string): Promise<string>
}
```

### 6. index.ts - MCPManager 主入口

**职责**：
- 对外统一接口
- 协调各模块工作
- 发出事件通知工具变化

**接口**：
```typescript
class MCPManager {
  private static instance: MCPManager
  private registry: MCPRegistry
  private configManager: MCPConfigManager
  private eventBus: EventBus

  static getInstance(): MCPManager
  
  async initialize(): Promise<void>
  async addServer(name: string, config: MCPServerConfig, level: 'system' | 'project'): Promise<void>
  async removeServer(name: string, level: 'system' | 'project'): Promise<void>
  async reload(): Promise<void>
  
  getAllServers(): MCPServer[]
  getAllTools(): MCPTool[]
  async callTool(toolFullName: string, args: any): Promise<string>
  isAutoApproved(toolFullName: string): boolean
}
```

**实现示例**：
```typescript
class MCPManager {
  private static instance: MCPManager;
  private registry: MCPRegistry;
  private configManager: MCPConfigManager;
  private eventBus: EventBus;

  static getInstance(): MCPManager {
    if (!MCPManager.instance) {
      MCPManager.instance = new MCPManager();
    }
    return MCPManager.instance;
  }

  async initialize(): Promise<void> {
    // 1. 加载配置（系统级+项目级合并）
    const config = await this.configManager.loadMergedConfig();
    
    // 2. 连接所有未禁用的服务器
    const connectPromises = Object.entries(config.mcpServers)
      .filter(([_, serverConfig]) => !serverConfig.disabled)
      .map(([name, serverConfig]) => 
        this.registry.connectServer(name, serverConfig).catch(err => {
          this.eventBus.emit('mcp:server:error', { serverName: name, error: err });
        })
      );
    
    await Promise.allSettled(connectPromises);
    
    // 3. 发出初始化完成事件
    const tools = this.getAllTools();
    this.eventBus.emit('mcp:tools:changed', { tools });
  }

  async addServer(name: string, config: MCPServerConfig, level: 'system' | 'project'): Promise<void> {
    // 1. 保存配置
    await this.configManager.saveConfig({ mcpServers: { [name]: config } }, level);
    
    // 2. 连接服务器
    await this.registry.connectServer(name, config);
    
    // 3. 发出事件
    const tools = this.getAllTools();
    this.eventBus.emit('mcp:tools:changed', { tools });
    this.eventBus.emit('mcp:server:connected', { 
      serverName: name, 
      tools: this.registry.get(name)?.tools || [] 
    });
  }

  async removeServer(name: string, level: 'system' | 'project'): Promise<void> {
    // 1. 断开连接
    await this.registry.disconnectServer(name);
    
    // 2. 从配置删除
    await this.configManager.removeServer(name, level);
    
    // 3. 发出事件
    const tools = this.getAllTools();
    this.eventBus.emit('mcp:tools:changed', { tools });
    this.eventBus.emit('mcp:server:disconnected', { serverName: name });
  }

  /**
   * 重新加载所有 MCP 服务器
   * 行为：断开所有现有连接 → 重新读取配置文件 → 重新连接所有服务器
   * 注意：重连期间工具不可用，应在 UI 上提示用户
   */
  async reload(): Promise<void> {
    // 1. 并行断开所有现有连接（与 initialize 里并行连接保持一致）
    const currentServers = this.registry.getAll();
    await Promise.allSettled(
      currentServers.map(server => this.registry.disconnectServer(server.name))
    );
    
    // 2. 重新初始化（读配置 + 连接）
    await this.initialize();
    
    // 3. 发出事件
    const tools = this.getAllTools();
    this.eventBus.emit('mcp:tools:changed', { tools });
  }

  getAllServers(): MCPServer[] {
    return this.registry.getAll();
  }

  getAllTools(): MCPTool[] {
    return this.registry.getAllTools();
  }

  async callTool(toolFullName: string, args: any): Promise<string> {
    // 直接通过反向索引查找
    const server = this.registry.getServerByTool(toolFullName);
    
    if (!server) {
      throw new Error(`Tool ${toolFullName} not found in any MCP server`);
    }

    if (server.status !== 'connected') {
      throw new Error(`MCP server ${server.name} is not connected`);
    }

    // 提取原始工具名（去掉命名空间前缀）
    // 用 startsWith + slice 而非 replace，避免 serverName 含 "__" 时误替换中间段
    const prefix = `mcp__${server.name}__`;
    const originalToolName = toolFullName.startsWith(prefix)
      ? toolFullName.slice(prefix.length)
      : toolFullName;
    
    return await server.client!.callTool(originalToolName, args);
  }

  /**
   * 检查工具是否在 autoApprove 列表中
   * @param toolFullName 带命名空间的工具名（如 mcp__fetch__read_file）
   */
  isAutoApproved(toolFullName: string): boolean {
    // 必须以 "mcp__" 开头
    if (!toolFullName.startsWith('mcp__')) {
      return false;  // 不是 MCP 工具
    }

    // 通过反向索引找到对应的服务器（已在 registry 中维护）
    const server = this.registry.getServerByTool(toolFullName);
    if (!server) {
      return false;
    }

    // 用前缀方式提取原始工具名，避免 serverName 含 "__" 时 split 出错
    // 例如：serverName = "my__server"，prefix = "mcp__my__server__"
    const prefix = `mcp__${server.name}__`;
    const originalToolName = toolFullName.startsWith(prefix)
      ? toolFullName.slice(prefix.length)
      : null;

    if (!originalToolName) {
      return false;
    }

    return server.config.autoApprove?.includes(originalToolName) ?? false;
  }
}
```

## 与现有系统集成

### 1. 集成到 tools/registry.ts

```typescript
class ToolRegistry {
  private mcpToolNames = new Set<string>();  // 跟踪 MCP 工具

  async initialize() {
    // 1. 扫描内置工具
    await this.scanBuiltins();
    
    // 2. 初始化 MCP 并同步工具
    const mcpManager = MCPManager.getInstance();
    await mcpManager.initialize();
    await this.syncMCPTools();
    
    // 3. 监听 MCP 工具变化
    eventBus.on('mcp:tools:changed', async ({ tools }) => {
      await this.syncMCPTools();
    });
  }

  private async syncMCPTools() {
    const mcpManager = MCPManager.getInstance();
    const mcpTools = mcpManager.getAllTools();

    // 移除旧的 MCP 工具
    for (const toolName of this.mcpToolNames) {
      this.unregister(toolName);
    }
    this.mcpToolNames.clear();

    // 注册新的 MCP 工具
    for (const mcpTool of mcpTools) {
      this.register({
        name: mcpTool.fullName,  // 使用带命名空间的名称
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

### 2. 集成到 tools/executor.ts - autoApprove 逻辑

```typescript
class ToolExecutor {
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.registry.get(call.name);
    
    if (!tool) {
      return { success: false, error: `Tool ${call.name} not found` };
    }

    // 检查是否需要用户批准
    if (this.needsApproval(call.name)) {
      const approved = await ctx.ui.promptApproval(
        `Tool ${call.name} wants to execute with args: ${JSON.stringify(call.args)}. Approve?`
      );
      if (!approved) {
        return { success: false, error: 'User denied tool execution' };
      }
    }

    // 执行工具
    try {
      const result = await tool.execute(call.args, ctx);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  private needsApproval(toolName: string): boolean {
    // 如果是 MCP 工具，检查 autoApprove 列表
    if (toolName.startsWith('mcp__')) {
      const mcpManager = MCPManager.getInstance();
      return !mcpManager.isAutoApproved(toolName);
    }
    
    // 内置工具默认自动批准（可根据需要调整）
    return false;
  }
}
```

### 3. 添加 /mcp 命令

```typescript
// src/commands/builtins/mcp.ts

export const mcpCommand: CommandDefinition = {
  name: 'mcp',
  description: 'Manage MCP servers (add/list/remove/reload)',
  
  async execute(args: string, ctx: CommandContext) {
    const [subcommand, ...rest] = args.trim().split(/\s+/);
    const mcpManager = MCPManager.getInstance();

    switch (subcommand) {
      case 'add':
        // /mcp add fetch uvx mcp-server-fetch
        // /mcp add fetch uvx mcp-server-fetch --project
        await handleAdd(rest, ctx, mcpManager);
        break;
        
      case 'list':
        // /mcp list
        await handleList(ctx, mcpManager);
        break;
        
      case 'remove':
        // /mcp remove fetch
        // /mcp remove fetch --project
        await handleRemove(rest, ctx, mcpManager);
        break;
        
      case 'reload':
        // /mcp reload
        await handleReload(ctx, mcpManager);
        break;
        
      default:
        ctx.ui.showError(new Error(
          'Usage: /mcp <add|list|remove|reload> [args]\n' +
          'Examples:\n' +
          '  /mcp add fetch uvx mcp-server-fetch\n' +
          '  /mcp add fetch uvx mcp-server-fetch --project\n' +
          '  /mcp list\n' +
          '  /mcp remove fetch\n' +
          '  /mcp reload'
        ));
    }
  }
};

async function handleAdd(
  args: string[], 
  ctx: CommandContext, 
  mcpManager: MCPManager
) {
  // 解析参数：name command ...args [--project]
  const isProject = args.includes('--project');
  const cleanArgs = args.filter(a => a !== '--project');
  
  if (cleanArgs.length < 2) {
    ctx.ui.showError(new Error('Usage: /mcp add <name> <command> [...args] [--project]'));
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
    ctx.ui.showMessage(`✓ MCP server '${name}' added to ${level} config`);
  } catch (error) {
    ctx.ui.showError(error);
  }
}

async function handleList(ctx: CommandContext, mcpManager: MCPManager) {
  const servers = mcpManager.getAllServers();
  
  if (servers.length === 0) {
    ctx.ui.showMessage('No MCP servers configured');
    return;
  }

  let output = 'MCP Servers:\n';
  for (const server of servers) {
    const status = server.status === 'connected' ? '✓' : '✗';
    const toolCount = server.tools.length;
    output += `  ${status} ${server.name} (${toolCount} tools)\n`;
  }
  
  ctx.ui.showMessage(output);
}

async function handleRemove(
  args: string[], 
  ctx: CommandContext, 
  mcpManager: MCPManager
) {
  const isProject = args.includes('--project');
  const cleanArgs = args.filter(a => a !== '--project');
  
  if (cleanArgs.length !== 1) {
    ctx.ui.showError(new Error('Usage: /mcp remove <name> [--project]'));
    return;
  }

  const [name] = cleanArgs;
  const level = isProject ? 'project' : 'system';

  try {
    await mcpManager.removeServer(name, level);
    ctx.ui.showMessage(`✓ MCP server '${name}' removed from ${level} config`);
  } catch (error) {
    ctx.ui.showError(error);
  }
}

async function handleReload(ctx: CommandContext, mcpManager: MCPManager) {
  try {
    ctx.ui.showMessage('Reloading MCP servers (disconnecting all connections)...');
    await mcpManager.reload();
    ctx.ui.showMessage('✓ MCP servers reloaded');
  } catch (error) {
    ctx.ui.showError(error);
  }
}
```

## 实现顺序

### Phase 1: 基础架构（1-2天）
- [ ] `types.ts` - 定义所有类型
- [ ] `config.ts` - 配置加载/保存/合并
- [ ] 测试配置合并逻辑

### Phase 2: 传输层（1-2天）
- [ ] `transports/index.ts` - 工厂函数
- [ ] `transports/stdio.ts` - stdio 传输实现
- [ ] 测试子进程通信

### Phase 3: MCP 客户端（2-3天）
- [ ] `client.ts` - JSON-RPC 协议实现
- [ ] 测试与真实 MCP 服务器通信
- [ ] 错误处理和重连逻辑

### Phase 4: 注册表和管理器（1-2天）
- [ ] `registry.ts` - 服务器注册表
- [ ] `index.ts` - MCPManager
- [ ] 测试命名空间和反向索引

### Phase 5: 系统集成（2-3天）
- [ ] 修改 `tools/registry.ts` - 集成 MCP 工具
- [ ] 修改 `tools/executor.ts` - autoApprove 逻辑
- [ ] 事件驱动的工具同步

### Phase 6: 命令行接口（1天）
- [ ] `commands/builtins/mcp.ts` - /mcp 命令
- [ ] 测试所有子命令

### Phase 7: 安装器和文档（1天）
- [ ] `installer.ts` - 环境检查
- [ ] 用户文档和示例配置

### Phase 8: SSE 传输（可选，1-2天）
- [ ] `transports/sse.ts` - HTTP SSE 实现

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
        "FASTMCP_LOG_LEVEL": "DEBUG"  // 项目级覆盖
      },
      "disabled": false,
      "autoApprove": ["read_file", "write_file"]  // 合并数组
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

## 使用示例

### 添加 MCP 服务器
```bash
# 添加到系统级配置
/mcp add fetch uvx mcp-server-fetch

# 添加到项目级配置
/mcp add myserver npx -y my-mcp-server --project
```

### 列出所有服务器
```bash
/mcp list
# 输出：
# MCP Servers:
#   ✓ fetch (5 tools)
#   ✓ myserver (3 tools)
```

### 移除服务器
```bash
/mcp remove fetch
/mcp remove myserver --project
```

### 重新加载配置
```bash
/mcp reload
# 注意：会断开所有现有连接并重新连接，期间工具不可用
```

### 使用 MCP 工具
```
用户: 帮我读取 https://example.com 的内容
助手: [调用 mcp__fetch__read_url 工具]
```

## 关键设计决策

### 1. 命名空间前缀
- **格式**: `mcp__{serverName}__{toolName}`
- **原因**: 避免不同服务器的同名工具冲突
- **示例**: `mcp__fetch__read_file`

### 2. 服务器名称存储
- **配置文件**: 服务器名称作为 `mcpServers` 对象的 key
- **MCPServerConfig**: 不包含 `name` 字段，避免冗余
- **使用时**: 从 Map 的 key 或 MCPServer.name 获取
- **优势**: 单一数据源，避免不一致

### 3. 配置合并策略
- **字段级深度合并**，而非整个服务器覆盖
- **特殊处理**: env 对象合并，autoApprove 数组合并
- **优势**: 项目可以只覆盖需要的字段，保留系统级其他配置

### 4. 反向索引
- **Map<toolFullName, serverName>** 用于快速路由
- **避免**: 每次调用工具时遍历所有服务器
- **性能**: O(1) 查找

### 5. 事件驱动同步
- **MCP 工具变化时发出事件**
- **ToolRegistry 监听事件自动同步**
- **优势**: 解耦，无需手动管理同步逻辑

### 6. reload 行为
- **全量重连**: 断开所有连接 → 重新读配置 → 重新连接
- **非增量更新**: 实现简单，行为明确
- **用户提示**: 在 UI 上提示重连期间工具不可用
- **未来优化**: 可改为增量更新（对比差异，只重连变化的服务器）

### 7. autoApprove 匹配逻辑
- **配置存储**: 原始工具名（如 `"read_file"`）
- **运行时**: 收到带命名空间的 fullName（如 `"mcp__fetch__read_file"`）
- **匹配方式**: 通过反向索引找到服务器后，用 `prefix = "mcp__{serverName}__"` + `slice` 提取原始工具名；避免 serverName 含 `__` 时 `split` 或 `replace` 产生错误结果（如 serverName 为 `my__server` 时，split 会产生 4 段导致 autoApprove 静默失效）
- **实现位置**: 在 executor 层统一处理，可扩展到所有工具类型

## 错误处理

### 服务器连接失败
- 不阻塞其他服务器初始化
- 记录错误状态和错误信息
- 发出 `mcp:server:error` 事件

### 工具调用失败
- 返回错误信息给模型
- 模型可以根据错误信息重试或调整策略

### 配置文件损坏
- 使用 zod 校验配置
- 提供详细的错误信息
- 回退到空配置

## 测试策略

### 单元测试
- 配置合并逻辑
- 命名空间生成
- 反向索引查找

### 集成测试
- 与真实 MCP 服务器通信
- 工具调用端到端流程
- 配置文件读写

### 手动测试
- 添加/移除服务器
- 工具批准流程
- 错误场景处理

## 未来扩展

### 1. SSE 传输支持
- 实现 `transports/sse.ts`
- 支持远程 MCP 服务器

### 2. 工具权限管理
- 细粒度的权限控制
- 工具调用审计日志

### 3. MCP 服务器市场
- 内置常用 MCP 服务器列表
- 一键安装推荐服务器

### 4. 工具使用统计
- 记录工具调用频率
- 优化工具推荐

## 参考资料

- [MCP 协议规范](https://modelcontextprotocol.io/)
- [JSON-RPC 2.0](https://www.jsonrpc.org/specification)
- [Claude Desktop MCP 配置](https://docs.anthropic.com/claude/docs/mcp)
