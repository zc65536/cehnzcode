import { createChildLogger } from "../logger/index.js";
import type {
  MCPClient,
  MCPTransport,
  MCPTool,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.js";

// 延迟创建 logger
let logger: ReturnType<typeof createChildLogger> | null = null;
function getLogger() {
  if (!logger) {
    logger = createChildLogger("mcp-client");
  }
  return logger;
}

/**
 * MCP 客户端实现
 * 基于 JSON-RPC 2.0 协议与 MCP 服务器通信
 */
export class MCPClientImpl implements MCPClient {
  private transport: MCPTransport;
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private receiveTask: Promise<void> | null = null;
  private serverName: string;

  constructor(transport: MCPTransport, serverName: string) {
    this.transport = transport;
    this.serverName = serverName;
  }

  async connect(): Promise<void> {
    await this.transport.connect();

    // 启动接收消息的任务
    this.receiveTask = this.startReceiving();

    // 发送初始化请求
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "cehnzcode",
        version: "0.1.0",
      },
    });

    getLogger().info({ server: this.serverName }, "MCP client connected");
  }

  async listTools(): Promise<MCPTool[]> {
    const response = (await this.sendRequest("tools/list", {})) as {
      tools: Array<{
        name: string;
        description: string;
        inputSchema: unknown;
      }>;
    };

    // 添加 serverName 字段，但不添加命名空间（由 registry 负责）
    return response.tools.map((tool) => ({
      name: tool.name,
      fullName: tool.name, // 临时值，registry 会覆盖
      description: tool.description,
      inputSchema: tool.inputSchema as MCPTool["inputSchema"],
      serverName: this.serverName,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const response = (await this.sendRequest("tools/call", {
      name,
      arguments: args,
    })) as {
      content: Array<{ type: string; text?: string }>;
    };

    // 提取文本内容
    const textContent = response.content
      .filter((item) => item.type === "text")
      .map((item) => item.text || "")
      .join("\n");

    return textContent;
  }

  async disconnect(): Promise<void> {
    // 取消所有待处理的请求
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error("Client disconnected"));
    }
    this.pendingRequests.clear();

    // 断开传输层
    await this.transport.disconnect();

    // 等待接收任务结束
    if (this.receiveTask) {
      await this.receiveTask.catch(() => {
        // 忽略错误，因为断开连接时可能会有错误
      });
    }

    getLogger().info({ server: this.serverName }, "MCP client disconnected");
  }

  /**
   * 发送 JSON-RPC 请求并等待响应
   */
  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    // 创建 Promise 用于等待响应
    const promise = new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // 设置超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000); // 30 秒超时
    });

    // 发送请求
    await this.transport.send(request);

    return promise;
  }

  /**
   * 启动接收消息的任务
   */
  private async startReceiving(): Promise<void> {
    try {
      for await (const message of this.transport.receive()) {
        this.handleMessage(message);
      }
    } catch (err) {
      getLogger().error(
        { server: this.serverName, error: (err as Error).message },
        "Error receiving messages"
      );
    }
  }

  /**
   * 处理收到的消息
   */
  private handleMessage(message: unknown): void {
    const response = message as JsonRpcResponse;

    if (!response.id) {
      // 通知消息，忽略
      getLogger().debug({ message }, "Received notification");
      return;
    }

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      getLogger().warn({ id: response.id }, "Received response for unknown request");
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(
        new Error(`JSON-RPC error: ${response.error.message} (code: ${response.error.code})`)
      );
    } else {
      pending.resolve(response.result);
    }
  }
}
