import { eventBus } from "../events/index.js";
import { createChildLogger } from "../logger/index.js";
import { MCPConfigManager } from "./config.js";
import { MCPRegistry } from "./registry.js";
import type { MCPServer, MCPServerConfig, MCPTool } from "./types.js";

// 延迟创建 logger
let logger: ReturnType<typeof createChildLogger> | null = null;
function getLogger() {
  if (!logger) {
    logger = createChildLogger("mcp-manager");
  }
  return logger;
}

/**
 * MCP 管理器
 * 对外统一接口，协调配置管理和服务器注册表
 */
export class MCPManager {
  private static instance: MCPManager | null = null;
  private registry: MCPRegistry;
  private configManager: MCPConfigManager;
  private initialized = false;

  private constructor(projectRoot?: string) {
    this.registry = new MCPRegistry();
    this.configManager = new MCPConfigManager(projectRoot);
  }

  /**
   * 获取单例实例
   * @param projectRoot 项目根目录（仅首次调用时需要）
   */
  static getInstance(projectRoot?: string): MCPManager {
    if (!MCPManager.instance) {
      MCPManager.instance = new MCPManager(projectRoot);
    }
    return MCPManager.instance;
  }

  /**
   * 初始化 MCP 管理器
   * 加载配置并连接所有未禁用的服务器
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      getLogger().warn("MCP manager already initialized");
      return;
    }

    getLogger().info("Initializing MCP manager");

    try {
      // 1. 加载配置（系统级+项目级合并）
      const config = await this.configManager.loadMergedConfig();

      // 2. 连接所有未禁用的服务器
      const connectPromises = Object.entries(config.mcpServers)
        .filter(([_, serverConfig]) => !serverConfig.disabled)
        .map(([name, serverConfig]) =>
          this.registry.connectServer(name, serverConfig).catch((err) => {
            eventBus.emit("mcp:server:error", { serverName: name, error: err });
          })
        );

      await Promise.allSettled(connectPromises);

      // 3. 发出初始化完成事件
      const tools = this.getAllTools();
      eventBus.emit("mcp:tools:changed", { tools });

      this.initialized = true;
      getLogger().info({ serverCount: Object.keys(config.mcpServers).length }, "MCP manager initialized");
    } catch (err) {
      getLogger().error({ error: (err as Error).message }, "Failed to initialize MCP manager");
      throw err;
    }
  }

  /**
   * 添加一个 MCP 服务器
   * @param name 服务器名称
   * @param config 服务器配置
   * @param level 配置级别：system 或 project
   */
  async addServer(
    name: string,
    config: MCPServerConfig,
    level: "system" | "project"
  ): Promise<void> {
    getLogger().info({ name, level }, "Adding MCP server");

    // 1. 保存配置
    await this.configManager.saveConfig({ mcpServers: { [name]: config } }, level);

    // 2. 连接服务器（如果未禁用）
    if (!config.disabled) {
      try {
        await this.registry.connectServer(name, config);

        // 3. 发出事件
        const tools = this.getAllTools();
        eventBus.emit("mcp:tools:changed", { tools });
        eventBus.emit("mcp:server:connected", {
          serverName: name,
          tools: this.registry.get(name)?.tools || [],
        });
      } catch (err) {
        eventBus.emit("mcp:server:error", { serverName: name, error: err as Error });
        throw err;
      }
    }
  }

  /**
   * 移除一个 MCP 服务器
   * @param name 服务器名称
   * @param level 配置级别：system 或 project
   */
  async removeServer(name: string, level: "system" | "project"): Promise<void> {
    getLogger().info({ name, level }, "Removing MCP server");

    // 1. 断开连接
    await this.registry.disconnectServer(name);

    // 2. 从配置删除
    await this.configManager.removeServer(name, level);

    // 3. 发出事件
    const tools = this.getAllTools();
    eventBus.emit("mcp:tools:changed", { tools });
    eventBus.emit("mcp:server:disconnected", { serverName: name });
  }

  /**
   * 重新加载所有 MCP 服务器
   * 行为：断开所有现有连接 → 重新读取配置文件 → 重新连接所有服务器
   * 注意：重连期间工具不可用，应在 UI 上提示用户
   */
  async reload(): Promise<void> {
    getLogger().info("Reloading MCP servers");

    // 1. 并行断开所有现有连接
    const currentServers = this.registry.getAll();
    await Promise.allSettled(
      currentServers.map((server) => this.registry.disconnectServer(server.name))
    );

    // 2. 重置初始化状态
    this.initialized = false;

    // 3. 重新初始化（读配置 + 连接）
    await this.initialize();

    getLogger().info("MCP servers reloaded");
  }

  /**
   * 获取所有服务器
   */
  getAllServers(): MCPServer[] {
    return this.registry.getAll();
  }

  /**
   * 获取所有工具
   */
  getAllTools(): MCPTool[] {
    return this.registry.getAllTools();
  }

  /**
   * 调用一个 MCP 工具
   * @param toolFullName 带命名空间的工具名（如 mcp__fetch__read_file）
   * @param args 工具参数
   */
  async callTool(toolFullName: string, args: Record<string, unknown>): Promise<string> {
    // 通过反向索引查找服务器
    const server = this.registry.getServerByTool(toolFullName);

    if (!server) {
      throw new Error(`Tool ${toolFullName} not found in any MCP server`);
    }

    if (server.status !== "connected") {
      throw new Error(`MCP server ${server.name} is not connected (status: ${server.status})`);
    }

    // 提取原始工具名（去掉命名空间前缀）
    const prefix = `mcp__${server.name}__`;
    const originalToolName = toolFullName.startsWith(prefix)
      ? toolFullName.slice(prefix.length)
      : toolFullName;

    getLogger().debug({ tool: toolFullName, server: server.name }, "Calling MCP tool");

    return await server.client!.callTool(originalToolName, args);
  }

  /**
   * 检查工具是否在 autoApprove 列表中
   * @param toolFullName 带命名空间的工具名（如 mcp__fetch__read_file）
   */
  isAutoApproved(toolFullName: string): boolean {
    // 必须以 "mcp__" 开头
    if (!toolFullName.startsWith("mcp__")) {
      return false; // 不是 MCP 工具
    }

    // 通过反向索引找到对应的服务器
    const server = this.registry.getServerByTool(toolFullName);
    if (!server) {
      return false;
    }

    // 用前缀方式提取原始工具名
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

// 导出单例获取函数
export function getMCPManager(projectRoot?: string): MCPManager {
  return MCPManager.getInstance(projectRoot);
}
