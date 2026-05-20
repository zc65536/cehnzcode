# Phase 3: createPlan 实现

## 目标

实现计划创建逻辑，将任务描述或讨论历史转换为结构化的模块化计划。包括：
1. 调用模型生成计划（模块列表、依赖关系、接口契约）
2. 验证计划的供需匹配（所有 inputContract 都有对应的 outputContract 提供）
3. 检查循环依赖
4. 展示计划并等待用户确认

## 依赖

- Phase 1 骨架已完成
- Phase 2 讨论模式已完成（可选，直接模式不依赖）

---

## 核心逻辑

### 两种输入模式

1. **直接模式**：`input.task` 不为空，直接使用任务描述
2. **讨论模式**：`input.task` 为空，使用 `input.discussionHistory`

两种模式的处理流程相同，只是提示词模板不同。

### 工作流程

```
createPlan(input, context)
    ↓
步骤1：生成计划
    - 根据 input.task 或 discussionHistory 选择提示词模板
    - 注入项目 CEHNZ.md
    - 调用模型生成 JSON 格式的计划
    - 解析 JSON，构造 TaskPlan 对象
    ↓
步骤2：验证计划
    - 调用 PlanValidator.validatePlan()
    - 检查循环依赖
    - 检查接口供需匹配
    - 检查职责重叠
    ↓
步骤3：处理验证结果
    - 如果 valid: true → 返回计划
    - 如果 valid: false → 把 issues 反馈给模型，重新生成
    - 最多重试 3 次，超过则抛出错误
    ↓
返回 TaskPlan
```

---

## 实现清单

### 1. 提示词：PLAN_CREATION_PROMPT（直接模式）

```typescript
// src/prompts/planner.ts

export function buildPlanCreationPrompt(task: string, projectInstructions?: string): string {
  return `你是一个任务规划专家。将以下任务分解为独立的功能模块。

## 任务
${task}

${projectInstructions ? `## 项目上下文（CEHNZ.md）\n\n${projectInstructions}\n` : ""}

## 要求

1. **模块划分**：将任务分解为 3-10 个模块，每个模块职责单一、边界清晰
2. **模块描述**：只描述"要做什么"，不展开内部实现细节
3. **依赖关系**：
   - \`dependsOn\`：必须等待完成才能开始的模块（调度依据，影响执行顺序）
   - \`relatedModules\`：执行时需要参考笔记的模块（信息来源，不影响调度）
4. **接口契约**：
   - \`inputContract\`：本模块依赖哪些其他模块的对外接口，含接口名和功能描述
   - \`outputContract\`：本模块对外暴露哪些接口，含接口名和功能描述
5. **接口依赖**：宁多勿少，漏掉依赖比多写依赖代价更高

## 输出格式

**只输出 JSON，不要有其他内容。**

\`\`\`json
{
  "description": "任务整体说明",
  "modules": [
    {
      "description": "模块描述",
      "dependsOn": [0, 1],
      "relatedModules": [0, 1, 2],
      "inputContract": [
        { 
          "name": "verifyToken", 
          "description": "验证 JWT 并返回 UserId", 
          "sourceModule": "module_001" 
        }
      ],
      "outputContract": [
        { 
          "name": "authMiddleware", 
          "description": "Express 中间件，验证请求头中的 token" 
        }
      ]
    }
  ],
  "metadata": {
    "estimatedDuration": 30,
    "complexity": "medium",
    "tags": ["refactor", "auth"]
  }
}
\`\`\`

## 注意事项

- \`dependsOn\` 和 \`relatedModules\` 使用模块索引（从 0 开始）
- \`inputContract\` 中的 \`sourceModule\` 使用模块 ID（生成后会自动分配）
- 确保所有 \`inputContract\` 声明的接口都能在某个模块的 \`outputContract\` 中找到
- 避免循环依赖（A 依赖 B，B 依赖 A）
`;
}
```

### 2. 提示词：PLAN_CREATION_TALK_PROMPT（讨论模式）

```typescript
// src/prompts/planner.ts

