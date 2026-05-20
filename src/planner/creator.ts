// src/planner/creator.ts

import type { ModelClient } from "../model/index.js";
import type { AppConfig, Turn } from "../types.js";
import type { TaskPlan, PlanInput, PlanContext, Module, InterfaceContract, ValidationIssue } from "./types.js";
import { PlanValidator } from "./validator.js";
import {
  buildPlanCreationPrompt,
  buildPlanCreationTalkPrompt,
} from "../prompts/planner.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:creator");

const MAX_VALIDATION_RETRIES = 3;

/** Message → Turn 转换工具 */
function toTurns(messages: Array<{ role: "user" | "assistant" | "system"; content: string }>): Turn[] {
  return messages.map((msg, i) => ({
    id: `creator-${i}`,
    role: msg.role,
    content: msg.content,
    tags: [msg.role],
    tokenCount: 0,
    compressed: false,
    timestamp: Date.now(),
  }));
}

/** 负责调用模型生成 TaskPlan，并经过供需匹配验证 */
export class PlanCreator {
  private model: ModelClient;
  private config: AppConfig;
  private validator: PlanValidator;

  constructor(model: ModelClient, config: AppConfig) {
    this.model = model;
    this.config = config;
    // 传入 model 以启用模型语义审查
    this.validator = new PlanValidator(model);
  }

  /** 创建计划：生成 → 验证 → 失败则带反馈重试，最多 MAX_VALIDATION_RETRIES 次 */
  async create(input: PlanInput, context?: PlanContext): Promise<TaskPlan> {
    logger.info({ hasTask: !!input.task, historyLength: input.discussionHistory.length }, "Creating plan");

    // 根据输入模式构建初始提示词
    const initialPrompt = input.task
      ? buildPlanCreationPrompt(input.task, context?.projectInstructions)
      : buildPlanCreationTalkPrompt(input.discussionHistory, context?.projectInstructions);

    // 多轮对话历史，跨重试复用，让模型能看到自己上次的输出
    const history: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "user", content: initialPrompt },
    ];

    for (let attempt = 1; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
      logger.info({ attempt }, "Generating plan");

      const response = await this.model.chat(toTurns(history), []);

      // 将模型回复加入历史，下次重试时模型能看到自己上次的输出
      history.push({ role: "assistant", content: response.content });

      const plan = parsePlan(response.content, input);
      const validation = await this.validator.validatePlan(plan);

      if (validation.valid) {
        logger.info({ planId: plan.id, moduleCount: plan.modules.length }, "Plan created successfully");
        return plan;
      }

      const issues = formatIssues(validation.issues);
      logger.warn({ attempt, issues: validation.issues }, "Plan validation failed");

      if (attempt >= MAX_VALIDATION_RETRIES) {
        throw new Error(`计划验证失败（已重试 ${MAX_VALIDATION_RETRIES} 次）：\n${issues}`);
      }

      // 将验证反馈作为新的用户消息，让模型在下一轮看到自己的错误
      history.push({
        role: "user",
        content: `上次生成的计划存在以下问题，请修正：\n\n${issues}`,
      });
    }

    // 这里实际上不可能到达，TypeScript 类型守卫需要
    throw new Error("Unexpected: validation loop exited without result");
  }
}

// ============ 纯函数工具 ============

/** 将模型返回的 JSON 字符串解析并构造为 TaskPlan 对象 */
function parsePlan(content: string, input: PlanInput): TaskPlan {
  const planData = parseJson(content);

  const modules: Module[] = (planData.modules ?? []).map((m: any, index: number) =>
    buildModule(m, index)
  );

  return {
    id: generatePlanId(),
    task: input.task ?? extractTaskFromHistory(input.discussionHistory),
    description: planData.description ?? "",
    modules,
    status: "draft",
    createdAt: Date.now(),
    metadata: {
      estimatedDuration: planData.metadata?.estimatedDuration,
      complexity: planData.metadata?.complexity ?? "medium",
      tags: planData.metadata?.tags ?? [],
    },
  };
}

/** 构造单个 Module 对象，将索引数组转为 ID 引用 */
function buildModule(data: any, index: number): Module {
  const moduleId = `module_${String(index + 1).padStart(3, "0")}`;

  // dependsOn / relatedModules 由模型用索引表示，转换为模块 ID
  const toModuleId = (idx: number) => `module_${String(idx + 1).padStart(3, "0")}`;

  return {
    id: moduleId,
    name: data.name ?? "",
    index,
    description: data.description ?? "",
    dependsOn: (data.dependsOn ?? []).map(toModuleId),
    relatedModules: (data.relatedModules ?? []).map(toModuleId),
    inputContract: normalizeInputContracts(data.inputs, toModuleId),
    outputContract: normalizeContracts(data.outputs),
    status: "pending",
    retryConfig: {
      maxRetries: 3,
      currentRetry: 0,
      retryDelay: 1000,
    },
  };
}

/** 规范化 inputs 契约列表，将 source 索引转为模块 ID */
function normalizeInputContracts(
  contracts: any[],
  toModuleId: (idx: number) => string
): InterfaceContract[] {
  if (!Array.isArray(contracts)) return [];
  return contracts
    .filter(c => c && typeof c.name === "string" && c.name)
    .map(c => ({
      name: c.name,
      description: c.description ?? "",
      ...(typeof c.source === "number" ? { sourceModule: toModuleId(c.source) } : {}),
    }));
}

/** 规范化 outputs 契约列表，过滤无效项 */
function normalizeContracts(contracts: any[]): InterfaceContract[] {
  if (!Array.isArray(contracts)) return [];
  return contracts
    .filter(c => c && typeof c.name === "string" && c.name)
    .map(c => ({
      name: c.name,
      description: c.description ?? "",
    }));
}

/**
 * 从可能含代码块的字符串中提取 JSON
 * 模型有时会把 JSON 包裹在 ```json...``` 中
 */
function parseJson(content: string): any {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/) ?? content.match(/```\s*([\s\S]*?)\s*```/);
  const jsonText = match ? match[1] : content.trim();

  try {
    return JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`模型返回的内容不是有效的 JSON：${(err as Error).message}\n\n原始内容：${content.slice(0, 500)}`);
  }
}

/** 生成格式为 plan_YYYYMMDD_xxxxxx 的计划 ID */
function generatePlanId(): string {
  const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 8);
  return `plan_${dateStr}_${random}`;
}

/** 从讨论历史中提取任务描述（取第一条用户消息） */
function extractTaskFromHistory(history: Array<{ role: string; content: string }>): string {
  const firstUser = history.find(msg => msg.role === "user");
  return firstUser?.content ?? "未命名任务";
}

/** 格式化验证问题为可读字符串，用于重试提示 */
function formatIssues(issues: ValidationIssue[]): string {
  return issues.map(issue => `- [${issue.type}] ${issue.description}`).join("\n");
}
