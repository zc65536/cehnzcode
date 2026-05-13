# Task Planner — 模块化任务分解与执行

## 项目背景

本模块是 cehnzcode（mini Claude Code CLI 工具）的一部分，遵循项目的高可扩展性和高解耦性设计目标。`/plan` 是一种特殊的对话模式：用户描述一个任务，系统将其分解为模块化的执行计划，调用模型逐模块完成实现，最终交付一个完整的、生产级别的骨架实现。

---

## 核心设计理念

### 计划层 vs 执行层的职责分离

系统分为两层，职责严格分离：

- **计划层**：负责模块间的协调——定义模块边界、依赖关系、信息契约、对外接口
- **执行层**：负责模块内的实现——模型在一次 agentic loop 里完成一个模块，中间如何思考、如何拆解是模型自己的事，计划系统不感知

模块内部不再分步骤。模块本身就是原子执行单元，计划系统只关心模块的输入契约和输出契约。

### 生产级骨架

每个模块的产出是生产级别的实现，覆盖用户任务描述中的所有功能。骨架保证高拓展性和模块间解耦，后续无论新增模块还是对现有模块细化，都不影响其他模块的代码。

### 讨论模式与直接模式

`/plan` 提供两种入口：

- **讨论模式**：用户和模型进行真正的多轮对话，模型扮演"任务规划顾问"角色，主动澄清需求、识别边界、暴露依赖。讨论结束的判定由模型基于用户语义自动完成，无需用户记忆特定指令。
- **直接模式**：用户已经想清楚任务，直接传入任务描述，跳过讨论。

两种模式在进入规划阶段（createPlan）后流程完全一致。

---

## 核心概念

### Plan（计划）

一个 Plan 包含：
- 任务描述
- 分解后的模块列表
- 整体执行状态

### Module（模块）

每个模块包含：
- 模块描述（要实现什么）
- `dependsOn`：必须等待完成才能开始执行的模块（调度依据）
- `relatedModules`：执行时需要读取笔记的模块（上下文来源）
- `inputContract`：本模块依赖哪些其他模块的对外接口（含接口名和功能描述）
- `outputContract`：本模块对外暴露哪些接口（含接口名和功能描述）
- 执行状态、笔记、测试文件路径

### Module Note（模块笔记）

每个模块执行完成后写入笔记，笔记为 JSON 格式，包含：
- 实际创建/修改的文件列表（含每个文件的作用说明）
- 实际实现的对外接口列表（按 outputContract schema 填写）
- 可选的补充说明

笔记同时保存为 Markdown 文件供人工阅读，程序内部流转使用 JSON。

---

## 类型定义