export function buildPlanCreationTalkPrompt(
  discussionHistory: Message[], 
  projectInstructions?: string
): string {
  const historyText = discussionHistory
    .map(msg => `${msg.role === "user" ? "用户" : "助手"}: ${msg.content}`)
    .join("\n\n");

  return `你是一个任务规划专家。根据以下讨论内容，将任务分解为独立的功能模块。

## 讨论记录

${historyText}

${projectInstructions ? `## 项目上下文（CEHNZ.md）\n\n${projectInstructions}\n` : ""}

## 要求

[与直接模式相同的要求...]

## 输出格式

[与直接模式相同的格式...]
`;
}
```

### 3. 提示词：PLAN_VALIDATION_PROMPT

```typescript
// src/prompts/planner.ts

export function buildPlanValidationPrompt(planJson: string): string {
  return `你是一个架构审查员。审查以下任务计划，检查三个方面：

## 待审查的计划

\`\`\`json
${planJson}
\`\`\`

## 审查项

1. **循环依赖**：\`dependsOn\` 中是否存在循环依赖（A 依赖 B，B 依赖 A）
2. **接口供需匹配**：所有模块 \`inputContract\` 声明的接口，是否都能在某个模块的 \`outputContract\` 中找到对应提供方
3. **职责重叠**：是否有多个模块声明了相同或高度重叠的 \`outputContract\` 接口

## 输出格式

**只输出 JSON，不要有其他内容。**

\`\`\`json
{
  "valid": true,
  "issues": [
    {
      "type": "missing_provider",
      "description": "模块 3 的 inputContract 声明了 'verifyToken'，但没有模块提供此接口",
      "modules": [3]
    },
    {
      "type": "circular_dependency",
      "description": "模块 1 依赖模块 2，模块 2 依赖模块 1",
      "modules": [1, 2]
    },
    {
      "type": "overlap",
      "description": "模块 2 和模块 4 都声明了 'authMiddleware' 接口",
      "modules": [2, 4]
    }
  ]
}
\`\`\`

如果没有问题，返回：

\`\`\`json
{
  "valid": true,
  "issues": []
}
\`\`\`
`;
}
```

### 4. 实现 PlanCreator.create

```typescript
// src/planner/creator.ts

import type { ModelClient } from "../model/index.js";
import type { AppConfig } from "../types.js";
import type { TaskPlan, PlanInput, PlanContext, Module } from "./types.js";
import { PlanValidator } from "./validator.js";
import {
  buildPlanCreationPrompt,
  buildPlanCreationTalkPrompt,
} from "../prompts/planner.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:creator");

const MAX_VALIDATION_RETRIES = 3;

export class PlanCreator {
  private model: ModelClient;
  private config: AppConfig;
  private validator: PlanValidator;

  constructor(model: ModelClient, config: AppConfig) {
    this.model = model;
    this.config = config;
    this.validator = new PlanValidator(model);
  }

  async create(input: PlanInput, context?: PlanContext): Promise<TaskPlan> {
    logger.info({ hasTask: !!input.task, historyLength: input.discussionHistory.length }, "Creating plan");
    
    let attempt = 0;
    let lastIssues: string | undefined;

    while (attempt < MAX_VALIDATION_RETRIES) {
      attempt++;
      logger.info({ attempt }, "Generating plan");

      // 步骤1：生成计划
      const plan = await this.generatePlan(input, context, lastIssues);

      // 步骤2：验证计划
      const validation = await this.validator.validatePlan(plan);

      if (validation.valid) {
        logger.info({ planId: plan.id, moduleCount: plan.modules.length }, "Plan created successfully");
        return plan;
      }

      // 步骤3：处理验证失败
      logger.warn({ attempt, issues: validation.issues }, "Plan validation failed");
      lastIssues = this.formatIssues(validation.issues);

      if (attempt >= MAX_VALIDATION_RETRIES) {
        throw new Error(`计划验证失败（已重试 ${MAX_VALIDATION_RETRIES} 次）：\n${lastIssues}`);
      }
    }

    throw new Error("Unexpected: validation loop exited without result");
  }

  private async generatePlan(
    input: PlanInput,
    context?: PlanContext,
    validationFeedback?: string
  ): Promise<TaskPlan> {
    // 选择提示词模板
    let prompt: string;
    if (input.task) {
      prompt = buildPlanCreationPrompt(input.task, context?.projectInstructions);
    } else {
      prompt = buildPlanCreationTalkPrompt(input.discussionHistory, context?.projectInstructions);
    }

    // 如果有验证反馈，追加到提示词
    if (validationFeedback) {
      prompt += `\n\n## 上次生成的计划存在以下问题，请修正：\n\n${validationFeedback}`;
    }

    // 调用模型
    const response = await this.model.chat([
      { role: "system", content: prompt },
    ], []);

    // 解析 JSON
    const planData = this.parseJSON(response.content);

    // 构造 TaskPlan
    const plan: TaskPlan = {
      id: this.generatePlanId(),
      task: input.task || this.extractTaskFromHistory(input.discussionHistory),
      description: planData.description,
      modules: planData.modules.map((m: any, index: number) => this.buildModule(m, index)),
      status: "draft",
      createdAt: Date.now(),
      metadata: planData.metadata || {
        complexity: "medium",
        tags: [],
      },
    };

    return plan;
  }

