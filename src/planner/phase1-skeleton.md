# Phase 1: 骨架建设

## 目标

建立完整的模块骨架，为所有功能预留位置，确保架构清晰、接口完整。所有类型定义、接口、主要类都要创建，但实现可以是占位符（抛出 "Not implemented" 错误）。

## 核心原则

- **接口优先**：先定义所有接口，再实现
- **依赖注入**：模块之间通过接口解耦
- **可测试性**：每个模块都可以独立测试
- **扩展性**：后续阶段只需填充实现，不改变接口

---

## 文件结构

```
src/planner/
  ├── types.ts                   # 所有类型定义（完整实现）
  ├── index.ts                   # TaskPlanner 主类（骨架）
  ├── discussion.ts              # PlanDiscussionSession（骨架）
  ├── creator.ts                 # Plan 创建逻辑（骨架）
  ├── validator.ts               # Plan 和 Note 验证（骨架）
  ├── executor.ts                # 执行调度器（骨架）
  ├── module-worker.ts           # 模块执行子进程（骨架）
  ├── dependency-graph.ts        # 依赖图分析（骨架）
  ├── note-manager.ts            # 笔记管理（骨架）
  ├── persistence.ts             # 持久化（骨架）
  └── test/
      └── test-skeleton.ts       # 骨架测试

src/prompts/
  ├── planner.ts                 # 所有 planner 相关提示词（占位符）
  └── index.ts                   # 导出 planner 提示词

src/commands/builtins/
  └── plan.ts                    # /plan 命令（骨架）
```

---

## 实现清单

### 1. types.ts（完整实现）

定义所有类型，这是整个系统的契约：

```typescript
// src/planner/types.ts

import type { Message } from "../types.js";

// ============ 核心接口 ============

export interface TaskPlanner {
  // 讨论模式
  createDiscussionSession(context: PlanContext): PlanDiscussionSession;
  
  // 创建计划
  createPlan(input: PlanInput, context?: PlanContext): Promise<TaskPlan>;
  
  // 执行计划
  executePlan(plan: TaskPlan): AsyncGenerator<ModuleResult>;
  
  // 控制
  pause(): void;
  resume(): void;
  cancel(): void;
  
  // 持久化
  savePlan(plan: TaskPlan, path: string): Promise<void>;
  loadPlan(path: string): Promise<TaskPlan>;
  
  // 状态
  getStatus(): PlanStatus;
}

export interface PlanDiscussionSession {
  history: Message[];
  startedAt: number;
  
  // 发送用户消息，返回模型回复 + 是否准备好规划
  send(userInput: string, context: PlanContext): Promise<{
    reply: string;
    readyToPlan: boolean;
  }>;
  
  // 获取完整对话历史
  getHistory(): Message[];
}

// ============ 数据结构 ============

export interface TaskPlan {
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

export interface Module {
  id: string;
  index: number;
  description: string;
  
  // 调度依据：必须等待这些模块完成
  dependsOn: string[];
  
  // 上下文来源：执行时读取这些模块的笔记
  relatedModules: string[];
  
  // 接口契约
  inputContract: InterfaceContract[];
  outputContract: InterfaceContract[];
  
  // 执行结果
  note?: ModuleNote;
  notePath?: string;
  testPaths?: string[];
  
  // 状态
  status: ModuleStatus;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  
  // 重试配置
  retryConfig?: {
    maxRetries: number;
    currentRetry: number;
    retryDelay: number;
  };
}

export interface InterfaceContract {
  name: string;
  description: string;
  sourceModule?: string; // inputContract 中使用
}

export interface ModuleNote {
  files: Array<{
    path: string;
    description: string;
  }>;
  exports: InterfaceContract[];
  envVars?: string[];
  extra?: Record<string, string>;
}

export interface ModuleResult {
  moduleId: string;
  status: ModuleStatus;
  note?: ModuleNote;
  error?: string;
  duration: number;
}

export interface PlanMetadata {
  estimatedDuration?: number;
  complexity: "simple" | "medium" | "complex";
  tags: string[];
}

// ============ 输入输出 ============

export interface PlanInput {
  task: string | null;
  discussionHistory: Message[];
}

export interface PlanContext {
  projectRoot?: string;
  relevantFiles?: string[];
  constraints?: string[];
  projectInstructions?: string;
}

// ============ 枚举类型 ============

export type ModuleStatus = 
  | "pending"   // 等待依赖
  | "ready"     // 可以开始
  | "running"   // 执行中
  | "done"      // 完成
  | "failed"    // 失败
  | "skipped";  // 跳过

export type PlanStatus = 
  | "draft"      // 草稿
  | "ready"      // 准备执行
  | "running"    // 执行中
  | "paused"     // 暂停
  | "completed"  // 完成
  | "failed"     // 失败
  | "cancelled"; // 取消

// ============ 验证相关 ============

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ValidationIssue {
  type: "missing_provider" | "circular_dependency" | "overlap" | "missing_export";
  description: string;
  modules: number[];
}

// ============ 依赖图 ============

export interface DependencyGraph {
  nodes: Map<string, Module>;
  edges: Map<string, Set<string>>;
  
  addModule(module: Module): void;
  getReadyModules(): Module[];
  hasCircularDependency(): boolean;
  getExecutionOrder(): string[];
}

// ============ 常量 ============

export const READY_MARKER = "[READY_TO_PLAN]";
export const MODULE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟
export const MAX_RETRY_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 1000;
```

