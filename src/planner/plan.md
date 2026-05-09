# Task Planner — 任务分解与步骤执行

## 目标

给定一个复杂任务，模型能够自主创建一个步骤流程（plan），然后按照这个流程一步一步执行，最终完成任务。

## 核心概念

### Plan（计划）
一个 Plan 包含：
- 任务描述
- 分解后的步骤列表
- 步骤之间的依赖关系
- 执行状态

### Step（步骤）
每个 Step 包含：
- 步骤描述
- 依赖的前置步骤
- 执行状态（pending/running/done/failed）
- 执行结果

### 执行模式
- **顺序执行**：按依赖关系顺序执行
- **并行执行**：无依赖关系的步骤可并行
- **失败重试**：步骤失败时可重试或跳过

## 接口设计

```typescript
// src/planner/types.ts

interface TaskPlanner {
  /**
   * 创建任务计划
   * @param task 任务描述
   * @param context 上下文信息（可选）
   * @returns 生成的计划
   */
  createPlan(task: string, context?: PlanContext): Promise<TaskPlan>;
  
  /**
   * 执行计划
   * @param plan 要执行的计划
   * @returns 异步生成器，逐步返回执行结果
   */
  executePlan(plan: TaskPlan): AsyncGenerator<StepResult>;
  
  /**
   * 暂停执行
   */
  pause(): void;
  
  /**
   * 恢复执行
   */
  resume(): void;
  
  /**
   * 取消执行
   */
  cancel(): void;
  
  /**
   * 保存计划到文件
   */
  savePlan(plan: TaskPlan, path: string): Promise<void>;
  
  /**
   * 从文件加载计划
   */
  loadPlan(path: string): Promise<TaskPlan>;
  
  /**
   * 获取当前执行状态
   */
  getStatus(): PlanStatus;
}

interface TaskPlan {
  id: string;
  task: string;                    // 原始任务描述
  description: string;             // 任务详细说明
  steps: Step[];
  status: PlanStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  metadata: PlanMetadata;
}

interface Step {
  id: string;
  index: number;                   // 步骤序号（用于显示）
  description: string;             // 步骤描述
  action: StepAction;              // 要执行的动作
  dependencies: string[];          // 依赖的步骤 ID
  status: StepStatus;
  result?: StepResult;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

interface StepAction {
  type: "tool_call" | "model_query" | "user_input" | "validation";
  payload: Record<string, unknown>;
}

type StepStatus = "pending" | "ready" | "running" | "done" | "failed" | "skipped";
type PlanStatus = "draft" | "ready" | "running" | "paused" | "completed" | "failed" | "cancelled";

interface StepResult {
  stepId: string;
  status: StepStatus;
  output?: string;
  error?: string;
  duration: number;              // 执行耗时（毫秒）
}

interface PlanContext {
  projectRoot?: string;
  relevantFiles?: string[];
  constraints?: string[];        // 约束条件，如"不要修改 package.json"
}

interface PlanMetadata {
  estimatedDuration?: number;    // 预估耗时（分钟）
  complexity: "simple" | "medium" | "complex";
  tags: string[];                // 如 ["refactor", "bug-fix"]
}
```

## 工作流程

### 1. 创建计划阶段

```
用户输入任务
    ↓
调用模型分解任务
    ↓
生成步骤列表 + 依赖关系
    ↓
验证计划合理性
    ↓
返回 TaskPlan
```

**Prompt 设计**：

```typescript
const PLAN_CREATION_PROMPT = `
你是一个任务规划专家。给定一个任务，你需要将其分解为可执行的步骤。

## 任务
${task}

## 上下文
${context}

## 要求
1. 将任务分解为 3-10 个清晰的步骤
2. 每个步骤应该是原子性的、可验证的
3. 明确步骤之间的依赖关系
4. 为每个步骤指定执行动作（工具调用、模型查询、用户输入等）

