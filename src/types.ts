// ==================== Config ====================

export interface AppConfig {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  maxTokens: number;
  contextLimit: number;
  compressKeepTurns: number;
  toolTimeout: number;
  logLevel: "debug" | "info" | "warn" | "error";
  sessionDir: string;
  pluginDirs: string[];
}

// ==================== Conversation ====================

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  output: string;
  error?: string;
}

export interface Turn {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  tags: string[];
  tokenCount: number;
  compressed: boolean;
  timestamp: number;
}

// ==================== Tools ====================

export interface JsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolContext {
  cwd: string;
  config: AppConfig;
  signal: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

// ==================== Model ====================

export interface ModelResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  finishReason: string;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// ==================== UI ====================

export interface UIAdapter {
  init(): Promise<void>;
  promptInput(prompt: string): Promise<string>;
  showAssistantStream(stream: AsyncIterable<string>): Promise<void>;
  showAssistantMessage(content: string): void;
  showToolStatus(name: string, status: "running" | "done" | "error"): void;
  showError(err: Error): void;
  showTokenUsage(usage: { turn: TokenUsage; cumulative: TokenUsage }): void;
  dispose(): void;
}

// ==================== Events ====================

export type AppEvents = {
  "model:before": { messages: Turn[] };
  "model:after": { response: ModelResponse };
  "model:error": { error: Error };
  "tool:before": { call: ToolCall };
  "tool:after": { call: ToolCall; result: ToolResult };
  "tool:error": { call: ToolCall; error: Error };
  "context:compress": { removedCount: number; summary: string };
  "turn:added": { turn: Turn };
};

// ==================== Compression ====================

export interface CompressionStrategy {
  name: string;
  compress(turns: Turn[]): Promise<string>;
}

// ==================== Plugins ====================

export interface Plugin {
  name: string;
  tools?: ToolDefinition[];
  hooks?: Partial<{ [K in keyof AppEvents]: (data: AppEvents[K]) => void | Promise<void> }>;
}

// ==================== Skills (预留，见 src/skills/types.ts) ====================

// ==================== 全局可用工具速查 ====================
//
// 以下是各模块对外暴露的函数/单例，可在任意模块中直接 import 使用。
// 详细说明见 types.md「模块接口速查」。
//
// tokens        src/tokens/index.ts
// **类和实例**
// `TokenTracker` — token 追踪器的类，供需要独立实例的场景使用，类对外暴露的成员方法有：
// - `track()` — 记录一次模型调用的用量
// - `totalInContext()` — 获取当前上下文 token 数，**判断是否压缩的主力**
// - `setContextTokens()` — 压缩后由 ConversationManager 更新上下文 token 数
// - `getCumulative()` — 获取累计用量
// - `getLastTurn()` — 获取最近一次调用的用量
// - `getTurnHistory()` — 获取完整的每轮历史
// - `getSummary()` — 获取统计摘要
// - `reset()` — 重置所有统计
// - `tokenTracker` — 全局单例，供 Orchestrator 直接使用，不需要自己实例化

// **核心函数**
// - `estimateTokensFromTurns(turns)` — 从 Turn 数组估算 token 数
// - `estimateTokens(text)` — 直接估算一段文本的 token 数
// - `estimateTokensFromJSON(obj)` — 估算一个 JSON 对象的 token 数

// **工具函数**
// - `createEmptyUsage()` — 创建一个空的 TokenUsage 对象 `{prompt:0, completion:0, total:0}`
// - `mergeUsage(...usages)` — 合并多个 TokenUsage 对象，做加法汇总
// - `formatUsage(usage)` — 把 TokenUsage 格式化成可读字符串，方便日志输出
// - `calculateCost(usage, pricing)` — 根据价格配置计算实际费用
// - `createEstimatedUsage(promptText, completionText)` — 创建一个带 `estimated: true` 标记的 TokenUsage，用于区分估算值和 API 返回值

//
// logger        src/logger/index.ts
//   logger                               pino 日志单例
//
// events        src/events/index.ts
//   eventBus                             类型安全的 EventBus 单例
//
// config        src/config/index.ts
//   loadConfig()                         加载并校验配置，返回 AppConfig
//
// prompts       src/prompts/index.ts
//   buildSystemPrompt(config)            生成系统 prompt 字符串
