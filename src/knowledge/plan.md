# Knowledge System — 错题本系统

## 目标

维护两个错题本，记录开发过程中遇到的错误和解决方案：

1. **系统级错题本**：与用户绑定，跨项目共享，记录通用错误
2. **项目级错题本**：与项目绑定，记录本项目特有的错误

当工具执行失败时，自动将相关错题本内容注入上下文，辅助模型快速定位解决方案；
解决后由模型判断是否值得记录，通过工具调用写入错题本，形成闭环。

---

## 开关设计

错题本功能支持两个层面的开关：

### 配置层（持久化）

`AppConfig` 新增字段：

```typescript
knowledgeEnabled: boolean  // 默认 true
```

支持通过 `.env` 关闭：

```
KNOWLEDGE_ENABLED=false
```

### 运行时层（临时切换）

通过 `/knowledge on|off` 命令在当前 session 内即时生效，不修改配置文件。

所有 hook handler 入口统一检查开关：

```typescript
if (!config.knowledgeEnabled) return data; // 直接透传，不做任何处理
```

---

## 存储结构

### 系统级错题本

位置：`~/.cehnzcode/knowledge/errors.json`

### 项目级错题本

位置：`<cwd>/.cehnzcode/knowledge/errors.json`

项目以运行时 `process.cwd()` 标识。

### 文件格式

```json
{
  "version": "1.0",
  "errors": [
    {
      "id": "err_001",
      "timestamp": 1715270400000,
      "scope": "project",
      "error": "Cannot find module 'xxx' or its corresponding type declarations",
      "background": "尝试导入一个新安装的 npm 包时报错",
      "solution": "需要安装类型定义：pnpm add -D @types/xxx",
      "outcome": "recorded"
    }
  ]
}
```

---

## 类型定义

```typescript
// src/knowledge/types.ts

/** 错误记录的作用域 */
type KnowledgeScope = "system" | "project";

/** 工具调用结果类型 */
type KnowledgeOutcome =
  | "recorded"    // 值得记录，已写入错题本
  | "skipped"     // 已在错题本中 或 不值得记录，跳过
  | "unsolvable"; // 未能解决，记录错误和尝试过的方法

/** 一条错题记录 */
interface KnowledgeRecord {
  id: string;
  timestamp: number;
  scope: KnowledgeScope;
  error: string;       // 错误内容
  background: string;  // 发生时的背景
  solution: string;    // 解决方法（unsolvable 时填写尝试过的方法）
  outcome: KnowledgeOutcome;
}

/** record_knowledge 工具的入参 */
interface RecordKnowledgeArgs {
  scope: KnowledgeScope;
  error: string;
  background: string;
  solution: string;
  outcome: KnowledgeOutcome;
}

/** KnowledgeManager 对外接口 */
interface IKnowledgeManager {
  /** 写入一条记录（outcome 为 skipped 时不落盘，仅用于关闭 flag） */
  record(args: RecordKnowledgeArgs): Promise<KnowledgeRecord | null>;

  /** 读取全部记录（合并系统级和项目级） */
  getAll(): Promise<KnowledgeRecord[]>;

  /** 关键词搜索（用于大数据集场景） */
  search(query: string, limit?: number): Promise<KnowledgeRecord[]>;

  /** 是否启用 */
  isEnabled(): boolean;

  /** 运行时切换开关 */
  setEnabled(enabled: boolean): void;

  /** 重置待处理注入状态（供 /knowledge clear 命令使用） */
  resetPending(): void;
}
```

---

## 工具设计

### `record_knowledge`

模型调用此工具关闭"错误处理"闭环，无论结果如何都必须调用。

```typescript
// src/tools/builtins/knowledge.ts
// 直接引用单例，不通过 ToolContext 传递，避免污染公共接口
import { knowledgeManager } from "../../knowledge/index.js";

export const recordKnowledgeTool: ToolDefinition = {
  name: "record_knowledge",
  description: "记录错误处理结果到错题本，关闭当前错误处理流程。无论错误是否解决，处理完毕后必须调用此工具。",
  parameters: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["system", "project"],
        description: "system：通用错误，跨项目共享；project：本项目特有错误",
      },
      error: {
        type: "string",
        description: "错误内容",
      },
      background: {
        type: "string",
        description: "发生错误时的背景和上下文",
      },
      solution: {
        type: "string",
        description: "解决方法。outcome 为 unsolvable 时，填写尝试过的方法",
      },
      outcome: {
        type: "string",
        enum: ["recorded", "skipped", "unsolvable"],
        description: [
          "recorded：新错误且值得记录，写入错题本",
          "skipped：错题本中已有该错误，或不值得记录，不写入",
          "unsolvable：未能解决，记录错误和已尝试的方法",
        ].join("；"),
      },
    },
    required: ["scope", "error", "background", "solution", "outcome"],
  },
  async execute(args) {
    const result = await knowledgeManager.record(args as RecordKnowledgeArgs);
    if (result) {
      return `已记录到${args.scope === "system" ? "系统级" : "项目级"}错题本，ID：${result.id}`;
    }
    return `已确认（outcome: ${args.outcome}），不写入错题本`;
  },
};
```