## 输出格式
返回 JSON 格式的计划：
{
  "description": "任务的详细说明",
  "steps": [
    {
      "description": "步骤描述",
      "action": {
        "type": "tool_call",
        "payload": { "tool": "read_file", "args": {...} }
      },
      "dependencies": []  // 依赖的步骤索引
    }
  ],
  "metadata": {
    "estimatedDuration": 10,
    "complexity": "medium",
    "tags": ["refactor"]
  }
}
`;
```

### 2. 执行计划阶段

```
加载计划
    ↓
构建依赖图
    ↓
循环执行：
  - 找到所有 ready 状态的步骤（依赖已满足）
  - 并行执行这些步骤
  - 更新步骤状态
  - 检查是否有新的 ready 步骤
    ↓
所有步骤完成 → 返回结果
```

**执行器伪代码**：

```typescript
async function* executePlan(plan: TaskPlan): AsyncGenerator<StepResult> {
  const graph = buildDependencyGraph(plan.steps);
  
  while (hasUnfinishedSteps(plan)) {
    // 找到所有可执行的步骤（依赖已满足）
    const readySteps = plan.steps.filter(step => 
      step.status === "pending" && 
      allDependenciesDone(step, plan)
    );
    
    if (readySteps.length === 0) {
      // 没有可执行的步骤，检查是否死锁
      if (hasRunningSteps(plan)) {
        await sleep(100);
        continue;
      } else {
        throw new Error("计划执行死锁：存在未完成的步骤但无法继续");
      }
    }
    
    // 并行执行所有 ready 步骤
    const results = await Promise.allSettled(
      readySteps.map(step => executeStep(step, plan))
    );
    
    // 逐个返回结果
    for (const result of results) {
      yield result.value;
    }
  }
}

async function executeStep(step: Step, plan: TaskPlan): Promise<StepResult> {
  step.status = "running";
  step.startedAt = Date.now();
  
  try {
    let output: string;
    
    switch (step.action.type) {
      case "tool_call":
        output = await executeToolCall(step.action.payload);
        break;
      case "model_query":
        output = await queryModel(step.action.payload);
        break;
      case "user_input":
        output = await promptUser(step.description);
        break;
      case "validation":
        output = await validateCondition(step.action.payload);
        break;
    }
    
    step.status = "done";
    step.result = {
      stepId: step.id,
      status: "done",
      output,
      duration: Date.now() - step.startedAt!,
    };
    
    return step.result;
  } catch (error) {
    step.status = "failed";
    step.error = error.message;
    step.result = {
      stepId: step.id,
      status: "failed",
      error: error.message,
      duration: Date.now() - step.startedAt!,
    };
    
    // 根据配置决定是否继续执行
    if (step.critical) {
      throw error;  // 关键步骤失败，终止整个计划
    }
    
    return step.result;
  } finally {
    step.completedAt = Date.now();
  }
}
```

## 命令集成

### /plan 命令

```typescript
// src/commands/builtins/plan.ts

export const planCommand: CommandDefinition = {
  name: "plan",
  description: "创建并执行任务计划",
  async execute(args, ctx) {
    const planner = ctx.planner;
    
    // 创建计划
    ctx.ui.showStatus("正在分析任务并创建计划...");
    const plan = await planner.createPlan(args);
    
    // 显示计划
    ctx.ui.showPlan(plan);
    
    // 询问是否执行
    const confirm = await ctx.ui.confirm("是否开始执行此计划？");
    if (!confirm) {
      ctx.ui.showMessage("计划已保存，使用 /plan resume 继续执行");
      await planner.savePlan(plan, `.cehnzcode/plans/${plan.id}.json`);
      return;
    }
    
    // 执行计划
    ctx.ui.showStatus("开始执行计划...");
    for await (const result of planner.executePlan(plan)) {
      ctx.ui.showStepResult(result);
    }
    
    ctx.ui.showSuccess("计划执行完成！");
  },
};
```

### /plan 子命令

- `/plan <任务描述>` - 创建并执行计划
- `/plan list` - 列出所有保存的计划
- `/plan resume <plan-id>` - 恢复执行计划
- `/plan show <plan-id>` - 查看计划详情
- `/plan cancel` - 取消当前执行的计划