```typescript
// src/planner/types.ts

interface TaskPlanner {
  createPlan(input: PlanInput, context?: PlanContext): Promise<TaskPlan>;
  executePlan(plan: TaskPlan): AsyncGenerator<ModuleResult>;
  pause(): void;
  resume(): void;
  cancel(): void;
  savePlan(plan: TaskPlan, path: string): Promise<void>;
  loadPlan(path: string): Promise<TaskPlan>;
  getStatus(): PlanStatus;
}

interface TaskPlan {
  id: string;
  task: string;
  description: string;
  modules: Module[];
  status: PlanStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  metadata: PlanMetadata;
}

interface Module {
  id: string;
  index: number;
  description: string;

  // 调度依据：必须等待这些模块完成后才能开始
  dependsOn: string[];

  // 上下文来源：执行时需要读取这些模块的笔记
  relatedModules: string[];

  // 计划阶段预定义：本模块依赖哪些外部接口
  inputContract: InterfaceContract[];

  // 计划阶段预定义：本模块对外暴露哪些接口
  outputContract: InterfaceContract[];

  // 执行后填写
  note?: ModuleNote;
  notePath?: string;       // .cehnzcode/notes/<module-id>.md
  testPaths?: string[];    // 测试文件路径，位于 .cehnzcode/notes/ 下

  status: ModuleStatus;
  error?: string;
  startedAt?: number;
  completedAt?: number;

  retryConfig?: {
    maxRetries: number;
    currentRetry: number;
    retryDelay: number;
  };
}

// 接口契约：一个对外接口的声明
interface InterfaceContract {
  name: string;         // 接口名（函数名、类名、类型名等）
  description: string;  // 功能描述
  sourceModule?: string; // inputContract 中使用：该接口由哪个模块提供
}

interface ModuleNote {
  // 强制字段
  files: Array<{
    path: string;
    description: string;
  }>;
  exports: InterfaceContract[];

  // 可选字段
  envVars?: string[];
  extra?: Record<string, string>;
}

interface ModuleResult {
  moduleId: string;
  status: ModuleStatus;
  note?: ModuleNote;
  error?: string;
  duration: number;
}

type ModuleStatus = "pending" | "ready" | "running" | "done" | "failed" | "skipped";
type PlanStatus = "draft" | "ready" | "running" | "paused" | "completed" | "failed" | "cancelled";

interface PlanContext {
  projectRoot?: string;
  relevantFiles?: string[];
  constraints?: string[];
  // 项目级 CLAUDE.md 内容（如存在），由命令层从 .cehnzcode/CLAUDE.md 或类似位置读取后注入
  projectInstructions?: string;
}

// createPlan 的输入：直接模式传 task，讨论模式传 discussionHistory
interface PlanInput {
  task: string | null;
  discussionHistory: Message[];
}

interface PlanMetadata {
  estimatedDuration?: number;
  complexity: "simple" | "medium" | "complex";
  tags: string[];
}

// 讨论模式专用：独立的讨论会话
interface PlanDiscussionSession {
  history: Message[];
  startedAt: number;

  // 添加用户消息并请求模型回复，返回模型回复 + 是否检测到结束信号
  send(userInput: string, context: PlanContext): Promise<{
    reply: string;
    readyToPlan: boolean;
  }>;

  // 获取完整对话历史（用于传入 createPlan）
  getHistory(): Message[];
}
```

---

## 工作流程

### 第零阶段：讨论（仅讨论模式）

用户通过 `/plan`（不带参数）进入讨论模式。系统创建一个独立的 `PlanDiscussionSession`，**不复用普通对话的 session 历史**，避免无关上下文污染。

每一轮交互的流程：

```
用户输入
    ↓
PlanDiscussionSession.send()
    - 系统提示词 = plan-discussion.ts 模板 + 注入项目 CLAUDE.md
    - 完整讨论历史一并传入
    ↓
模型回复（自然语言）
    ↓
检测回复末尾是否包含 [READY_TO_PLAN] 标记
    ├─ 包含 → 去除标记后展示给用户，自动触发 createPlan
    │         createPlan 的输入为完整讨论历史
    └─ 不包含 → 正常展示回复，等待用户下一轮输入
```

**结束条件**：

主路径 —— **模型根据用户语义判断**。当模型识别到用户表达了明确的"可以开始规划"意图（例如"就这样吧"、"开始生成计划"、"OK 可以了"），它会先用自然语言简短总结讨论结论（任务目标、关键边界、主要模块设想），然后在回复末尾单独一行输出 `[READY_TO_PLAN]` 标记。系统检测到标记后去除标记并自动进入规划阶段。

兜底路径 —— **用户显式确认**。`/plan confirm` 指令仍然保留，用于以下情况：
- 模型判断失误、迟迟不输出结束标记
- 用户希望强制结束讨论

**讨论阶段的提示词**（`src/prompts/plan-discussion.ts`）：

