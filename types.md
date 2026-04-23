## 模块接口速查

> 定义在 `src/types.ts`，各模块通过这些接口通信。

---

### AppConfig

```typescript
interface AppConfig {
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
```

**谁和谁**：Config 模块 → 全局所有模块  
**作用**：统一配置对象，由 config 模块加载后注入 Orchestrator，再传递给 ModelClient、ToolContext、ConversationManager 等

---

### Turn

```typescript
interface Turn {
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
```

**谁和谁**：ConversationManager ↔ ModelClient、Orchestrator  
**作用**：对话历史的基本单元，在上下文管理、模型请求、压缩等环节流转

---

### ToolCall / ToolResult

```typescript
interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResult {
  callId: string;
  output: string;
  error?: string;
}
```

**谁和谁**：ModelClient → Orchestrator → ToolExecutor  
**作用**：模型返回工具调用请求，Orchestrator 交给 ToolExecutor 执行后拿回结果，再封装进下一轮 Turn

---

### ToolDefinition

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

interface ToolContext {
  cwd: string;
  config: AppConfig;
  signal: AbortSignal;
}
```

**谁和谁**：ToolRegistry ↔ ModelClient、ToolExecutor  
**作用**：工具的注册格式，内置工具和插件工具都实现此接口，注册到 ToolRegistry 后供模型调用

---

### ModelRequest / ModelResponse

```typescript
interface ModelRequest {
  messages: Turn[];
  tools: ToolDefinition[];
  stream: boolean;
}

interface ModelResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  finishReason: string;
}

interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}
```

**谁和谁**：Orchestrator → ModelClient  
**作用**：Orchestrator 组装请求交给 ModelClient 发送，ModelClient 返回模型响应（含工具调用和 token 用量）

---

### UIAdapter

```typescript
interface UIAdapter {
  init(): Promise<void>;
  promptInput(prompt: string): Promise<string>;
  showAssistantStream(stream: AsyncIterable<string>): Promise<void>;
  showAssistantMessage(content: string): void;
  showToolStatus(name: string, status: "running" | "done" | "error"): void;
  showError(err: Error): void;
  showTokenUsage(usage: { turn: TokenUsage; cumulative: TokenUsage }): void;
  dispose(): void;
}
```

**谁和谁**：UI 模块（TUI/GUI）→ Orchestrator  
**作用**：UI 层抽象，Orchestrator 只依赖此接口与用户交互，具体实现可替换（当前为 TUI）

---

### AppEvents

```typescript
type AppEvents = {
  "model:before": { messages: Turn[] };
  "model:after": { response: ModelResponse };
  "model:error": { error: Error };
  "tool:before": { call: ToolCall };
  "tool:after": { call: ToolCall; result: ToolResult };
  "tool:error": { call: ToolCall; error: Error };
  "context:compress": { removedCount: number; summary: string };
  "turn:added": { turn: Turn };
};
```

**谁和谁**：ModelClient、ToolExecutor、ConversationManager → EventBus → HookRunner → Plugin  
**作用**：全局事件类型定义，各模块在关键节点 emit 事件，插件通过 hooks 订阅响应

---

### CompressionStrategy / CompressionResult

```typescript
interface CompressionStrategy {
  name: string;
  compress(turns: Turn[]): Promise<string>;
}

interface CompressionResult {
  summary: string;
  removedCount: number;
  success: boolean;
  error?: string;
}
```

**谁和谁**：压缩策略实现（summary/truncate）→ ConversationManager  
**作用**：上下文压缩的策略接口，ConversationManager 调用具体策略压缩历史对话

---

### Plugin

```typescript
interface Plugin {
  name: string;
  tools?: ToolDefinition[];
  hooks?: Partial<{ [K in keyof AppEvents]: (data: AppEvents[K]) => void | Promise<void> }>;
}
```

**谁和谁**：插件文件 → PluginLoader → ToolRegistry、HookRunner  
**作用**：插件扩展格式，可携带自定义工具和事件钩子，由 PluginLoader 加载后自动注册

---

### SkillDefinition（预留）

```typescript
interface SkillContext {
  toolExecutor: { run(call: ToolCall): Promise<ToolResult> };
  model: { chat(messages: Turn[], tools: ToolDefinition[]): Promise<ModelResponse> };
  context: { getTurns(): Turn[]; addTurn(turn: Partial<Turn>): void };
  config: AppConfig;
  args: string;
}

interface SkillDefinition {
  name: string;
  description: string;
  execute(ctx: SkillContext): Promise<string>;
}
```

**谁和谁**：预留，Skill 实现 → Orchestrator  
**作用**：高阶技能的注册格式，Skill 可访问工具执行器、模型和上下文，实现复合 AI 能力（尚未接入主流程）

---

### CommandDefinition / CommandContext

> 定义在 `src/commands/types.ts`

```typescript
interface CommandContext {
  ui: UIAdapter;
  config: AppConfig;
  context: ConversationManager;
  exit(): void;
}

interface CommandDefinition {
  name: string;        // 命令名，不含 "/"
  description: string;
  execute(args: string, ctx: CommandContext): Promise<void> | void;
}
```

**谁和谁**：CommandRegistry → Orchestrator  
**作用**：斜杠命令的注册格式，内置命令放在 `commands/builtins/`，由 `loadBuiltinCommands()` 自动扫描注册；Orchestrator 通过 `commandRegistry.execute(input, ctx)` 分发执行，返回 `false` 表示命令不存在