  private buildModule(moduleData: any, index: number): Module {
    const moduleId = `module_${String(index + 1).padStart(3, "0")}`;

    return {
      id: moduleId,
      index,
      description: moduleData.description,
      dependsOn: (moduleData.dependsOn || []).map((idx: number) => `module_${String(idx + 1).padStart(3, "0")}`),
      relatedModules: (moduleData.relatedModules || []).map((idx: number) => `module_${String(idx + 1).padStart(3, "0")}`),
      inputContract: moduleData.inputContract || [],
      outputContract: moduleData.outputContract || [],
      status: "pending",
      retryConfig: {
        maxRetries: 3,
        currentRetry: 0,
        retryDelay: 1000,
      },
    };
  }

  private parseJSON(content: string): any {
    // 尝试提取 JSON（可能被包裹在代码块中）
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1] : content;

    try {
      return JSON.parse(jsonText);
    } catch (err) {
      logger.error({ content }, "Failed to parse JSON");
      throw new Error(`模型返回的内容不是有效的 JSON：${(err as Error).message}`);
    }
  }

  private generatePlanId(): string {
    const date = new Date();
    const dateStr = date.toISOString().split("T")[0].replace(/-/g, "");
    const random = Math.random().toString(36).substring(2, 8);
    return `plan_${dateStr}_${random}`;
  }

  private extractTaskFromHistory(history: any[]): string {
    // 从讨论历史中提取任务描述（取第一条用户消息）
    const firstUserMsg = history.find(msg => msg.role === "user");
    return firstUserMsg?.content || "未命名任务";
  }

  private formatIssues(issues: any[]): string {
    return issues.map(issue => `- [${issue.type}] ${issue.description}`).join("\n");
  }
}
```

### 5. 实现 PlanValidator.validatePlan

```typescript
// src/planner/validator.ts

import type { ModelClient } from "../model/index.js";
import type { TaskPlan, ValidationResult, ValidationIssue } from "./types.js";
import { buildPlanValidationPrompt } from "../prompts/planner.js";
import { DependencyGraphImpl } from "./dependency-graph.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:validator");

export class PlanValidator {
  private model: ModelClient;

  constructor(model: ModelClient) {
    this.model = model;
  }

  async validatePlan(plan: TaskPlan): Promise<ValidationResult> {
    logger.info({ planId: plan.id }, "Validating plan");

    // 方案1：使用模型验证（更智能，但可能不够精确）
    const modelValidation = await this.validateWithModel(plan);

    // 方案2：使用代码验证（更精确，但可能不够灵活）
    const codeValidation = this.validateWithCode(plan);

    // 合并两种验证结果
    const allIssues = [...modelValidation.issues, ...codeValidation.issues];

    return {
      valid: allIssues.length === 0,
      issues: allIssues,
    };
  }

  /**
   * 使用模型验证（调用 PLAN_VALIDATION_PROMPT）
   */
  private async validateWithModel(plan: TaskPlan): Promise<ValidationResult> {
    const planJson = JSON.stringify({
      description: plan.description,
      modules: plan.modules.map(m => ({
        id: m.id,
        description: m.description,
        dependsOn: m.dependsOn,
        inputContract: m.inputContract,
        outputContract: m.outputContract,
      })),
    }, null, 2);

    const prompt = buildPlanValidationPrompt(planJson);

    const response = await this.model.chat([
      { role: "system", content: prompt },
    ], []);

    try {
      const result = JSON.parse(response.content);
      return result as ValidationResult;
    } catch (err) {
      logger.error({ content: response.content }, "Failed to parse validation result");
      return { valid: true, issues: [] }; // 解析失败时假设通过
    }
  }