```
你正在协助用户规划一个待执行的任务。这是一次多轮讨论，目标是在进入正式的任务分解之前，把任务的需求、边界、依赖、约束充分澄清。

## 你的角色

你是任务规划顾问，不是任务执行者。本阶段你只参与讨论，不生成最终的模块化计划——计划生成由后续独立环节完成。

## 项目上下文（CLAUDE.md）

${projectInstructions ?? "（无项目级指令）"}

## 讨论原则

1. 主动提问，识别用户描述中的歧义、遗漏、矛盾
2. 帮用户暴露隐性依赖（例如认证、数据库、外部服务、已有模块的接口）
3. 提示用户考虑非功能性约束（错误处理、并发、可观测性等），但不强加
4. 对模块边界给出建议，让用户确认，而不是替用户决定
5. 不轻易跳到代码层细节，停留在"做什么、模块如何划分"的层面
6. 简洁，避免长篇大论。一次回复聚焦 1-2 个关键问题

## 何时结束讨论

当你识别到用户表达了明确的"可以开始规划"意图（例如"就这样吧"、"开始生成计划"、"OK 可以了"、"动手吧"），按以下格式回复：

1. 先用自然语言简短总结讨论结论：
   - 任务目标
   - 已确认的关键边界和约束
   - 主要模块设想（粗粒度，2-5 个）
2. 在回复的最后一行单独输出标记：[READY_TO_PLAN]

**重要**：如果用户的意图模糊（例如只回复"嗯"、"好的"、"明白了"），不要输出标记。改为反问确认，例如："那我们就基于以上讨论开始生成计划，可以吗？"

不要在讨论尚未充分时主动提议结束。等用户先表达意图。
```

---

### 第一阶段：createPlan

```
讨论模式：完整讨论历史进入 createPlan
直接模式：任务描述进入 createPlan
    ↓
模型生成计划（模块列表、dependsOn、relatedModules、inputContract、outputContract）
    ↓
验证模型做供需匹配
（检查所有 inputContract 声明的接口是否都有对应模块的 outputContract 提供）
    ↓
展示给用户确认
    ↓
用户确认 → 保存计划
```

**步骤一：模型生成计划**

提示词位于 `src/prompts/plan-creation.ts`，支持两种输入形式。无论哪种模式，项目 CLAUDE.md 都注入到 prompt 中（直接模式下用户没经过讨论，规划模型完全依赖 CLAUDE.md 了解项目约定；讨论模式下重复注入也无害）。

直接模式（有明确任务描述）：

```
你是一个任务规划专家。将以下任务分解为独立的功能模块。

## 任务
${task}

## 项目上下文（CLAUDE.md）
${projectInstructions ?? "（无）"}

## 其他上下文
${context}

## 要求
...（同下）
```

讨论模式（有对话历史）：

```
你是一个任务规划专家。根据以下讨论内容，将任务分解为独立的功能模块。

## 讨论记录
${discussionHistory}

## 项目上下文（CLAUDE.md）
${projectInstructions ?? "（无）"}

## 其他上下文
${context}

## 要求
1. 将任务分解为 3-10 个模块，每个模块职责单一、边界清晰
2. 每个模块只描述"要做什么"，不展开内部实现细节
3. dependsOn：必须等待完成才能开始的模块（调度依据，影响执行顺序）
4. relatedModules：执行时需要参考笔记的模块（信息来源，不影响调度）
5. inputContract：本模块依赖哪些其他模块的对外接口，含接口名和功能描述
6. outputContract：本模块对外暴露哪些接口，含接口名和功能描述
7. 接口依赖关系宁多勿少，漏掉依赖比多写依赖代价更高

## 输出格式（只输出 JSON，不要有其他内容）
{
  "description": "任务整体说明",
  "modules": [
    {
      "description": "模块描述",
      "dependsOn": [0, 1],
      "relatedModules": [0, 1, 2],
      "inputContract": [
        { "name": "verifyToken", "description": "验证 JWT 并返回 UserId", "sourceModule": 1 }
      ],
      "outputContract": [
        { "name": "authMiddleware", "description": "Express 中间件，验证请求头中的 token" }
      ]
    }
  ],
  "metadata": {
    "estimatedDuration": 30,
    "complexity": "medium",
    "tags": ["refactor", "auth"]
  }
}
```