### `search_knowledge`（大数据集场景）

当错题本条目超过阈值（20条）时注册此工具，供模型按需查询完整记录。

```typescript
export const searchKnowledgeTool: ToolDefinition = {
  name: "search_knowledge",
  description: "在错题本中关键词搜索，查找相关错误的解决方案",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词，如错误信息片段、模块名等",
      },
    },
    required: ["query"],
  },
  async execute(args) {
    const results = await knowledgeManager.search(args.query as string, 5);
    if (results.length === 0) return "未找到相关记录";
    return formatRecordsForDisplay(results);
  },
};
```

---

## Hook 机制

### 状态管理

KnowledgeManager 内部维护两个运行时状态：

```typescript
private pendingInjection = false;  // 是否有待处理的错误注入
private pendingCallCount = 0;      // 注入后模型调用次数（用于自动超时）
```

### 三个挂载点

#### 1. `tool:after` — 错误检测 & flag 管理

```typescript
// intercept：需要读取数据，不修改，返回 continue
hookRunner.intercept("tool:after", async (data) => {
  if (!this.isEnabled()) return { action: "continue" };

  const { call, result } = data;

  // 检测到工具执行失败，开启注入
  if (result.error && call.name !== "record_knowledge") {
    this.pendingInjection = true;
    this.pendingCallCount = 0;
  }

  // 模型调用了 record_knowledge，关闭注入
  if (call.name === "record_knowledge") {
    this.pendingInjection = false;
    this.pendingCallCount = 0;
  }

  return { action: "continue" };
});
```

#### 2. `model:before` — 工具过滤 & 注入错题本内容 & 提醒

```typescript
// intercept：需要修改 messages 和 tools，返回 modify
hookRunner.intercept("model:before", async (data) => {
  // 功能关闭时，从工具列表中移除知识库相关工具，模型不可见
  if (!this.isEnabled()) {
    return {
      action: "modify",
      data: {
        ...data,
        tools: data.tools.filter(
          t => t.name !== "record_knowledge" && t.name !== "search_knowledge"
        ),
      },
    };
  }

  // 无待处理错误，不注入
  if (!this.pendingInjection) return { action: "continue" };

  // 超过 5 次模型调用自动清除，防止永久注入
  this.pendingCallCount++;
  if (this.pendingCallCount > 5) {
    this.pendingInjection = false;
    this.pendingCallCount = 0;
    return { action: "continue" };
  }

  // 将错题本内容追加到系统提示词末尾
  const injectionContent = await this.buildInjection();
  const messages = [...data.messages];
  const systemIndex = messages.findIndex(m => m.role === "system");
  if (systemIndex !== -1) {
    messages[systemIndex] = {
      ...messages[systemIndex],
      content: messages[systemIndex].content + "\n\n" + injectionContent,
    };
  }

  return {
    action: "modify",
    data: { ...data, messages },
  };
});
```

注入内容追加到系统提示词末尾，**不写入 ConversationManager**，不污染对话历史。
每次 flag=true 时注入内容相同，无首轮/后续轮次区别。
工具过滤同样只影响传给模型 API 的工具列表，`toolRegistry` 本身不变。

### 注入内容构建

注入文本超过 5 行，统一放在 `src/prompts/knowledge.ts` 管理，`buildInjection()` 从那里导入。

```typescript
// src/prompts/knowledge.ts

/**
 * 错题本注入内容：每次 flag=true 时追加到系统提示词末尾
 * 包含错题本内容（由调用方传入）和完整调用规则
 */
export const KNOWLEDGE_INJECTION_INSTRUCTION = `\
遇到错误时优先查阅上方错题本，有对应记录则直接参考解法。
解决问题后如果错误有记录价值，优先调用 \`record_knowledge\` 工具：
- 错题本中没有该错误 且 值得记录 → 填写完整信息，outcome: recorded
- 错题本中已有该错误 → outcome: skipped（无需重复记录）
- 解决了但不值得记录 → outcome: skipped
- 无法解决 → 填写尝试过的方法，outcome: unsolvable`;

/** 将错题记录格式化为注入到系统提示词中的文本 */
export function formatRecordsForPrompt(records: KnowledgeRecord[]): string {
  return records.map(r => `- [${r.scope}] ${r.error}\n  背景：${r.background}\n  解法：${r.solution}`).join("\n\n");
}
```

#### 注入内容构建（每次相同）

```typescript
// src/knowledge/index.ts
import { KNOWLEDGE_INJECTION_INSTRUCTION, formatRecordsForPrompt } from "../prompts/knowledge.js";

