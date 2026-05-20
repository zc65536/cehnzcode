# Phase 2: /plan 命令实现（讨论模式 + 直接模式）

## 目标

实现 `/plan` 命令的两种模式：
1. **讨论模式**：`/plan` (无参数) - 用户和模型多轮对话澄清需求
2. **直接模式**：`/plan <任务描述>` - 直接从任务描述生成计划

## 依赖

- Phase 1 骨架已完成
- 参考 `src/orchestrator/index.ts` 的对话循环逻辑
- 参考 `src/session/index.ts` 的会话管理

---

## 核心逻辑

### 两种模式对比

| 特性 | 讨论模式 | 直接模式 |
|------|---------|---------|
| 触发方式 | `/plan` (无参数) | `/plan <任务描述>` |
| 交互方式 | 多轮对话 | 单次调用 |
| 结束方式 | 模型判断或用户确认 | 立即进入 createPlan |
| 适用场景 | 需求不明确 | 需求已明确 |

### 讨论模式的特点

与普通对话的区别：
1. **独立的会话历史**：不复用普通对话的 session，避免无关上下文污染
2. **特殊的系统提示词**：模型扮演任务规划顾问，不是执行者
3. **结束标记检测**：模型在回复末尾输出 `[READY_TO_PLAN]` 时自动结束
4. **项目指令注入**：从 `.cehnzcode/CLAUDE.md` 读取项目规范并注入到系统提示词

### 工作流程（讨论模式）

```
用户输入 /plan（无参数）
    ↓
创建 PlanDiscussionSession
    - 加载项目 CLAUDE.md
    - 构造讨论系统提示词
    - 初始化空的 history
    ↓
进入讨论循环（类似 orchestrator 的 handleUserInput）
    ↓
每轮用户输入：
    1. 添加用户消息到 history
    2. 调用模型（传入完整 history + 讨论系统提示词）
    3. 检测回复末尾是否有 [READY_TO_PLAN]
    4. 去除标记后展示给用户
    5. 如果有标记 → 自动触发 createPlan
       如果无标记 → 继续等待用户输入
    ↓
用户输入 /plan confirm（兜底路径）
    → 强制结束讨论，触发 createPlan
```

### 工作流程（直接模式）

```
用户输入 /plan <任务描述>
    ↓
立即调用 createPlan
    - input.task = 任务描述
    - input.discussionHistory = []
    ↓
进入 Phase 3 的计划生成流程
```

---

## 实现清单

### 1. 提示词：PLAN_DISCUSSION_PROMPT

```typescript
// src/prompts/planner.ts

export function buildPlanDiscussionPrompt(projectInstructions?: string): string {
  return `你正在协助用户规划一个待执行的任务。这是一次多轮讨论，目标是在进入正式的任务分解之前，把任务的需求、边界、依赖、约束充分澄清。

## 你的角色

你是任务规划顾问，不是任务执行者。本阶段你只参与讨论，不生成最终的模块化计划——计划生成由后续独立环节完成。

${projectInstructions ? `## 项目规范（CEHNZ.md）\n\n${projectInstructions}\n` : ""}

## 讨论原则

1. **主动提问**，识别用户描述中的歧义、遗漏、矛盾
2. **暴露隐性依赖**（例如认证、数据库、外部服务、已有模块的接口）
3. **提示非功能性约束**（错误处理、并发、可观测性等），但不强加
4. **建议模块边界**，让用户确认，而不是替用户决定
5. **不轻易跳到代码层细节**，停留在"做什么、模块如何划分"的层面
6. **简洁**，避免长篇大论。一次回复聚焦 1-2 个关键问题

## 何时结束讨论

当你识别到用户表达了明确的"可以开始规划"意图（例如"就这样吧"、"开始生成计划"、"OK 可以了"、"动手吧"），按以下格式回复：

1. 先用自然语言简短总结讨论结论：
   - 任务目标
   - 已确认的关键边界和约束
   - 主要模块设想（粗粒度，2-5 个）

