import { createChildLogger } from "../../logger/index.js";
import type { MCPTransport } from "../types.js";

// 延迟创建 logger
let logger: ReturnType<typeof createChildLogger> | null = null;
function getLogger() {
  if (!logger) {
    logger = createChildLogger("mcp-sse");
  }
  return logger;
}

/**
 * SSE (Server-Sent Events) 传输层实现
 * 通过 HTTP SSE 与远程 MCP 服务器通信
 * 注意：这是预留实现，当前版本暂不支持
 */
export class SSETransport implements MCPTransport {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    getLogger().warn("SSE transport is not yet implemented");
    throw new Error("SSE transport is not yet implemented");
  }

  async send(message: unknown): Promise<void> {
    throw new Error("SSE transport is not yet implemented");
  }

  async *receive(): AsyncIterable<unknown> {
    throw new Error("SSE transport is not yet implemented");
  }

  async disconnect(): Promise<void> {
    // No-op
  }
}