两种模式的要求和输出格式完全相同，只有输入部分不同。代码里根据 `PlanInput.task` 是否为 null 选择对应的 prompt 模板。

**步骤二：验证模型供需匹配**

独立调用一次模型，扮演"架构审查员"角色，检查：
1. 执行流程是否合理，是否存在循环依赖
2. 所有模块 `inputContract` 声明的接口，是否都能在某个模块的 `outputContract` 中找到对应提供方
3. 模块边界是否清晰，是否有明显的职责重叠

发现问题则返回给第一步重新生成计划，直到验证通过。重新生成时把验证反馈作为补充信息带入，规划模型在已有输入加上反馈的基础上重试。

提示词位于 `src/prompts/plan-validation.ts`。

**关于 dependsOn 和 relatedModules 的区别：**
- `dependsOn`：执行顺序约束，模块A的 `dependsOn` 包含模块B，意味着必须等B完成才能开始A
- `relatedModules`：信息来源，执行A时会读取这些模块的笔记作为上下文，可以包含任何已完成的模块，不影响调度

两者可以不同：模块A可能需要读模块C的笔记，但不需要等C完成才能开始（比如C是可选的参考信息）。

---

### 第二阶段：executeModule

```
收集 relatedModules 的笔记作为上下文
    ↓
构造 prompt（含总体目标、完整模块列表、当前模块描述、outputContract、相关笔记）
    ↓
模型在 agentic loop 里实现代码
（终止条件：无工具调用且 finishReason 为 stop/end_turn，复用 cehnzcode 现有的 handleUserInput 机制）
    ↓
执行器把完整对话历史传给模型，生成模块笔记 JSON
    ↓
进入 validateNote 阶段
```

**Prompt 设计**（`src/prompts/module-execution.ts`）：

```
你正在执行一个任务计划中的一个模块。

## 总体目标
${plan.task}

## 完整模块列表
${plan.modules.map((m, i) => `${i + 1}. ${m.description} [${m.status}]`).join('\n')}

## 当前模块（第 ${module.index + 1} 个，共 ${plan.modules.length} 个）
${module.description}

## 你必须实现的对外接口
${module.outputContract.map(c => `- ${c.name}：${c.description}`).join('\n')}
以上接口必须全部实现并导出，不可遗漏。

## 你可以使用的外部接口
${module.inputContract.map(c => `- ${c.name}（来自 ${c.sourceModule}）：${c.description}`).join('\n')}

## 来自相关模块的信息
${relatedNotesContext}

## 执行要求
- 只实现当前模块，不要修改其他模块负责的文件
```

**笔记生成**（agentic loop 自然终止后，执行器触发）：

把完整对话历史传入，追加一条消息要求模型输出笔记 JSON：

```
实现已完成。请根据你的实际实现，输出本模块的笔记。
只输出 JSON，不要有其他内容。

格式：
{
  "files": [{ "path": "...", "description": "..." }],
  "exports": [{ "name": "...", "description": "..." }],
  "envVars": [],
  "extra": {}
}
```

---

### 第三阶段：validateNote

```
1. 模型对比 outputContract vs 模块笔记
        ↓ 不一致（有接口未覆盖）→ 模块重试
        ↓ 一致
2. 静态检查：确认笔记中声明的导出在代码文件里实际存在
        ↓ 缺失 → 带具体报错重试模块实现
        ↓ 通过
3. 模型读取笔记 + 代码，生成单元测试
   测试文件放在 `.cehnzcode/notes/` 下，命名为 `<module-id>.test.ts`
        ↓ 生成失败 → 重试测试生成（不重试模块实现）
        ↓ 生成成功
4. 运行测试
        ↓ 失败 → 把测试报错追加到对话历史，继续修复（对话内修复优先）
               → 轮次超限则重开实现（带入失败原因）
        ↓ 通过
5. 模块标记 done，测试文件路径写入 module.testPaths
```