### 2. index.ts（骨架实现）

主类，协调所有子模块：

```typescript
// src/planner/index.ts

import type { AppConfig } from "../types.js";
import type { ModelClient } from "../model/index.js";
import type {
  TaskPlanner,
  TaskPlan,
  PlanInput,
  PlanContext,
  PlanDiscussionSession,
  ModuleResult,
  PlanStatus,
} from "./types.js";
import { PlanDiscussionSessionImpl } from "./discussion.js";
import { PlanCreator } from "./creator.js";
import { PlanExecutor } from "./executor.js";
import { PlanPersistence } from "./persistence.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner");

export class TaskPlannerImpl implements TaskPlanner {
  private config: AppConfig;
  private model: ModelClient;
  private creator: PlanCreator;
  private executor: PlanExecutor;
  private persistence: PlanPersistence;
  private currentPlan: TaskPlan | null = null;

  constructor(config: AppConfig, model: ModelClient) {
    this.config = config;
    this.model = model;
    this.creator = new PlanCreator(model, config);
    this.executor = new PlanExecutor(model, config);
    this.persistence = new PlanPersistence(config);
  }

  createDiscussionSession(context: PlanContext): PlanDiscussionSession {
    logger.info("Creating discussion session");
    return new PlanDiscussionSessionImpl(this.model, context);
  }

  async createPlan(input: PlanInput, context?: PlanContext): Promise<TaskPlan> {
    logger.info({ hasTask: !!input.task, historyLength: input.discussionHistory.length }, "Creating plan");
    
    // Phase 3 实现
    const plan = await this.creator.create(input, context);
    this.currentPlan = plan;
    return plan;
  }

  async *executePlan(plan: TaskPlan): AsyncGenerator<ModuleResult> {
    logger.info({ planId: plan.id, moduleCount: plan.modules.length }, "Executing plan");
    
    this.currentPlan = plan;
    plan.status = "running";
    plan.startedAt = Date.now();
    
    // Phase 4 实现
    yield* this.executor.execute(plan);
    
    plan.status = "completed";
    plan.completedAt = Date.now();
  }

  pause(): void {
    logger.info("Pausing plan execution");
    if (this.currentPlan) {
      this.currentPlan.status = "paused";
    }
    this.executor.pause();
  }

  resume(): void {
    logger.info("Resuming plan execution");
    if (this.currentPlan) {
      this.currentPlan.status = "running";
    }
    this.executor.resume();
  }

  cancel(): void {
    logger.info("Cancelling plan execution");
    if (this.currentPlan) {
      this.currentPlan.status = "cancelled";
    }
    this.executor.cancel();
  }

  async savePlan(plan: TaskPlan, path: string): Promise<void> {
    logger.info({ planId: plan.id, path }, "Saving plan");
    await this.persistence.save(plan, path);
  }

  async loadPlan(path: string): Promise<TaskPlan> {
    logger.info({ path }, "Loading plan");
    const plan = await this.persistence.load(path);
    this.currentPlan = plan;
    return plan;
  }

  getStatus(): PlanStatus {
    return this.currentPlan?.status ?? "draft";
  }
}

// 导出工厂函数
export function createTaskPlanner(config: AppConfig, model: ModelClient): TaskPlanner {
  return new TaskPlannerImpl(config, model);
}
```

### 3. discussion.ts（骨架）

