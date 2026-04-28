import { StdioTransport } from "./stdio.js";
import { SSETransport } from "./sse.js";
import type { MCPServerConfig, MCPTransport } from "../types.js";

/**
 * 传输层工厂函数
 * 根据配置创建对应的传输层实例
 */
export function createTransport(config: MCPServerConfig): MCPTransport {
  switch (config.transport) {
    case "stdio":
      if (!config.command) {
        throw new Error("stdio transport requires 'command' field");
      }
      return new StdioTransport(config.command, config.args || [], config.env || {});

    case "sse":
      if (!config.url) {
        throw new Error("sse transport requires 'url' field");
      }
      return new SSETransport(config.url);

    default:
      throw new Error(`Unknown transport type: ${(config as MCPServerConfig).transport}`);
  }
}
