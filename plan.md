# Mini Claude Code — 项目架构与实现计划

## Context

构建一个高扩展性的 mini Claude Code CLI 工具。技术栈：TypeScript/Node.js，异步并行，OpenAI 兼容接口。架构目标：模块高度解耦，事件驱动，可独立开发每个模块。

## 目录结构

```
cehnzcode/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts                      # 入口：解析参数、引导启动
│   ├── types.ts                      # 所有共享接口/类型
│   ├── config/
│   │   ├── index.ts                  # 配置加载器（env + 文件 + CLI 合并）
│   │   └── schema.ts                 # Zod 配置校验
│   ├── events/
│   │   └── index.ts                  # 类型安全的 EventBus 单例
│   ├── hooks/
│   │   └── index.ts                  # HookRunner：before/after 模式
│   ├── model/
│   │   ├── index.ts                  # OpenAI 兼容客户端（流式、tool_use）
│   │   └── retry.ts                  # 重试/退避/限流
│   ├── context/
│   │   ├── index.ts                  # ConversationManager：Turn[] 管理
│   │   ├── compression.ts            # 压缩引擎（按标签、可插拔策略）
│   │   └── strategies/
│   │       ├── summary.ts            # LLM 摘要压缩
│   │       └── truncate.ts           # 截断回退
│   ├── tokens/
│   │   └── index.ts                  # Token 计数 + 用量追踪
│   ├── prompts/
│   │   └── index.ts                  # 系统 prompt 模板
│   ├── tools/
│   │   ├── registry.ts               # 工具注册表（自动扫描）
│   │   ├── executor.ts               # 并行工具执行器
│   │   └── builtins/
│   │       ├── read_file.ts
│   │       ├── write_file.ts
│   │       ├── bash.ts
│   │       ├── glob.ts
│   │       └── grep.ts
│   ├── ui/
│   │   ├── interface.ts              # 抽象 UI 接口
│   │   ├── tui/
│   │   │   └── index.ts              # TUI 实现（Ink 或 readline）
│   │   └── factory.ts                # UI 工厂
│   ├── orchestrator/
│   │   └── index.ts                  # 主循环：输入 → 模型 → 工具 → 输出
│   ├── session/
│   │   └── index.ts                  # 会话保存/恢复
│   ├── plugins/
│   │   └── loader.ts                 # 插件扫描与注册
│   └── logger/
│       └── index.ts                  # 结构化日志
```

## 核心类型定义

```typescript
// 配置
interface AppConfig {
  apiKey: string;
  apiBaseUrl: string;          // OpenAI 兼容端点
  model: string;
  maxTokens: number;
  contextLimit: number;        // 触发压缩的阈值
  compressKeepTurns: number;   // 保留最近几轮（默认3）
  toolTimeout: number;
  logLevel: "debug" | "info" | "warn" | "error";
  pluginDirs: string[];
}

// 对话轮次
interface Turn {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  tags: string[];              // 压缩标签分类
  tokenCount: number;
  compressed: boolean;
  timestamp: number;
}

// 工具定义
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

// UI 抽象
interface UIAdapter {
  init(): Promise<void>;
  promptInput(prompt: string): Promise<string>;
  showAssistantStream(stream: AsyncIterable<string>): Promise<void>;
  showToolStatus(name: string, status: "running" | "done" | "error"): void;
  showError(err: Error): void;
  showTokenUsage(usage: { turn: number; cumulative: number }): void;
  dispose(): void;
}

// 事件类型
type AppEvents = {
  "model:before": { messages: Turn[] };
  "model:after": { response: ModelResponse };
  "tool:before": { call: ToolCall };
  "tool:after": { call: ToolCall; result: ToolResult };
  "context:compress": { removedCount: number; summary: string };
};

// 压缩策略
interface CompressionStrategy {
  name: string;
  compress(turns: Turn[]): Promise<string>;
}

// 插件
interface Plugin {
  name: string;
  tools?: ToolDefinition[];
  hooks?: Partial<{ [K in keyof AppEvents]: (data: AppEvents[K]) => void }>;
}
```

## 模块依赖关系

