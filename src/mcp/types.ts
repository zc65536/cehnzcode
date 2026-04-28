import type { JsonSchema } from "../types.js";

/**
 * MCP 服务器配置项
 * 注意：服务器名称由配置文件中 mcpServers 的 key 决定，不在此结构中存储
 */
export interface MCPServerConfig {
  transport: "stdio" | "sse"; // 传输方式
  command?: string; // stdio: 命令（如 uvx, npx）
  args?: string[]; // stdio: 参数
  url?: string; // sse: 服务器 URL
  env?: Record<string, string>; // 环境变量
  disabled?: boolean; // 是否禁用
  autoApprove?: string[]; // 自动批准的工具列表（原始工具名，如 "read_file"）
}

/**
 * MCP 配置文件结构
 */
export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * MCP 工具定义（从服务器获取后添加命名空间）
 */
export interface MCPTool {
  name: string; // 原始工具名（如 read_file）
  fullName: string; // 带命名空间（如 mcp__fetch__read_file）
  description: string;
  inputSchema: JsonSchema;
  serverName: string; // 来自哪个 MCP 服务器
}

/**
 * MCP 服务器实例
 */
export interface MCPServer {
  name: string;
  config: MCPServerConfig;
  status: "disconnected" | "connecting" | "connected" | "error";
  tools: MCPTool[];
  client: MCPClient | null;
  error?: Error;
}

/**
 * MCP 事件类型
 */
export interface MCPEvents {
  "mcp:tools:changed": { tools: MCPTool[] };
  "mcp:server:connected": { serverName: string; tools: MCPTool[] };
  "mcp:server:disconnected": { serverName: string };
  "mcp:server:error": { serverName: string; error: Error };
}

/**
 * 传输层接口
 */
export interface MCPTransport {
  connect(): Promise<void>;
  send(message: unknown): Promise<void>;
  receive(): AsyncIterable<unknown>;
  disconnect(): Promise<void>;
}

/**
 * MCP 客户端接口
 */
export interface MCPClient {
  connect(): Promise<void>;
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  disconnect(): Promise<void>;
}

/**
 * JSON-RPC 2.0 请求
 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

/**
 * JSON-RPC 2.0 响应
 */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * JSON-RPC 2.0 通知（无需响应）
 */
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}