**静态检查说明**：

对 TypeScript 项目，检查对应文件的 export 列表（AST 解析或 grep `export`）。检查失败时把"哪个文件缺少哪个导出"的具体信息带入重试 prompt。

**测试生成 Prompt**（`src/prompts/test-generation.ts`）：

```
为以下模块的对外接口生成单元测试。

## 模块对外接口（outputContract）
${module.outputContract.map(c => `- ${c.name}：${c.description}`).join('\n')}

## 模块笔记
${JSON.stringify(module.note, null, 2)}

## 相关代码文件
${codeFilesContent}

要求：
- 针对每个对外接口至少写一个测试用例
- 测试文件命名为 ${module.id}.test.ts，放在 .cehnzcode/notes/ 目录下
- 只测试对外接口的行为，不测试内部实现细节
```

---

### 第四阶段：端到端测试

所有模块标记 done 后：

```
收集所有模块的 testPaths
    ↓
统一运行所有测试
    ↓ 通过 → 计划标记 completed
    ↓ 失败 → 定位到具体模块 → 触发该模块完整重试
           → 重试完成后重新运行端到端测试
```

---

## 执行调度

### 并行策略

- 主进程统筹计划状态，不参与模块执行
- `dependsOn` 为空或所有依赖已 done 的模块标记为 ready
- ready 的模块可以并行，每个模块分配一个子进程执行
- 子进程只写自己模块目录下的文件和笔记，主进程统一维护 plan JSON 状态

### 超时处理

主进程对每个子进程设超时，超时后：
- 标记模块为 failed
- 终止子进程
- 触发重试（如未超过 maxRetries）

### 执行器伪代码

```typescript
// src/planner/executor.ts

async function* executePlan(plan: TaskPlan): AsyncGenerator<ModuleResult> {
  while (hasUnfinishedModules(plan)) {
    const readyModules = plan.modules.filter(m =>
      m.status === "pending" &&
      m.dependsOn.every(id => plan.modules.find(x => x.id === id)?.status === "done")
    );

    if (readyModules.length === 0) {
      if (hasRunningModules(plan)) {
        await sleep(100);
        continue;
      } else {
        throw new Error("计划执行死锁：存在未完成的模块但无法继续");
      }
    }

    const results = await Promise.allSettled(
      readyModules.map(module => runModuleInProcess(module, plan))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        yield result.value;
      }
    }
  }
}

async function runModuleInProcess(module: Module, plan: TaskPlan): Promise<ModuleResult> {
  module.status = "running";
  module.startedAt = Date.now();

  return new Promise((resolve) => {
    const worker = fork("src/planner/module-worker.ts", [module.id, plan.id]);

    const timeout = setTimeout(() => {
      worker.kill();
      resolve({ moduleId: module.id, status: "failed", error: "执行超时", duration: Date.now() - module.startedAt! });
    }, MODULE_TIMEOUT_MS);

    worker.on("message", (result: ModuleResult) => {
      clearTimeout(timeout);
      // 主进程更新计划状态
      const m = plan.modules.find(x => x.id === module.id)!;
      m.status = result.status;
      m.note = result.note;
      m.completedAt = Date.now();
      savePlan(plan);
      resolve(result);
    });
  });
}
```

---

## 持久化

```
.cehnzcode/
  ├── CLAUDE.md                    # 项目级指令，讨论和规划阶段都会注入
  ├── plans/
  │   ├── plan_20260509_001.json    # 计划文件（含所有模块定义和状态）
  │   └── active.json              # 当前活跃计划的 ID
  └── notes/
      ├── module_001.md            # 模块笔记（供人工阅读）
      ├── module_001.json          # 模块笔记（程序内部使用）
      ├── module_001.test.ts       # 模块接口测试（validateNote 阶段生成）
      └── ...
```