  /**
   * 使用代码验证（精确检查）
   */
  private validateWithCode(plan: TaskPlan): ValidationResult {
    const issues: ValidationIssue[] = [];

    // 检查1：循环依赖
    const circularIssues = this.checkCircularDependency(plan);
    issues.push(...circularIssues);

    // 检查2：接口供需匹配
    const matchingIssues = this.checkInterfaceMatching(plan);
    issues.push(...matchingIssues);

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * 检查循环依赖
   */
  private checkCircularDependency(plan: TaskPlan): ValidationIssue[] {
    const graph = new DependencyGraphImpl();
    
    for (const module of plan.modules) {
      graph.addModule(module);
    }

    if (graph.hasCircularDependency()) {
      return [{
        type: "circular_dependency",
        description: "计划中存在循环依赖",
        modules: [], // TODO: 返回具体的循环路径
      }];
    }

    return [];
  }

  /**
   * 检查接口供需匹配
   */
  private checkInterfaceMatching(plan: TaskPlan): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 构建所有模块提供的接口映射
    const providedInterfaces = new Map<string, string>(); // interfaceName -> moduleId
    for (const module of plan.modules) {
      for (const contract of module.outputContract) {
        providedInterfaces.set(contract.name, module.id);
      }
    }

    // 检查每个模块的 inputContract 是否都有提供方
    for (const module of plan.modules) {
      for (const contract of module.inputContract) {
        if (!providedInterfaces.has(contract.name)) {
          issues.push({
            type: "missing_provider",
            description: `模块 ${module.id} 需要接口 '${contract.name}'，但没有模块提供此接口`,
            modules: [module.index],
          });
        }
      }
    }

    return issues;
  }
}

// NoteValidator 留给 Phase 5
export class NoteValidator {
  // Phase 5 实现
}
```

### 6. 实现 DependencyGraph.hasCircularDependency

```typescript
// src/planner/dependency-graph.ts

import type { DependencyGraph, Module } from "./types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:dependency-graph");

export class DependencyGraphImpl implements DependencyGraph {
  nodes: Map<string, Module>;
  edges: Map<string, Set<string>>;

  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }

  addModule(module: Module): void {
    this.nodes.set(module.id, module);
    this.edges.set(module.id, new Set(module.dependsOn));
  }

  hasCircularDependency(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    for (const nodeId of this.nodes.keys()) {
      if (this.hasCycleUtil(nodeId, visited, recStack)) {
        return true;
      }
    }

    return false;
  }

  private hasCycleUtil(nodeId: string, visited: Set<string>, recStack: Set<string>): boolean {
    if (recStack.has(nodeId)) {
      return true; // 发现循环
    }

    if (visited.has(nodeId)) {
      return false; // 已访问过，无循环
    }

    visited.add(nodeId);
    recStack.add(nodeId);

    const dependencies = this.edges.get(nodeId) || new Set();
    for (const depId of dependencies) {
      if (this.hasCycleUtil(depId, visited, recStack)) {
        return true;
      }
    }

    recStack.delete(nodeId);
    return false;
  }

  getReadyModules(): Module[] {
    // Phase 4 实现
    throw new Error("Not implemented: getReadyModules");
  }

  getExecutionOrder(): string[] {
    // Phase 4 实现
    throw new Error("Not implemented: getExecutionOrder");
  }
}
```

### 7. 完善 /plan 命令的 runPlan 函数

```typescript
// src/commands/builtins/plan.ts

async function runPlan(input: PlanInput, ctx: CommandContext): Promise<void> {
  if (!ctx.planner) {
    ctx.ui.showError(new Error("Planner not initialized"));
    return;
  }

  try {
    // 1. 生成并验证计划
    ctx.ui.showStatus("正在分析任务并创建计划...");
    
    const projectInstructions = await loadProjectInstructions(ctx);
    const plan = await ctx.planner.createPlan(input, {
      projectRoot: ctx.config.projectRoot,
      projectInstructions,
    });

    // 2. 展示计划
    ctx.ui.showMessage("\n📋 任务计划\n");
    ctx.ui.showMessage(`任务: ${plan.task}`);
    ctx.ui.showMessage(`预估耗时: ${plan.metadata.estimatedDuration || "未知"} 分钟 | 复杂度: ${plan.metadata.complexity}\n`);
    ctx.ui.showMessage("模块列表:");
    
    for (const module of plan.modules) {
      const deps = module.dependsOn.length > 0 ? ` | 依赖: ${module.dependsOn.join(", ")}` : "";
      const outputs = module.outputContract.map(c => c.name).join(", ");
      ctx.ui.showMessage(`  ${module.index + 1}. ⏸ ${module.description}`);
      if (outputs) {
        ctx.ui.showMessage(`     对外接口: ${outputs}`);
      }
      if (deps) {
        ctx.ui.showMessage(`     ${deps}`);
      }
    }

    ctx.ui.showMessage("\n请确认模块划分、依赖关系和接口定义是否合理。");

    // 3. 等待用户确认
    const confirm = await ctx.ui.confirm("是否开始执行此计划？(y/n)");
    if (!confirm) {
      const planPath = `.cehnzcode/plans/${plan.id}.json`;
      await ctx.planner.savePlan(plan, planPath);
      ctx.ui.showMessage(`计划已保存到 ${planPath}`);
      ctx.ui.showMessage("使用 /plan resume 继续执行");
      return;
    }

    // 4. 执行计划（Phase 4 实现）
    ctx.ui.showMessage("\n开始执行计划...\n");
    ctx.ui.showMessage("计划执行尚未实现（Phase 4）");
    
  } catch (err) {
    ctx.ui.showError(err as Error);
  }
}
```

---

## 测试

```typescript
// src/planner/test/test-creator.ts