// 小数据集（≤ 20 条）全量注入，大数据集只注入错误标题列表
async buildInjection(): Promise<string> {
  const records = await this.getAll();

  const notebookSection = records.length > 0
    ? `## 错题本\n\n${formatRecordsForPrompt(records)}`
    : `## 错题本\n\n（暂无记录）`;

  return `${notebookSection}\n\n${KNOWLEDGE_INJECTION_INSTRUCTION}`;
}
```

#### 大数据集（> 20 条）：注入摘要 + 提供搜索工具

只注入条目的错误标题列表，由模型决定是否调用 `search_knowledge` 查询完整内容。
同时在 `model:before` 中动态注册 `search_knowledge` 工具。

---

## 命令设计

```typescript
// src/commands/builtins/knowledge.ts

export const knowledgeCommand: CommandDefinition = {
  name: "knowledge",
  description: "管理错题本功能",
  async execute(args, ctx) {
    const [subcommand] = args.trim().split(/\s+/);

    switch (subcommand) {
      case "on":
        ctx.knowledgeManager.setEnabled(true);
        ctx.ui.showAssistantMessage("错题本已开启");
        break;
      case "off":
        ctx.knowledgeManager.setEnabled(false);
        ctx.ui.showAssistantMessage("错题本已关闭");
        break;
      case "list":
        await listRecords(ctx);
        break;
      case "clear":
        // 手动重置 pending flag，用于调试
        ctx.knowledgeManager.resetPending();
        ctx.ui.showAssistantMessage("已重置错题本注入状态");
        break;
      default:
        ctx.ui.showAssistantMessage(
          "用法: /knowledge <on|off|list|clear>"
        );
    }
  },
};
```

---

## 实现文件结构

```
src/knowledge/
  ├── plan.md          # 本方案文档
  ├── types.ts         # 类型定义（KnowledgeRecord、IKnowledgeManager 等）
  ├── index.ts         # KnowledgeManager 实现（含 hook 注册）
  └── storage.ts       # 存储层：读写 JSON 文件，处理路径

src/prompts/
  └── knowledge.ts     # 注入提示词（KNOWLEDGE_INJECTION_INSTRUCTION、formatRecordsForPrompt）

src/tools/builtins/
  └── knowledge.ts     # record_knowledge、search_knowledge 工具

src/commands/builtins/
  └── knowledge.ts     # /knowledge 命令
```

---

## 集成点

| 位置 | 改动 |
|---|---|
| `src/config/schema.ts` | 新增 `knowledgeEnabled` 字段，默认 `true` |
| `src/index.ts` | 初始化 KnowledgeManager 单例，注册工具和命令 |
| `src/commands/types.ts` | `CommandContext` 新增 `knowledgeManager: IKnowledgeManager`（命令需访问开关和状态） |

`ToolContext` **不需要改动**——工具通过导入单例 `knowledgeManager` 直接访问，与其他工具保持一致。

---

## 完整流程图

```
工具执行失败（result.error 非空）
        ↓
tool:after hook → pendingInjection = true
        ↓
每次 model:before hook（flag=true 期间持续）
        ↓
  ┌──────────────────────────────────────────────┐
  │ 追加到系统提示词末尾（每次内容相同）：           │
  │   错题本全部内容 + 完整调用规则                 │
  │   （仅修改传给模型 API 的 messages 拷贝，       │
  │    不写入 ConversationManager）                │
  └──────────────────────────────────────────────┘
        ↓
模型处理错误（可能经过多轮工具调用，最多 5 次）
        ↓
模型调用 record_knowledge
        ↓
  outcome = recorded   → 写入 JSON 文件
  outcome = skipped    → 不写入
  outcome = unsolvable → 写入（含尝试过的方法）
        ↓
tool:after hook → pendingInjection = false，pendingCallCount = 0
        ↓
后续对话恢复正常，无注入
```

---

## 边界情况处理

| 情况 | 处理方式 |
|---|---|
| 模型一直不调用 `record_knowledge` | 超过 5 次模型调用后自动清除 flag |
| bash exit code 0 但有错误输出 | 不触发（只监听 `result.error` 非空） |
| 错题本条目重复 | 允许重复，靠提示词引导模型使用 `skipped` 降低重复率 |
| 功能出现问题 | `/knowledge off` 关闭，或配置文件设置 `KNOWLEDGE_ENABLED=false` |
| 大数据集检索 | 条目 > 20 时自动切换为摘要注入 + `search_knowledge` 工具模式 |
