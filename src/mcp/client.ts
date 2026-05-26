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
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      // 每个请求对应的超时定时器，在响应到达时清理
      timeout: ReturnType<typeof setTimeout>;
    }
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

    // MCP 协议要求：收到 initialize 响应后必须发送 notifications/initialized 通知
    // 否则部分服务器不会开始处理后续请求
    await this.transport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
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
      isError?: boolean;
    };

    // 提取文本内容
    const textContent = response.content
      .filter((item) => item.type === "text")
      .map((item) => item.text || "")
      .join("\n");

    // 工具报错时抛出异常，让上层感知而非静默返回空字符串
    if (response.isError) {
      throw new Error(textContent || "MCP tool returned an error");
    }

    return textContent;
  }

  async disconnect(): Promise<void> {
    // 取消所有待处理的请求并清理对应的定时器
    for (const [, { reject, timeout }] of this.pendingRequests) {
      clearTimeout(timeout);
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

    const timeoutMs = method === "initialize" ? 120000 : 30000;
    let pendingReject!: (err: Error) => void;

    const promise = new Promise((resolve, reject) => {
      pendingReject = reject;
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timeout });
    });

    // 发送请求：若 send 失败则立即 reject promise 并清理，防止孤立超时触发 unhandled rejection
    try {
      await this.transport.send(request);
    } catch (err) {
      const pending = this.pendingRequests.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(id);
        pendingReject(err as Error);
      }
    }

    return promise;
  }

  /**
   * 启动接收消息的任务
   * 当接收循环结束（服务器关闭或崩溃）时，立即拒绝所有 pending 请求
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
      // 接收出错时立即拒绝所有 pending 请求，避免等待 30s 超时
      for (const [, { reject, timeout }] of this.pendingRequests) {
        clearTimeout(timeout);
        reject(err as Error);
      }
      this.pendingRequests.clear();
      return;
    }

    // 接收循环正常结束（服务器关闭），立即拒绝还在等待的请求
    if (this.pendingRequests.size > 0) {
      const err = new Error(`MCP server '${this.serverName}' connection closed unexpectedly`);
      for (const [, { reject, timeout }] of this.pendingRequests) {
        clearTimeout(timeout);
        reject(err);
      }
      this.pendingRequests.clear();
    }
  }

  /**
   * 处理收到的消息
   */
  private handleMessage(message: unknown): void {
    const response = message as JsonRpcResponse;

    // 通知消息没有 id 字段（不是 null，而是完全缺失）
    // 使用 === undefined/null 而非 !response.id，避免 id=0 被误判为通知
    if (response.id === undefined || response.id === null) {
      getLogger().debug({ message }, "Received notification");
      return;
    }

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      getLogger().warn({ id: response.id }, "Received response for unknown request");
      return;
    }

    // 响应到达时清理超时定时器
    clearTimeout(pending.timeout);
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