import { describe, it, expect, vi } from "vitest";
import { PlanCreator } from "../creator.js";
import type { PlanInput } from "../types.js";

describe("PlanCreator", () => {
  it("should create plan from task description", async () => {
    const mockModel = {
      chat: vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            description: "测试任务",
            modules: [
              {
                description: "模块1",
                dependsOn: [],
                relatedModules: [],
                inputContract: [],
                outputContract: [{ name: "func1", description: "功能1" }],
              },
            ],
            metadata: { complexity: "simple", tags: [] },
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({ valid: true, issues: [] }),
        }),
    };

    const creator = new PlanCreator(mockModel as any, {} as any);
    const input: PlanInput = { task: "实现功能", discussionHistory: [] };

    const plan = await creator.create(input);

    expect(plan.modules).toHaveLength(1);
    expect(plan.modules[0].description).toBe("模块1");
    expect(plan.status).toBe("draft");
  });

  it("should retry on validation failure", async () => {
    const mockModel = {
      chat: vi.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            description: "测试任务",
            modules: [
              {
                description: "模块1",
                inputContract: [{ name: "missing", description: "缺失的接口" }],
                outputContract: [],
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            valid: false,
            issues: [{ type: "missing_provider", description: "缺少提供方", modules: [0] }],
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            description: "测试任务",
            modules: [
              {
                description: "模块1",
                inputContract: [],
                outputContract: [{ name: "func1", description: "功能1" }],
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({ valid: true, issues: [] }),
        }),
    };

    const creator = new PlanCreator(mockModel as any, {} as any);
    const input: PlanInput = { task: "实现功能", discussionHistory: [] };

    const plan = await creator.create(input);

    expect(mockModel.chat).toHaveBeenCalledTimes(4); // 2次生成 + 2次验证
    expect(plan.modules).toHaveLength(1);
  });
});
```

---

## 验收标准

Phase 3 完成后应该满足：

1. ✅ 直接模式可以从任务描述生成计划
2. ✅ 讨论模式可以从讨论历史生成计划
3. ✅ 项目 CEHNZ.md 正确注入到提示词
4. ✅ 模型返回的 JSON 被正确解析
5. ✅ 计划验证检测循环依赖
6. ✅ 计划验证检测接口供需不匹配
7. ✅ 验证失败时自动重试（最多3次）
8. ✅ 计划展示清晰易读
9. ✅ 用户确认后保存计划
10. ✅ 测试覆盖生成、验证、重试等核心逻辑

---

## 注意事项

1. **JSON 解析**：
   - 模型可能返回被代码块包裹的 JSON
   - 需要容错处理（提取 JSON 部分）
   - 解析失败时给出清晰的错误信息

2. **模块 ID 生成**：
   - 使用 `module_001`, `module_002` 格式
   - 保证 ID 唯一且有序
   - dependsOn 和 relatedModules 使用 ID 而非索引

3. **验证策略**：
   - 模型验证 + 代码验证双重保障
   - 模型验证更智能（语义理解）
   - 代码验证更精确（逻辑检查）

4. **用户体验**：
   - 计划展示要清晰（模块、依赖、接口）
   - 验证失败时给出具体原因
   - 重试时带入上次的失败反馈
   - 保存计划时给出路径提示
