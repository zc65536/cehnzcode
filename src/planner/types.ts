// src/planner/types.ts

import type { Message, ToolDefinition } from "../types.js";
import type { ToolExecutor } from "../tools/executor.js";

// ============ 核心接口 ============

export interface TaskPlanner {
  /** 创建讨论会话（讨论模式入口） */
  createDiscussionSession(context: PlanContext): PlanDiscussionSession;

  /** 创建计划（直接模式或讨论结束后） */
  createPlan(input: PlanInput, context?: PlanContext): Promise<TaskPlan>;

  /** 执行计划，逐模块 yield 结果 */
  executePlan(plan: TaskPlan): AsyncGenerator<ModuleResult>;

  pause(): void;
  resume(): void;
  cancel(): void;

  savePlan(plan: TaskPlan, path: string): Promise<void>;
  loadPlan(path: string): Promise<TaskPlan>;

  getStatus(): PlanStatus;
}

export interface PlanDiscussionSession {
  history: Message[];
  startedAt: number;

  /** 发送用户消息，返回模型回复 + 是否准备好规划 */
  send(
    userInput: string,
    context: PlanContext,
    options?: {
      /** 流式输出回调，每个文本 chunk 触发一次 */
      onChunk?: (chunk: string) => void;
      /** 允许模型调用的工具列表 */
      tools?: ToolDefinition[];
      /** 工具执行器，有 tools 时必须提供 */
      executor?: ToolExecutor;
    }
  ): Promise<{ reply: string; readyToPlan: boolean }>;

  /** 获取完整对话历史（用于传入 createPlan） */
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
  name: string;
  index: number;
  description: string;

  /** 调度依据：必须等待这些模块 id 完成后才能开始 */
  dependsOn: string[];

  /** 上下文来源：执行时读取这些模块的笔记 */
  relatedModules: string[];

  /** 计划阶段预定义：本模块依赖哪些外部接口 */
  inputContract: InterfaceContract[];

  /** 计划阶段预定义：本模块对外暴露哪些接口 */
  outputContract: InterfaceContract[];

  // 执行后填写
  note?: ModuleNote;
  notePath?: string;    // .cehnzcode/notes/<module-id>.md
  testPaths?: string[]; // 测试文件路径

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

/** 接口契约：一个对外接口的声明 */
export interface InterfaceContract {
  name: string;
  description: string;
  /** inputContract 中使用：该接口由哪个模块提供 */
  sourceModule?: string;
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
  /** 直接模式传任务描述，讨论模式传 null */
  task: string | null;
  discussionHistory: Message[];
}

export interface PlanContext {
  projectRoot?: string;
  relevantFiles?: string[];
  constraints?: string[];
  /** 项目级 CLAUDE.md 内容，由命令层注入 */
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