```typescript
// src/planner/discussion.ts

import type { ModelClient } from "../model/index.js";
import type { Message } from "../types.js";
import type { PlanDiscussionSession, PlanContext, READY_MARKER } from "./types.js";
import { READY_MARKER as MARKER } from "./types.js";
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
    
    logger.info("Discussion session created");
  }

  async send(userInput: string, context: PlanContext): Promise<{ reply: string; readyToPlan: boolean }> {
    logger.info({ inputLength: userInput.length }, "Processing user input");
    
    // Phase 2 实现
    throw new Error("Not implemented: PlanDiscussionSession.send");
  }

  getHistory(): Message[] {
    return [...this.history];
  }
}
```

### 4. creator.ts（骨架）

```typescript
// src/planner/creator.ts

import type { ModelClient } from "../model/index.js";
import type { AppConfig } from "../types.js";
import type { TaskPlan, PlanInput, PlanContext } from "./types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:creator");

export class PlanCreator {
  private model: ModelClient;
  private config: AppConfig;

  constructor(model: ModelClient, config: AppConfig) {
    this.model = model;
    this.config = config;
  }

  async create(input: PlanInput, context?: PlanContext): Promise<TaskPlan> {
    logger.info({ hasTask: !!input.task, historyLength: input.discussionHistory.length }, "Creating plan");
    
    // Phase 3 实现
    throw new Error("Not implemented: PlanCreator.create");
  }

  private async generatePlan(input: PlanInput, context?: PlanContext): Promise<TaskPlan> {
    throw new Error("Not implemented: generatePlan");
  }

  private async validatePlan(plan: TaskPlan): Promise<void> {
    throw new Error("Not implemented: validatePlan");
  }
}
```

### 5. validator.ts（骨架）

```typescript
// src/planner/validator.ts

import type { TaskPlan, Module, ModuleNote, ValidationResult } from "./types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:validator");

export class PlanValidator {
  /**
   * 验证计划的供需匹配
   */
  async validatePlan(plan: TaskPlan): Promise<ValidationResult> {
    logger.info({ planId: plan.id }, "Validating plan");
    
    // Phase 3 实现
    throw new Error("Not implemented: validatePlan");
  }

  /**
   * 检查循环依赖
   */
  private checkCircularDependency(plan: TaskPlan): ValidationResult {
    throw new Error("Not implemented: checkCircularDependency");
  }

  /**
   * 检查接口供需匹配
   */
  private checkInterfaceMatching(plan: TaskPlan): ValidationResult {
    throw new Error("Not implemented: checkInterfaceMatching");
  }
}

export class NoteValidator {
  /**
   * 验证模块笔记（四步验证）
   */
  async validateNote(module: Module, codeFiles: string[]): Promise<ValidationResult> {
    logger.info({ moduleId: module.id }, "Validating note");
    
    // Phase 5 实现
    throw new Error("Not implemented: validateNote");
  }

  /**
   * 步骤1：模型对比 outputContract vs 笔记
   */
  private async compareContracts(module: Module): Promise<ValidationResult> {
    throw new Error("Not implemented: compareContracts");
  }

  /**
   * 步骤2：静态检查导出
   */
  private async checkExports(module: Module, codeFiles: string[]): Promise<ValidationResult> {
    throw new Error("Not implemented: checkExports");
  }

  /**
   * 步骤3：生成测试
   */
  async generateTests(module: Module): Promise<string[]> {
    throw new Error("Not implemented: generateTests");
  }

  /**
   * 步骤4：运行测试
   */
  async runTests(testPaths: string[]): Promise<{ passed: boolean; error?: string }> {
    throw new Error("Not implemented: runTests");
  }
}
```

### 6. executor.ts（骨架）

```typescript
// src/planner/executor.ts

import type { ModelClient } from "../model/index.js";
import type { AppConfig } from "../types.js";
import type { TaskPlan, Module, ModuleResult } from "./types.js";
import { DependencyGraphImpl } from "./dependency-graph.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:executor");

export class PlanExecutor {
  private model: ModelClient;
  private config: AppConfig;
  private paused = false;
  private cancelled = false;

  constructor(model: ModelClient, config: AppConfig) {
    this.model = model;
    this.config = config;
  }

  async *execute(plan: TaskPlan): AsyncGenerator<ModuleResult> {
    logger.info({ planId: plan.id, moduleCount: plan.modules.length }, "Starting execution");
    
    // Phase 4 实现
    throw new Error("Not implemented: PlanExecutor.execute");
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  cancel(): void {
    this.cancelled = true;
  }

  private async executeModule(module: Module, plan: TaskPlan): Promise<ModuleResult> {
    throw new Error("Not implemented: executeModule");
  }
}
```