## UI 展示

### 计划展示

```
📋 任务计划

任务: 重构用户认证模块，使用 JWT 替换 session

预估耗时: 30 分钟
复杂度: 中等

步骤:
  1. ✓ 读取当前认证代码 (src/auth/)
  2. ✓ 分析现有 session 实现
  3. → 安装 jsonwebtoken 依赖
  4. ⏸ 创建 JWT 工具函数
  5. ⏸ 修改登录接口
  6. ⏸ 修改认证中间件
  7. ⏸ 更新测试用例
  8. ⏸ 运行测试验证

图例: ✓ 完成  → 进行中  ⏸ 等待  ✗ 失败

是否开始执行？(y/n)
```

### 执行过程展示

```
执行中... [████████░░] 60%

✓ 步骤 1: 读取当前认证代码 (2.3s)
✓ 步骤 2: 分析现有 session 实现 (5.1s)
→ 步骤 3: 安装 jsonwebtoken 依赖
  正在运行: npm install jsonwebtoken
  
⏸ 步骤 4: 创建 JWT 工具函数 (等待步骤 3)
⏸ 步骤 5: 修改登录接口 (等待步骤 4)
```

## 持久化

计划保存在 `.cehnzcode/plans/` 目录：

```
.cehnzcode/
  └── plans/
      ├── plan_20260509_001.json
      ├── plan_20260509_002.json
      └── active.json              # 当前活跃的计划
```

JSON 格式：

```json
{
  "id": "plan_20260509_001",
  "task": "重构用户认证模块",
  "description": "使用 JWT 替换 session",
  "steps": [...],
  "status": "running",
  "createdAt": 1715270400000,
  "startedAt": 1715270450000,
  "metadata": {
    "estimatedDuration": 30,
    "complexity": "medium",
    "tags": ["refactor", "auth"]
  }
}
```

## 错误处理

### 步骤失败策略

1. **关键步骤失败**：终止整个计划，保存状态
2. **非关键步骤失败**：标记为 failed，继续执行后续步骤
3. **依赖步骤失败**：跳过所有依赖它的步骤

### 重试机制

```typescript
interface Step {
  // ...
  retryConfig?: {
    maxRetries: number;
    currentRetry: number;
    retryDelay: number;  // 毫秒
  };
}
```

## 实现文件

```
src/planner/
  ├── plan.md                    # 本方案文档
  ├── types.ts                   # 类型定义
  ├── index.ts                   # TaskPlanner 主实现
  ├── executor.ts                # 步骤执行器
  ├── dependency-graph.ts        # 依赖图构建与分析
  ├── persistence.ts             # 计划持久化
  └── prompts.ts                 # 计划生成的 prompt

src/commands/builtins/
  └── plan.ts                    # /plan 命令
```

## 测试计划

```typescript
// src/planner/test-planner.ts

async function testPlanner() {
  const planner = new TaskPlanner(config);
  
  // 测试简单任务
  const simplePlan = await planner.createPlan("创建一个 hello.txt 文件");
  console.log("简单任务步骤数:", simplePlan.steps.length);
  
  // 测试复杂任务
  const complexPlan = await planner.createPlan(
    "重构用户认证模块，使用 JWT 替换 session"
  );
  console.log("复杂任务步骤数:", complexPlan.steps.length);
  
  // 测试执行
  for await (const result of planner.executePlan(simplePlan)) {
    console.log(`步骤 ${result.stepId}: ${result.status}`);
  }
  
  // 测试持久化
  await planner.savePlan(complexPlan, ".cehnzcode/plans/test.json");
  const loaded = await planner.loadPlan(".cehnzcode/plans/test.json");
  console.log("加载的计划:", loaded.id);
}
```

## 未来扩展

1. **可视化**：生成 Mermaid 流程图展示计划
2. **模板系统**：预定义常见任务的计划模板
3. **学习优化**：根据历史执行记录优化计划生成
4. **协作模式**：多个 agent 协作执行不同步骤
5. **回滚机制**：步骤失败时自动回滚已执行的操作
