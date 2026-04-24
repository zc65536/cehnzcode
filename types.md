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

### TokenTracker（`src/tokens/index.ts`）

**类和实例**
`TokenTracker` — token 追踪器的类，供需要独立实例的场景使用，类对外暴露的成员方法有：
- `track()` — 记录一次模型调用的用量
- `totalInContext()` — 获取当前上下文 token 数，**判断是否压缩的主力**
- `setContextTokens()` — 压缩后由 ConversationManager 更新上下文 token 数
- `getCumulative()` — 获取累计用量
- `getLastTurn()` — 获取最近一次调用的用量
- `getTurnHistory()` — 获取完整的每轮历史
- `getSummary()` — 获取统计摘要
- `reset()` — 重置所有统计
- `tokenTracker` — 全局单例，供 Orchestrator 直接使用，不需要自己实例化

**核心函数**
- `estimateTokensFromTurns(turns)` — 从 Turn 数组估算 token 数
- `estimateTokens(text)` — 直接估算一段文本的 token 数
- `estimateTokensFromJSON(obj)` — 估算一个 JSON 对象的 token 数

**工具函数**
- `createEmptyUsage()` — 创建一个空的 TokenUsage 对象 `{prompt:0, completion:0, total:0}`
- `mergeUsage(...usages)` — 合并多个 TokenUsage 对象，做加法汇总
- `formatUsage(usage)` — 把 TokenUsage 格式化成可读字符串，方便日志输出
- `calculateCost(usage, pricing)` — 根据价格配置计算实际费用
- `createEstimatedUsage(promptText, completionText)` — 创建一个带 `estimated: true` 标记的 TokenUsage，用于区分估算值和 API 返回值


**谁和谁**：Orchestrator → TokenTracker；ConversationManager → `countTurnsTokens`  
**作用**：token 计数（基于 gpt-tokenizer，按模型动态选择 BPE 编码，encoder 懒加载并缓存）+ 用量追踪。Orchestrator 在每次模型响应后调用 `track()`，ConversationManager 用 `countTurnsTokens()` 判断是否触发压缩，压缩完成后调用 `setContextTokens()` 更新

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