2. 在回复的**最后一行单独输出标记**：\`[READY_TO_PLAN]\`

**重要**：
- 如果用户的意图模糊（例如只回复"嗯"、"好的"、"明白了"），**不要输出标记**。改为反问确认，例如："那我们就基于以上讨论开始生成计划，可以吗？"
- 不要在讨论尚未充分时主动提议结束。等用户先表达意图。
- 标记必须单独一行，不要包裹在代码块或引号里。

## 示例对话

用户：我想重构用户认证模块，用 JWT 替换现在的 session

助手：好的，开始之前想先确认几个边界：
1. 现有 session 是基于内存还是 Redis？JWT 替换后是否还需要服务端存储？
2. 替换是渐进式（双轨并行一段时间）还是一次性切换？
3. 已有的客户端（浏览器、移动端）如何感知这次变更？

用户：内存的，直接切就行；客户端那边我会另外通知

助手：明白。那再确认一点：
- Token 过期时间和刷新机制怎么设计？短期 access token + refresh token，还是单 token 长有效期？

用户：单 token 7 天就够了，简单点

助手：OK，那基于以上讨论，我理解任务是：

**任务目标**：用单 token 7 天有效期的 JWT 方案替换现有的内存 session 认证

**关键边界**：
- 一次性切换，不做双轨并行
- 不需要 refresh token 机制
- 不需要服务端 token 存储
- 客户端适配由用户线下处理

**主要模块设想**（粗粒度）：
1. JWT 工具函数（签发、验证）
2. 登录/登出接口改造
3. 认证中间件替换
4. 现有 session 代码清理

可以开始生成详细计划了吗？

用户：可以

助手：好的，我会基于以上讨论生成详细的模块化计划。

[READY_TO_PLAN]
`;
}
```

### 2. 实现 PlanDiscussionSessionImpl.send

```typescript
// src/planner/discussion.ts

import type { ModelClient } from "../model/index.js";
import type { Message, Turn } from "../types.js";
import type { PlanDiscussionSession, PlanContext } from "./types.js";
import { READY_MARKER } from "./types.js";
import { buildPlanDiscussionPrompt } from "../prompts/planner.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:discussion");

export class PlanDiscussionSessionImpl implements PlanDiscussionSession {
  history: Message[];
  startedAt: number;
  
  private model: ModelClient;
  private context: PlanContext;

  constructor(model: ModelClient, context: PlanContext) {
    this.model = model;
    this.context = context;
    this.history = [];
    this.startedAt = Date.now();
    
    // 添加系统提示词
    const systemPrompt = buildPlanDiscussionPrompt(context.projectInstructions);
    this.history.push({
      role: "system",
      content: systemPrompt,
    });
    
    logger.info("Discussion session created");
  }

  async send(userInput: string, context: PlanContext): Promise<{ reply: string; readyToPlan: boolean }> {
    logger.info({ inputLength: userInput.length }, "Processing user input");
    
    // 更新 context（可能包含新的项目信息）
    this.context = { ...this.context, ...context };
    
    // 添加用户消息
    this.history.push({
      role: "user",
      content: userInput,
    });
    
    // 调用模型（不使用工具）
    const response = await this.model.chat(this.history, []);
    
    // 添加助手回复
    this.history.push({
      role: "assistant",
      content: response.content,
    });
    
    // 检测结束标记
    const readyToPlan = this.detectReadyMarker(response.content);
    
    // 去除标记后返回
    const cleanReply = this.removeReadyMarker(response.content);
    
    logger.info({ readyToPlan, replyLength: cleanReply.length }, "Discussion turn completed");
    
    return {
      reply: cleanReply,
      readyToPlan,
    };
  }

  getHistory(): Message[] {
    // 返回副本，排除系统提示词（第一条）
    return this.history.slice(1).map(msg => ({ ...msg }));
  }

  /**
   * 检测回复末尾是否包含 [READY_TO_PLAN] 标记
   */
  private detectReadyMarker(content: string): boolean {
    // 匹配末尾的标记（允许前后有空白字符）
    const pattern = new RegExp(`\\s*${this.escapeRegex(READY_MARKER)}\\s*$`);
    return pattern.test(content);
  }