测试文件属于计划系统的产物，与任务代码隔离，不放入任务项目的目录。端到端测试阶段直接收集 `.cehnzcode/notes/` 下所有 `*.test.ts` 统一运行。

讨论会话本身**不做持久化**——讨论是一次性过程，未完成的讨论不需要恢复。已完成的讨论历史只在 createPlan 调用瞬间被使用，之后即可丢弃。

---

## 错误处理

### 模块失败策略

1. **关键模块失败**（其他模块 dependsOn 它）：暂停计划，等待人工介入或重试
2. **非关键模块失败**：标记 failed，跳过所有 dependsOn 它的模块，继续执行其余模块
3. **validateNote 失败**：视为模块失败，触发重试，重试时带入具体失败原因

### 修复策略

测试失败或验证失败时，优先在当前对话内修复，不重开实现：

**对话内修复**（优先）：把错误信息追加到当前对话历史，继续发给模型修复。模型在已有实现的基础上定点修改，不从头重写。

**重开实现**（兜底）：对话轮次超过上限仍未修复时，清空对话历史，重新开始实现。把上次失败原因带入新对话的 prompt 开头：

```
## 上次执行失败的原因
${failureReason}

请在实现时注意避免上述问题。
```

---

## 命令集成

### 两种入口模式

**讨论模式**：`/plan` 不带参数，切换到 plan 讨论模式。系统创建独立的 `PlanDiscussionSession`，加载项目 CLAUDE.md 注入到系统提示词。用户和模型进行多轮自然对话，模型扮演任务规划顾问。

讨论结束有两条路径：
- **语义自动结束**（主路径）：模型在回复末尾输出 `[READY_TO_PLAN]` 标记时，系统检测到该标记，去除标记后展示模型的总结回复，立即进入 createPlan
- **指令强制结束**（兜底）：用户输入 `/plan confirm`，立即进入 createPlan

无论哪条路径，传入 createPlan 的都是完整的讨论历史。

**直接模式**：`/plan <任务描述>` 带参数，跳过讨论直接触发 createPlan，任务描述作为输入。

两种模式在 createPlan 之后的流程完全相同。

### /plan 命令