### 7. dependency-graph.ts（骨架）

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
    logger.debug({ moduleId: module.id }, "Adding module to graph");
    
    this.nodes.set(module.id, module);
    this.edges.set(module.id, new Set(module.dependsOn));
  }

  getReadyModules(): Module[] {
    // Phase 4 实现
    throw new Error("Not implemented: getReadyModules");
  }

  hasCircularDependency(): boolean {
    // Phase 3 实现
    throw new Error("Not implemented: hasCircularDependency");
  }

  getExecutionOrder(): string[] {
    // Phase 4 实现
    throw new Error("Not implemented: getExecutionOrder");
  }
}
```

### 8. note-manager.ts（骨架）

```typescript
// src/planner/note-manager.ts

import type { Module, ModuleNote } from "./types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:note-manager");

export class NoteManager {
  private notesDir: string;

  constructor(notesDir: string) {
    this.notesDir = notesDir;
  }

  async saveNote(module: Module, note: ModuleNote): Promise<void> {
    logger.info({ moduleId: module.id }, "Saving note");
    
    // Phase 4 实现
    throw new Error("Not implemented: saveNote");
  }

  async loadNote(moduleId: string): Promise<ModuleNote | null> {
    logger.info({ moduleId }, "Loading note");
    
    // Phase 4 实现
    throw new Error("Not implemented: loadNote");
  }

  async loadNotes(moduleIds: string[]): Promise<Map<string, ModuleNote>> {
    logger.info({ count: moduleIds.length }, "Loading multiple notes");
    
    // Phase 4 实现
    throw new Error("Not implemented: loadNotes");
  }
}
```

### 9. persistence.ts（骨架）

```typescript
// src/planner/persistence.ts

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AppConfig } from "../types.js";
import type { TaskPlan } from "./types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:persistence");

export class PlanPersistence {
  private plansDir: string;

  constructor(config: AppConfig) {
    this.plansDir = path.join(config.projectRoot || process.cwd(), ".cehnzcode", "plans");
  }

  async save(plan: TaskPlan, filePath: string): Promise<void> {
    logger.info({ planId: plan.id, path: filePath }, "Saving plan");
    
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(plan, null, 2), "utf-8");
  }

  async load(filePath: string): Promise<TaskPlan> {
    logger.info({ path: filePath }, "Loading plan");
    
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as TaskPlan;
  }

  async list(): Promise<string[]> {
    logger.info("Listing plans");
    
    try {
      const files = await fs.readdir(this.plansDir);
      return files.filter(f => f.endsWith(".json"));
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }
}
```

### 10. prompts/planner.ts（占位符）

```typescript
// src/prompts/planner.ts

/**
 * Phase 2: 讨论阶段系统提示词
 */
export const PLAN_DISCUSSION_PROMPT = `
TODO: Phase 2 实现
`;

/**
 * Phase 3: 创建计划提示词（直接模式）
 */
export const PLAN_CREATION_PROMPT = `
TODO: Phase 3 实现
`;

/**
 * Phase 3: 创建计划提示词（讨论模式）
 */
export const PLAN_CREATION_TALK_PROMPT = `
TODO: Phase 3 实现
`;

/**
 * Phase 3: 计划验证提示词
 */
export const PLAN_VALIDATION_PROMPT = `
TODO: Phase 3 实现
`;

/**
 * Phase 4: 模块执行提示词
 */
export const MODULE_EXECUTION_PROMPT = `
TODO: Phase 4 实现
`;

/**
 * Phase 4: 笔记生成提示词
 */
export const NOTE_GENERATION_PROMPT = `
TODO: Phase 4 实现
`;

/**
 * Phase 5: 笔记验证提示词
 */
export const VALIDATE_NOTE_PROMPT = `
TODO: Phase 5 实现
`;

/**
 * Phase 5: 测试生成提示词
 */
export const TEST_GENERATION_PROMPT = `
TODO: Phase 5 实现
`;
```

### 11. commands/builtins/plan.ts（骨架）

```typescript
// src/commands/builtins/plan.ts

import type { CommandDefinition, CommandContext } from "../types.js";
import type { PlanInput } from "../../planner/types.js";
import { READY_MARKER } from "../../planner/types.js";