  /**
   * 去除回复末尾的 [READY_TO_PLAN] 标记
   */
  private removeReadyMarker(content: string): string {
    const pattern = new RegExp(`\\s*${this.escapeRegex(READY_MARKER)}\\s*$`);
    return content.replace(pattern, "").trimEnd();
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
```

### 3. 实现 /plan 命令的讨论模式

```typescript
// src/commands/builtins/plan.ts

import type { CommandDefinition, CommandContext } from "../types.js";
import type { PlanInput, PlanDiscussionSession } from "../../planner/types.js";
import { createChildLogger } from "../../logger/index.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const logger = createChildLogger("commands:plan");

/**
 * 加载项目级 CEHNZ.md
 */
async function loadProjectInstructions(ctx: CommandContext): Promise<string | undefined> {
  const projectRoot = ctx.config.projectRoot || process.cwd();
  const claudePath = path.join(projectRoot, ".cehnzcode", "CEHNZ.md");
  
  try {
    const content = await fs.readFile(claudePath, "utf-8");
    logger.info({ path: claudePath }, "Loaded project instructions");
    return content;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      logger.info("No project CEHNZ.md found");
      return undefined;
    }
    throw err;
  }
}

export const planCommand: CommandDefinition = {
  name: "plan",
  description: "创建并执行模块化任务计划",
  async execute(args, ctx) {
    if (!ctx.planner) {
      ctx.ui.showError(new Error("Planner not initialized"));
      return;
    }

    if (!args) {
      // ========== 讨论模式 ==========
      logger.info("Entering discussion mode");
      
      const projectInstructions = await loadProjectInstructions(ctx);
      
      const discussion = ctx.planner.createDiscussionSession({
        projectRoot: ctx.config.projectRoot,
        projectInstructions,
      });
      
      // 保存讨论会话到 session（需要扩展 session 支持模式）
      ctx.session.setMode("plan-discussion", { discussion });
      
      ctx.ui.showMessage("已进入 plan 讨论模式。直接描述你想完成的任务，或继续追问以澄清需求。");
      ctx.ui.showMessage("提示：讨论结束后会自动生成计划，或使用 /plan confirm 强制结束讨论。");
      return;
    }

    // ========== 直接模式 ==========
    logger.info({ taskLength: args.length }, "Entering direct mode");
    
    // 直接调用 runPlan，跳过讨论
    await runPlan({ task: args, discussionHistory: [] }, ctx);
  },
};

export const planConfirmCommand: CommandDefinition = {
  name: "plan confirm",
  description: "强制结束当前讨论并生成计划",
  async execute(args, ctx) {
    const mode = ctx.session.getMode();
    
    if (mode !== "plan-discussion") {
      ctx.ui.showMessage("当前不在 plan 讨论模式，请先输入 /plan 开始讨论。");
      return;
    }

    logger.info("Forcing discussion end");
    
    const discussion = ctx.session.getModeData<PlanDiscussionSession>("discussion");
    ctx.session.setMode("normal");
    
    await runPlan({ task: null, discussionHistory: discussion.getHistory() }, ctx);
  },
};

/**
 * 讨论模式下的用户输入处理函数
 * 由 orchestrator 根据 session mode 派发
 */
export async function handlePlanDiscussionInput(userInput: string, ctx: CommandContext): Promise<void> {
  const discussion = ctx.session.getModeData<PlanDiscussionSession>("discussion");
  const projectInstructions = await loadProjectInstructions(ctx);

  const { reply, readyToPlan } = await discussion.send(userInput, {
    projectRoot: ctx.config.projectRoot,
    projectInstructions,
  });

  // 展示模型回复（标记已被移除）
  ctx.ui.showAssistantMessage(reply);

  if (readyToPlan) {
    logger.info("Discussion ended by model");
    ctx.ui.showMessage("\n讨论结束，正在基于讨论内容生成计划...\n");
    ctx.session.setMode("normal");
    await runPlan({ task: null, discussionHistory: discussion.getHistory() }, ctx);
  }
}

/**
 * 执行计划（Phase 3 实现）
 */
async function runPlan(input: PlanInput, ctx: CommandContext): Promise<void> {
  ctx.ui.showMessage("计划生成尚未实现（Phase 3）");
  
  // Phase 3 实现：
  // 1. 调用 planner.createPlan(input, context)
  // 2. 展示计划，等待用户确认
  // 3. 调用 planner.executePlan(plan)
  // 4. 展示执行进度
}
```

### 4. 扩展 Session 支持模式切换

需要在 `src/session/index.ts` 或 `src/types.ts` 中添加模式管理：

```typescript
// src/types.ts 或 src/session/index.ts

export type SessionMode = "normal" | "plan-discussion";

export interface SessionModeData {
  mode: SessionMode;
  data?: any;
}

// 在 SessionManager 或 CommandContext 中添加：
export interface SessionModeManager {
  getMode(): SessionMode;
  setMode(mode: SessionMode, data?: any): void;
  getModeData<T = any>(key: string): T;
}
```

### 5. 修改 Orchestrator 支持模式派发

```typescript
// src/orchestrator/index.ts

// 在 handleUserInput 之前检查 session mode
private async handleUserInput(input: string): Promise<void> {
  const mode = this.sessionManager.getMode?.() ?? "normal";
  
  if (mode === "plan-discussion") {
    // 派发到讨论模式处理函数
    const { handlePlanDiscussionInput } = await import("../commands/builtins/plan.js");
    await handlePlanDiscussionInput(input, this.buildCommandContext());
    return;
  }
  
  // 原有的普通对话逻辑
  this.context.addTurn({ role: "user", content: input, tags: ["user"] });
  // ... 其余代码不变
}
```

---

## UI 展示示例

### 进入讨论模式

```
> /plan
已进入 plan 讨论模式。直接描述你想完成的任务，或继续追问以澄清需求。
提示：讨论结束后会自动生成计划，或使用 /plan confirm 强制结束讨论。

> 我想重构用户认证模块，用 JWT 替换现在的 session

好的，开始之前想先确认几个边界：
1. 现有 session 是基于内存还是 Redis？JWT 替换后是否还需要服务端存储？
2. 替换是渐进式（双轨并行一段时间）还是一次性切换？
3. 已有的客户端（浏览器、移动端）如何感知这次变更？

> 内存的，直接切就行；客户端那边我会另外通知

明白。那再确认一点：
- Token 过期时间和刷新机制怎么设计？短期 access token + refresh token，还是单 token 长有效期？

> 单 token 7 天就够了，简单点

OK，那基于以上讨论，我理解任务是：

**任务目标**：用单 token 7 天有效期的 JWT 方案替换现有的内存 session 认证

**关键边界**：
- 一次性切换，不做双轨并行
- 不需要 refresh token 机制
- 不需要服务端 token 存储
- 客户端适配由用户线下处理

**主要模块设想**（粗粒度）：
1. JWT 工具函数（签发、验证）
2. 登录/登出接口改造
3. 认证中间件替换
4. 现有 session 代码清理

可以开始生成详细计划了吗？

> 可以

好的，我会基于以上讨论生成详细的模块化计划。

讨论结束，正在基于讨论内容生成计划...

[进入 Phase 3 的计划生成流程]
```

---

## 测试

```typescript
// src/planner/test/test-discussion.ts

import { describe, it, expect, vi } from "vitest";
import { PlanDiscussionSessionImpl } from "../discussion.js";
import { READY_MARKER } from "../types.js";

describe("PlanDiscussionSession", () => {
  it("should detect ready marker at end of reply", async () => {
    const mockModel = {
      chat: vi.fn().mockResolvedValue({
        content: `好的，我们可以开始了。\n\n${READY_MARKER}`,
      }),
    };

    const session = new PlanDiscussionSessionImpl(mockModel as any, {});
    const result = await session.send("开始吧", {});

    expect(result.readyToPlan).toBe(true);
    expect(result.reply).not.toContain(READY_MARKER);
    expect(result.reply).toBe("好的，我们可以开始了。");
  });

  it("should not detect marker in middle of reply", async () => {
    const mockModel = {
      chat: vi.fn().mockResolvedValue({
        content: `我们讨论一下 ${READY_MARKER} 这个标记的用法。`,
      }),
    };

    const session = new PlanDiscussionSessionImpl(mockModel as any, {});
    const result = await session.send("继续", {});

    expect(result.readyToPlan).toBe(false);
  });

  it("should accumulate history", async () => {
    const mockModel = {
      chat: vi.fn()
        .mockResolvedValueOnce({ content: "第一轮回复" })
        .mockResolvedValueOnce({ content: "第二轮回复" }),
    };

    const session = new PlanDiscussionSessionImpl(mockModel as any, {});
    
    await session.send("第一个问题", {});
    await session.send("第二个问题", {});

    const history = session.getHistory();
    expect(history).toHaveLength(4); // 2 user + 2 assistant
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
  });
});
```

---

## 验收标准

Phase 2 完成后应该满足：

### 讨论模式
1. ✅ `/plan` 无参数进入讨论模式
2. ✅ 讨论会话独立于普通对话
3. ✅ 项目 CLAUDE.md 正确注入到系统提示词
4. ✅ 模型回复末尾的 `[READY_TO_PLAN]` 标记被正确检测
5. ✅ 标记被去除后展示给用户
6. ✅ 检测到标记后自动触发 createPlan（Phase 3）
7. ✅ `/plan confirm` 可以强制结束讨论
8. ✅ 讨论历史正确传递给 createPlan

### 直接模式
9. ✅ `/plan <任务描述>` 直接进入计划生成
10. ✅ 任务描述正确传递给 createPlan
11. ✅ 跳过讨论，立即调用 runPlan

### 测试
12. ✅ 测试覆盖标记检测、历史累积等核心逻辑
13. ✅ 测试两种模式的路由逻辑

---

## 注意事项

1. **标记检测的鲁棒性**：
   - 只匹配末尾的标记，不匹配中间出现的
   - 允许标记前后有空白字符
   - 不要匹配被包裹在代码块或引号里的标记

2. **模式切换**：
   - 进入讨论模式时保存当前 session 状态
   - 讨论结束后恢复 normal 模式
   - 讨论历史不持久化（一次性使用）

3. **两种模式的选择**：
   - 需求不明确时使用讨论模式
   - 需求已明确时使用直接模式
   - 直接模式更快，但可能遗漏重要细节

4. **错误处理**：
   - 模型调用失败时给出友好提示
   - 讨论模式下不允许使用工具
   - 项目 CLAUDE.md 不存在时给出提示但不阻塞

5. **用户体验**：
   - 清晰提示当前处于讨论模式
   - 提供退出讨论的方式（/plan confirm 或 /exit）
   - 讨论结束时给出明确的过渡提示