```typescript
// src/commands/builtins/plan.ts

const READY_MARKER = "[READY_TO_PLAN]";

export const planCommand: CommandDefinition = {
  name: "plan",
  description: "创建并执行模块化任务计划",
  async execute(args, ctx) {
    if (!args) {
      // 讨论模式：创建独立讨论会话
      const projectInstructions = await loadProjectInstructions(ctx);
      const discussion = ctx.planner.createDiscussionSession({ projectInstructions });
      ctx.session.setMode("plan-discussion", { discussion });
      ctx.ui.showMessage("已进入 plan 讨论模式。直接描述你想完成的任务，或继续追问以澄清需求。");
      return;
    }

    // 直接模式：args 作为任务描述直接生成计划
    await runPlan({ task: args, discussionHistory: [] }, ctx);
  },
};

// 讨论模式下，每一轮用户输入都经过此处理函数（由 session 的 mode 派发）
export async function handlePlanDiscussionInput(userInput: string, ctx: CommandContext) {
  const discussion = ctx.session.getModeData<PlanDiscussionSession>("discussion");
  const projectInstructions = await loadProjectInstructions(ctx);

  const { reply, readyToPlan } = await discussion.send(userInput, {
    projectRoot: ctx.projectRoot,
    projectInstructions,
  });

  // 展示模型回复时移除结束标记，仅保留自然语言部分
  const displayReply = reply.replace(new RegExp(`\\s*${escapeRegex(READY_MARKER)}\\s*$`), "").trimEnd();
  ctx.ui.showAssistantMessage(displayReply);

  if (readyToPlan) {
    ctx.ui.showMessage("讨论结束，正在基于讨论内容生成计划...");
    ctx.session.setMode("normal");
    await runPlan({ task: null, discussionHistory: discussion.getHistory() }, ctx);
  }
}

export const planConfirmCommand: CommandDefinition = {
  name: "plan confirm",
  description: "强制结束当前讨论并生成计划",
  async execute(args, ctx) {
    if (ctx.session.getMode() !== "plan-discussion") {
      ctx.ui.showMessage("当前不在 plan 讨论模式，请先输入 /plan 开始讨论。");
      return;
    }

    const discussion = ctx.session.getModeData<PlanDiscussionSession>("discussion");
    ctx.session.setMode("normal");
    await runPlan({ task: null, discussionHistory: discussion.getHistory() }, ctx);
  },
};

async function runPlan(input: PlanInput, ctx: CommandContext) {
  const planner = ctx.planner;

  // 1. 生成并验证计划
  ctx.ui.showStatus("正在分析任务并创建计划...");
  const projectInstructions = await loadProjectInstructions(ctx);
  const plan = await planner.createPlan(input, {
    projectRoot: ctx.projectRoot,
    projectInstructions,
  });

  // 2. 展示计划，等待用户确认
  ctx.ui.showPlan(plan);
  ctx.ui.showMessage("请确认模块划分、依赖关系和接口定义是否合理。");

  const confirm = await ctx.ui.confirm("是否开始执行此计划？");
  if (!confirm) {
    await planner.savePlan(plan, `.cehnzcode/plans/${plan.id}.json`);
    ctx.ui.showMessage("计划已保存，使用 /plan resume 继续执行");
    return;
  }

  // 3. 执行计划
  ctx.ui.showStatus("开始执行计划...");
  for await (const result of planner.executePlan(plan)) {
    ctx.ui.showModuleResult(result);
  }

  ctx.ui.showSuccess("计划执行完成！");
}

// 从项目根目录读取 .cehnzcode/CLAUDE.md（或系统级 CLAUDE.md），不存在时返回 undefined
async function loadProjectInstructions(ctx: CommandContext): Promise<string | undefined> {
  // 实现略：读取 .cehnzcode/CLAUDE.md，或回退到系统级配置
}
```

**讨论模式下用户输入的派发**：

普通模式下用户输入走 `handleUserInput`；进入 `plan-discussion` 模式后，用户输入派发到 `handlePlanDiscussionInput`。session 的模式机制需要支持这种路由切换，模式数据（discussion 实例）随模式一起保存。

`/plan confirm` 是命令，不会被当作普通讨论输入；命令派发优先级高于模式输入处理。

### /plan 子命令

- `/plan` — 进入讨论模式，与模型讨论任务需求
- `/plan <任务描述>` — 直接模式，跳过讨论立即生成计划
- `/plan confirm` — 讨论模式下强制结束讨论，触发计划生成（兜底路径，正常情况下由模型语义判断自动触发）
- `/plan list` — 列出所有保存的计划
- `/plan resume <plan-id>` — 恢复执行中断的计划（running 状态的模块重新执行，done 的跳过）
- `/plan show <plan-id>` — 查看计划详情（含模块状态和笔记）
- `/plan cancel` — 取消当前执行的计划（讨论模式下取消讨论）

---

## UI 展示

### 讨论模式界面

```
> /plan
已进入 plan 讨论模式。直接描述你想完成的任务，或继续追问以澄清需求。

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

[READY_TO_PLAN]

讨论结束，正在基于讨论内容生成计划...
```

注意：`[READY_TO_PLAN]` 标记是模型实际输出的内容，但在 UI 展示给用户时应被移除。上面示例同时显示了模型输出与标记移除前的形态，仅用于说明机制；实际界面里用户看到的最后一行是 `> 可以` 之后的总结，标记不可见。