```
config, events, types ← 基础层（无项目内依赖）
     ↑
tokens, prompts, logger ← 工具层（仅依赖基础层）
     ↑
model, tools/registry, context, hooks ← 功能层
     ↑
tools/executor, session, plugins ← 组合层
     ↑
orchestrator ← 编排层（组合所有模块）
     ↑
index.ts ← 入口
```

## 主循环流程

```
1. 加载配置 → 初始化 EventBus → 初始化日志
2. 初始化 ToolRegistry（自动扫描 builtins/）
3. 加载插件（注册工具 + hooks）
4. 初始化 UI → 若无 API Key 则显示配置界面
5. 尝试恢复会话

主循环:
  input = await ui.promptInput()
  context.addTurn({ role: "user", content: input })
  
  循环（工具调用链）:
    emit("model:before")
    response = await model.chat(context.getTurns(), tools)
    emit("model:after")
    tokens.track(response.usage)
    
    若无 toolCalls → 输出回复，break
    
    // 并行执行所有工具
    results = await Promise.allSettled(toolCalls.map(executor.run))
    context.addTurn({ role: "tool", toolResults: results })
    
    // 检查是否需要压缩
    if tokens.totalInContext() > config.contextLimit:
      await context.compress()  // 保留最近3轮，压缩其余
```

## 扩展性设计

| 场景 | 做法 |
|------|------|
| 加新工具 | 在 `tools/builtins/` 加文件，导出 `ToolDefinition`，自动注册 |
| 加 Skill | 在 `skills/builtins/` 加文件，导出 `SkillDefinition`，自动注册为斜杠命令 |
| 加 Hook | `eventBus.on("tool:before", handler)` 或通过插件 |
| 换 UI | 实现 `UIAdapter` 接口，更新 factory |
| 加压缩策略 | 实现 `CompressionStrategy`，在 context 模块注册 |
| 外部插件 | 在 pluginDirs 放目录，导出 `Plugin` 接口 |

### Skills 系统（预留，后续实现）

Skills = 高级工作流，可组合多个工具调用 + 模型调用。

```
src/skills/
  ├── registry.ts             # SkillRegistry（自动扫描 + 注册为斜杠命令）
  ├── types.ts                # SkillDefinition 接口
  └── builtins/
      └── (future skills here)
```

```typescript
interface SkillDefinition {
  name: string;                // 同时也是斜杠命令名 → /name 触发
  description: string;
  execute(ctx: SkillContext): Promise<string>;
}

interface SkillContext {
  toolExecutor: ToolExecutor;
  model: ModelClient;
  context: ConversationManager;
  config: AppConfig;
  args: string;                // 用户传入的参数
}
```

关键设计：orchestrator 的斜杠命令分发使用 **CommandRegistry**（可注册的 Map），skills 注册时自动注册为命令，不需要 hardcode if/else。

## 实现顺序（建议分阶段）

1. **Phase 1 — 骨架**：types.ts + config + events + logger + 入口
2. **Phase 2 — 模型通信**：model 客户端 + tokens 计数
3. **Phase 3 — 工具系统**：registry + executor + 2-3 个内置工具
4. **Phase 4 — 上下文管理**：ConversationManager + 压缩引擎
5. **Phase 5 — 编排**：orchestrator 主循环，串联所有模块
6. **Phase 6 — UI**：TUI 实现
7. **Phase 7 — 增强**：hooks、session、plugins

## 验证方式

- Phase 1-2 完成后：能通过代码直接调用模型获得回复
- Phase 3 完成后：模型能调用工具并返回结果
- Phase 5 完成后：完整的对话循环可运行（即使 UI 是简单 readline）
- Phase 6 完成后：TUI 可交互使用
- 每阶段独立可测试，无需等待后续模块

## 技术选型

- **运行时**: Node.js 20+
- **包管理**: pnpm
- **配置校验**: zod
- **Token 计数**: tiktoken (或 gpt-tokenizer)
- **HTTP 客户端**: openai SDK（直接用，配置 baseURL）
- **TUI**: ink（React 式 TUI）或先用 readline 做 MVP
- **日志**: pino
- **构建**: tsx（开发）+ tsup（打包）
