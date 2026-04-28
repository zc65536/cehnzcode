import { createChildLogger } from "../logger/index.js";
import { MCPClientImpl } from "./client.js";
import { createTransport } from "./transports/index.js";
import type { MCPServer, MCPServerConfig, MCPTool } from "./types.js";

// 延迟创建 logger
let logger: ReturnType<typeof createChildLogger> | null = null;
function getLogger() {
  if (!logger) {
    logger = createChildLogger("mcp-registry");
  }
  return logger;
}

/**
 * MCP 服务器注册表
 * 维护所有 MCP 服务器实例，管理工具到服务器的反向索引
 */
export class MCPRegistry {
  private servers = new Map<string, MCPServer>();
  private toolToServer = new Map<string, string>(); // fullName -> serverName

  /**
   * 连接一个 MCP 服务器
   * @param name 服务器名称
   * @param config 服务器配置
   */
  async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    // 如果服务器已存在，先断开
    if (this.servers.has(name)) {
      await this.disconnectServer(name);
    }

    // 创建服务器实例
    const server: MCPServer = {
      name,
      config,
      status: "disconnected",
      tools: [],
      client: null,
    };

    this.servers.set(name, server);

    try {
      // 更新状态
      server.status = "connecting";

      // 创建传输层和客户端
      const transport = createTransport(config);
      const client = new MCPClientImpl(transport, name);

      // 连接
      await client.connect();

      // 获取工具列表
      const tools = await client.listTools();

      // 添加命名空间前缀
      const namespacedTools = tools.map((tool) => ({
        ...tool,
        fullName: `mcp__${name}__${tool.name}`,
      }));

      // 更新服务器状态
      server.client = client;
      server.tools = namespacedTools;
      server.status = "connected";

      // 更新反向索引
      for (const tool of namespacedTools) {
        this.toolToServer.set(tool.fullName, name);
      }

      getLogger().info({ server: name, toolCount: tools.length }, "MCP server connected");
    } catch (err) {
      const error = err as Error;
      server.status = "error";
      server.error = error;
      getLogger().error({ server: name, error: error.message }, "Failed to connect MCP server");
      throw error;
    }
  }

  /**
   * 断开一个 MCP 服务器
   * @param name 服务器名称
   */
  async disconnectServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      return;
    }

    // 从反向索引中移除工具
    for (const tool of server.tools) {
      this.toolToServer.delete(tool.fullName);
    }

    // 断开客户端
    if (server.client) {
      try {
        await server.client.disconnect();
      } catch (err) {
        getLogger().error(
          { server: name, error: (err as Error).message },
          "Error disconnecting MCP server"
        );
      }
    }

    // 移除服务器
    this.servers.delete(name);
    getLogger().info({ server: name }, "MCP server disconnected");
  }

  /**
   * 获取指定名称的服务器
   */
  get(name: string): MCPServer | undefined {
    return this.servers.get(name);
  }

  /**
   * 获取所有服务器
   */
  getAll(): MCPServer[] {
    return [...this.servers.values()];
  }

  /**
   * 通过工具全名查找对应的服务器
   * @param toolFullName 带命名空间的工具名（如 mcp__fetch__read_file）
   */
  getServerByTool(toolFullName: string): MCPServer | undefined {
    const serverName = this.toolToServer.get(toolFullName);
    return serverName ? this.servers.get(serverName) : undefined;
  }

  /**
   * 获取所有工具
   */
  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const server of this.servers.values()) {
      if (server.status === "connected") {
        tools.push(...server.tools);
      }
    }
    return tools;
  }
}