### 计划确认界面

```
📋 任务计划

任务: 重构用户认证模块，使用 JWT 替换 session
预估耗时: 30 分钟 | 复杂度: 中等

模块列表:
  1. ⏸ 分析现有 session 实现
     对外接口: sessionConfig（现有配置结构）
  2. ⏸ 实现 JWT 工具函数
     依赖: 无  |  对外接口: verifyToken, generateToken, UserId
  3. ⏸ 修改登录/登出接口
     依赖: 模块2  |  使用: verifyToken, generateToken
  4. ⏸ 修改认证中间件
     依赖: 模块2  |  使用: verifyToken
  5. ⏸ 更新路由层注册
     依赖: 模块4  |  使用: authMiddleware
  6. ⏸ 更新测试用例
     依赖: 模块2,3,4

请确认依赖关系和接口定义是否完整。
是否开始执行？(y/n)
```

### 执行过程展示

```
执行中... [████████░░] 60%

✓ 模块 1: 分析现有 session 实现 (3.2s)
✓ 模块 2: 实现 JWT 工具函数 (8.5s)
  ✓ 测试通过: module_002.test.ts
→ 模块 3: 修改登录/登出接口 (正在实现...)
→ 模块 4: 修改认证中间件 (正在实现...)
⏸ 模块 5: 更新路由层注册 (等待模块 4)
⏸ 模块 6: 更新测试用例 (等待模块 2,3,4)

图例: ✓ 完成  → 进行中  ⏸ 等待  ✗ 失败
```

---

## 实现文件结构

```
src/planner/
  ├── types.ts                   # 类型定义
  ├── index.ts                   # TaskPlanner 主实现
  ├── discussion.ts              # PlanDiscussionSession 实现（讨论会话管理 + 结束标记检测）
  ├── executor.ts                # 执行调度（主进程）
  ├── module-worker.ts           # 模块执行（子进程）
  ├── dependency-graph.ts        # 依赖图构建与分析
  ├── note-manager.ts            # 笔记读写与验证
  ├── validator.ts               # validateNote 四步验证
  ├── persistence.ts             # 计划持久化
  └── test/
      └── test-planner.ts        # planner 模块自身的集成测试

src/prompts/
  ├── plan-discussion.ts         # 讨论阶段系统提示词
  ├── plan-creation.ts           # createPlan 提示词
  ├── plan-validation.ts         # 供需匹配验证提示词
  ├── module-execution.ts        # executeModule 提示词
  └── test-generation.ts         # 测试生成提示词

src/commands/builtins/
  └── plan.ts                    # /plan 命令、讨论模式输入处理、/plan confirm
```

---

## 已知待完善项

**1. outputContract.files 重叠检测**

计划生成后应自动检查所有模块声明的文件路径是否有重叠，有重叠的模块应强制设为串行（加入 dependsOn）。这个校验尚未在 createPlan 验证阶段实现。

**2. 端到端测试失败的模块定位**

端到端测试失败时，需要将测试报错映射回具体的责任模块。目前的方案是依赖测试文件的命名（`test-<module-id>.ts`）来定位，但跨模块的集成问题可能涉及多个模块，定位逻辑需要进一步设计。

**3. 跨模块文件修改的回滚**

模块执行失败时可能已经修改了部分文件，目前没有回滚机制。需要结合 outputContract 声明的文件列表，在模块开始前做快照，失败时恢复。

**4. 讨论模式的结束标记鲁棒性**

模型偶尔可能：
- 在讨论尚未充分时过早输出 `[READY_TO_PLAN]`
- 把标记拼写错误或放在回复中间而不是末尾
- 把标记包裹在代码块或引号里导致检测失败

当前依赖 prompt 约束 + 正则末尾匹配。后续可考虑：标记位置容错（允许在最后一段任意位置）、提供独立的"撤回"指令让用户在标记被误触发时回到讨论模式。
