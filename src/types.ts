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

export interface ModelRequest {
  messages: Turn[];
  tools: ToolDefinition[];
  stream: boolean;
}

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

export interface CompressionResult {
  summary: string;
  removedCount: number;
  success: boolean;
  error?: string;
}

// ==================== Plugins ====================

export interface Plugin {
  name: string;
  tools?: ToolDefinition[];
  hooks?: Partial<{ [K in keyof AppEvents]: (data: AppEvents[K]) => void | Promise<void> }>;
}

// ==================== Skills (预留) ====================

export interface SkillContext {
  toolExecutor: { run(call: ToolCall): Promise<ToolResult> };
  model: { chat(messages: Turn[], tools: ToolDefinition[]): Promise<ModelResponse> };
  context: { getTurns(): Turn[]; addTurn(turn: Partial<Turn>): void };
  config: AppConfig;
  args: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  execute(ctx: SkillContext): Promise<string>;
}