export const planCommand: CommandDefinition = {
  name: "plan",
  description: "创建并执行模块化任务计划",
  async execute(args, ctx) {
    if (!args) {
      // 讨论模式
      ctx.ui.showMessage("讨论模式尚未实现（Phase 2）");
      return;
    }

    // 直接模式
    ctx.ui.showMessage("直接模式尚未实现（Phase 3）");
  },
};

export const planConfirmCommand: CommandDefinition = {
  name: "plan confirm",
  description: "强制结束当前讨论并生成计划",
  async execute(args, ctx) {
    ctx.ui.showMessage("讨论确认尚未实现（Phase 2）");
  },
};

export const planListCommand: CommandDefinition = {
  name: "plan list",
  description: "列出所有保存的计划",
  async execute(args, ctx) {
    ctx.ui.showMessage("计划列表尚未实现（Phase 1）");
  },
};

export const planResumeCommand: CommandDefinition = {
  name: "plan resume",
  description: "恢复执行中断的计划",
  async execute(args, ctx) {
    ctx.ui.showMessage("计划恢复尚未实现（Phase 4）");
  },
};

export const planShowCommand: CommandDefinition = {
  name: "plan show",
  description: "查看计划详情",
  async execute(args, ctx) {
    ctx.ui.showMessage("计划详情尚未实现（Phase 1）");
  },
};

export const planCancelCommand: CommandDefinition = {
  name: "plan cancel",
  description: "取消当前执行的计划",
  async execute(args, ctx) {
    ctx.ui.showMessage("计划取消尚未实现（Phase 4）");
  },
};
```

### 12. 更新 commands/registry.ts

```typescript
// 在 src/commands/registry.ts 中注册新命令

import { 
  planCommand, 
  planConfirmCommand, 
  planListCommand,
  planResumeCommand,
  planShowCommand,
  planCancelCommand,
} from "./builtins/plan.js";

// 在 registry 初始化时注册
registry.register(planCommand);
registry.register(planConfirmCommand);
registry.register(planListCommand);
registry.register(planResumeCommand);
registry.register(planShowCommand);
registry.register(planCancelCommand);
```

---

## 验收标准

Phase 1 完成后应该满足：

1. ✅ 所有类型定义完整，无 TypeScript 错误
2. ✅ 所有主要类和接口都已创建
3. ✅ 所有方法都有签名，但实现抛出 "Not implemented" 错误
4. ✅ 文件结构清晰，模块职责明确
5. ✅ 日志记录到位，便于后续调试
6. ✅ 命令已注册，可以调用（虽然会提示未实现）
7. ✅ 可以编译通过（`npm run build`）
8. ✅ 骨架测试可以运行（测试"未实现"错误被正确抛出）

---

## 测试示例

```typescript
// src/planner/test/test-skeleton.ts

import { describe, it, expect } from "vitest";
import { TaskPlannerImpl } from "../index.js";
import type { AppConfig } from "../../types.js";
import { ModelClient } from "../../model/index.js";

describe("Planner Skeleton", () => {
  const config: AppConfig = {
    // ... 测试配置
  };
  
  const model = new ModelClient(config);
  const planner = new TaskPlannerImpl(config, model);

  it("should create discussion session", () => {
    const session = planner.createDiscussionSession({});
    expect(session).toBeDefined();
    expect(session.history).toEqual([]);
  });

  it("should throw 'Not implemented' for createPlan", async () => {
    await expect(
      planner.createPlan({ task: "test", discussionHistory: [] })
    ).rejects.toThrow("Not implemented");
  });

  it("should throw 'Not implemented' for executePlan", async () => {
    const plan = {
      id: "test",
      task: "test",
      description: "test",
      modules: [],
      status: "draft" as const,
      createdAt: Date.now(),
      metadata: { complexity: "simple" as const, tags: [] },
    };

    const generator = planner.executePlan(plan);
    await expect(generator.next()).rejects.toThrow("Not implemented");
  });
});
```

---

## 下一步

Phase 1 完成后，骨架已经搭建完毕，后续阶段只需要：
- Phase 2: 填充 `discussion.ts` 的实现
- Phase 3: 填充 `creator.ts` 和 `validator.ts` 的计划创建部分
- Phase 4: 填充 `executor.ts` 和 `module-worker.ts` 的执行部分
- Phase 5: 填充 `validator.ts` 的笔记验证部分

每个阶段都是在已有骨架上填充实现，不会改变接口和架构。
