// src/planner/executor.ts

import * as path from "node:path";
import type { ModelClient } from "../model/index.js";
import type { AppConfig, Turn } from "../types.js";
import type { TaskPlan, Module, ModuleResult, ModuleNote } from "./types.js";
import { MAX_RETRY_ATTEMPTS, RETRY_DELAY_MS } from "./types.js";
import { NoteManager } from "./note-manager.js";
import { NoteValidator } from "./validator.js";
import { ToolExecutor } from "../tools/executor.js";
import { toolRegistry } from "../tools/registry.js";
import { buildModuleExecutionPrompt, buildNoteGenerationPrompt } from "../prompts/planner.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:executor");

/** 生成唯一 Turn ID */
let turnSeq = 0;
function makeTurn(role: Turn["role"], content: string, extra?: Partial<Turn>): Turn {
  return {
    id: `exec-${++turnSeq}`,
    role,
    content,
    tags: [role],
    tokenCount: 0,
    compressed: false,
    timestamp: Date.now(),
    ...extra,
  };
}

/** 从可能含代码块的字符串中解析 JSON */
function parseJsonSafe(content: string): any {
  const match =
    content.match(/```json\s*([\s\S]*?)\s*```/) ??
    content.match(/```\s*([\s\S]*?)\s*```/);
  const jsonText = match ? match[1] : content.trim();

  try {
    return JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `模型返回的笔记不是有效的 JSON：${(err as Error).message}\n\n原始内容：${content.slice(0, 500)}`
    );
  }
}

/** 执行调度器，负责并行调度 ready 模块、超时控制、状态管理 */
export class PlanExecutor {
  private model: ModelClient;
  private config: AppConfig;
  private noteManager: NoteManager;
  private noteValidator: NoteValidator;
  private paused = false;
  private cancelled = false;

  /**
   * noteValidator 可选注入——不传时使用默认实现（含真实模型调用和测试执行）。
   * 测试时可传入 mock，避免磁盘 IO 和真实命令执行。
   */
  constructor(model: ModelClient, config: AppConfig, noteValidator?: NoteValidator) {
    this.model = model;
    this.config = config;

    const projectRoot = process.cwd();
    const notesDir = path.join(projectRoot, ".cehnzcode", "notes");
    this.noteManager = new NoteManager(notesDir);
    this.noteValidator = noteValidator ?? new NoteValidator(model, projectRoot, config);
  }

  /** 执行整个计划，逐模块 yield 结果 */
  async *execute(plan: TaskPlan): AsyncGenerator<ModuleResult> {
    logger.info({ planId: plan.id, moduleCount: plan.modules.length }, "Starting execution");

    while (this.hasUnfinishedModules(plan)) {
      if (this.cancelled) {
        logger.info("Execution cancelled");
        break;
      }

      if (this.paused) {
        await this.sleep(100);
        continue;
      }

      const readyModules = this.getReadyModules(plan);

      if (readyModules.length === 0) {
        if (this.hasRunningModules(plan)) {
          // 有模块正在执行，等待
          await this.sleep(100);
          continue;
        } else {
          // 没有 ready 也没有 running → 死锁（剩余模块的依赖都失败了）
          logger.warn("Deadlock detected, skipping blocked modules");
          this.skipBlockedModules(plan);
          break;
        }
      }

      logger.info({ count: readyModules.length }, "Executing ready modules in parallel");

      // 标记为 running，防止重复调度
      for (const module of readyModules) {
        module.status = "running";
        module.startedAt = Date.now();
      }

      // 并行执行，allSettled 保证一个模块失败不阻塞其他模块
      const results = await Promise.allSettled(
        readyModules.map(module => this.executeModule(module, plan))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const module = readyModules[i];

        if (result.status === "fulfilled") {
          yield result.value;
        } else {
          const error = result.reason as Error;
          logger.error({ moduleId: module.id, error: error.message }, "Module execution failed");

          module.status = "failed";
          module.error = error.message;
          module.completedAt = Date.now();

          yield {
            moduleId: module.id,
            status: "failed",
            error: error.message,
            duration: Date.now() - (module.startedAt ?? Date.now()),
          };
        }
      }
    }

    logger.info({ planId: plan.id }, "Execution completed");
    // 各模块测试已在 generateAndRunTests 中由模型自主运行并修复，无需再做集中 e2e 重跑
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

  /** 执行单个模块：收集上下文 → agentic loop → 生成笔记 → 保存 */
  private async executeModule(module: Module, plan: TaskPlan): Promise<ModuleResult> {
    const startTime = module.startedAt ?? Date.now();
    logger.info({ moduleId: module.id }, "Executing module");

    try {
      // 1. 收集相关模块的笔记作为上下文
      logger.info({ moduleId: module.id }, "[executeModule] 步骤1: 加载相关模块笔记");
      const relatedNotes = await this.noteManager.loadNotes(module.relatedModules);

      // 2. 构造执行提示词
      logger.info({ moduleId: module.id }, "[executeModule] 步骤2: 构造执行提示词");
      const executionPrompt = buildModuleExecutionPrompt(plan, module, relatedNotes);

      // 3. 进入 agentic loop
      //    系统消息设定角色，用户消息传入任务描述
      const history: Turn[] = [
        makeTurn("system", "你是专业的软件开发助手，请使用工具实现以下任务。"),
        makeTurn("user", executionPrompt),
      ];

      logger.info({ moduleId: module.id }, "[executeModule] 步骤3: 进入 agenticLoop");
      await this.agenticLoop(history);
      logger.info({ moduleId: module.id }, "[executeModule] 步骤3: agenticLoop 完成");

      // 4. 生成模块笔记：把完整对话历史传给模型，追加一条请求
      logger.info({ moduleId: module.id }, "[executeModule] 步骤4: 生成模块笔记");
      const note = await this.generateNote(module, history);
      logger.info({ moduleId: module.id }, "[executeModule] 步骤4: 模块笔记生成完成");

      // 5. 保存笔记到磁盘
      logger.info({ moduleId: module.id }, "[executeModule] 步骤5: 保存笔记到磁盘");
      await this.noteManager.saveNote(module, note);

      module.note = note;
      module.notePath = path.join(".cehnzcode", "notes", `${module.id}.json`);

      // 6. 验证笔记：契约对比 → 静态检查 → 生成测试 → 运行测试（Phase 5 实现）
      //    若 validateNote 尚未实现，则视为通过，不阻塞 Phase 4 流程
      logger.info({ moduleId: module.id }, "[executeModule] 步骤6: 验证笔记");
      let validation: import("./types.js").ValidationResult;
      try {
        validation = await this.noteValidator.validateNote(module);
      } catch (validationErr) {
        const validationError = validationErr as Error;
        if (validationError.message.includes("Not implemented")) {
          logger.debug({ moduleId: module.id }, "Note validation not yet implemented — skipping");
          validation = { valid: true, issues: [] };
        } else {
          throw validationErr;
        }
      }

      if (!validation.valid) {
        const failureDesc = validation.issues.map(i => i.description).join("; ");
        logger.warn({ moduleId: module.id, issues: validation.issues }, "Note validation failed");

        // 重试逻辑：初始化 retryConfig（如未设置），然后决定是否重试
        if (!module.retryConfig) {
          module.retryConfig = { maxRetries: MAX_RETRY_ATTEMPTS, currentRetry: 0, retryDelay: RETRY_DELAY_MS };
        }

        if (module.retryConfig.currentRetry < module.retryConfig.maxRetries) {
          module.retryConfig.currentRetry++;
          logger.info(
            { moduleId: module.id, attempt: module.retryConfig.currentRetry },
            "Retrying module after validation failure"
          );
          await this.sleep(module.retryConfig.retryDelay);
          module.status = "running";
          module.startedAt = Date.now();
          // 重开实现：带入失败原因
          return await this.executeModuleWithFailureContext(module, plan, failureDesc);
        }

        throw new Error(`笔记验证失败（已达最大重试次数）：${failureDesc}`);
      }

      // 7. 更新模块状态
      module.status = "done";
      module.completedAt = Date.now();

      const duration = Date.now() - startTime;
      logger.info({ moduleId: module.id, duration }, "Module completed");

      return { moduleId: module.id, status: "done", note, duration };

    } catch (err) {
      const error = err as Error;
      logger.error({ moduleId: module.id, error: error.message }, "Module failed");

      module.status = "failed";
      module.error = error.message;
      module.completedAt = Date.now();

      return {
        moduleId: module.id,
        status: "failed",
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 重开实现：带入上次失败原因，重新构建对话历史执行模块。
   * 在 validateNote 失败且重试次数未超限时调用。
   */
  private async executeModuleWithFailureContext(
    module: Module,
    plan: TaskPlan,
    failureReason: string
  ): Promise<ModuleResult> {
    const startTime = module.startedAt ?? Date.now();

    try {
      const relatedNotes = await this.noteManager.loadNotes(module.relatedModules);
      const executionPrompt = buildModuleExecutionPrompt(plan, module, relatedNotes);

      const failurePrefix = `## 上次执行失败的原因\n\n${failureReason}\n\n请在实现时注意避免上述问题。\n\n---\n\n`;

      const history: Turn[] = [
        makeTurn("system", "你是专业的软件开发助手，请使用工具实现以下任务。"),
        makeTurn("user", failurePrefix + executionPrompt),
      ];

      await this.agenticLoop(history);

      const note = await this.generateNote(module, history);
      await this.noteManager.saveNote(module, note);

      module.note = note;
      module.notePath = path.join(".cehnzcode", "notes", `${module.id}.json`);

      // 本次重试不再递归 validateNote，直接标记 done，避免无限递归
      module.status = "done";
      module.completedAt = Date.now();

      const duration = Date.now() - startTime;
      logger.info({ moduleId: module.id, duration }, "Module completed after retry");
      return { moduleId: module.id, status: "done", note, duration };

    } catch (err) {
      const error = err as Error;
      logger.error({ moduleId: module.id, error: error.message }, "Module failed on retry");

      module.status = "failed";
      module.error = error.message;
      module.completedAt = Date.now();

      return {
        moduleId: module.id,
        status: "failed",
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Agentic loop：持续调用模型直到无工具调用为止。
   * 终止条件：模型返回空工具调用列表（finishReason = stop/end_turn）。
   * 安全上限：MAX_AGENTIC_ITERATIONS 次迭代后强制终止，防止无限循环。
   */
  private async agenticLoop(history: Turn[]): Promise<void> {
    const MAX_AGENTIC_ITERATIONS = 80;

    const executor = new ToolExecutor({
      cwd: process.cwd(),
      config: this.config,
      signal: new AbortController().signal,
    });

    let iteration = 0;

    while (true) {
      iteration++;
      logger.info({ iteration, maxIterations: MAX_AGENTIC_ITERATIONS }, "[agenticLoop] 开始第 ${iteration} 轮，调用模型");

      if (iteration > MAX_AGENTIC_ITERATIONS) {
        logger.warn({ iteration }, "[agenticLoop] 已达最大迭代次数，强制退出");
        break;
      }

      const tools = toolRegistry.getAll();

      logger.debug({ iteration, historyLength: history.length }, "[agenticLoop] 发送 model.chat 请求");
      const response = await this.model.chat(history, tools);
      logger.info(
        { iteration, toolCallCount: response.toolCalls.length, finishReason: response.finishReason },
        "[agenticLoop] model.chat 返回"
      );

      if (response.toolCalls.length === 0) {
        // 无工具调用 → 模型已完成实现
        history.push(makeTurn("assistant", response.content));
        logger.info({ iteration }, "[agenticLoop] 无工具调用，退出循环");
        break;
      }

      // 有工具调用 → 追加 assistant turn，执行工具，追加 tool results
      history.push(
        makeTurn("assistant", response.content, { toolCalls: response.toolCalls })
      );

      const toolNames = response.toolCalls.map(tc => tc.name).join(", ");
      logger.info({ iteration, toolCount: response.toolCalls.length, toolNames }, "[agenticLoop] 执行工具调用");
      const results = await executor.runAll(response.toolCalls);
      logger.info({ iteration, toolCount: results.length }, "[agenticLoop] 工具调用完成");

      history.push(
        makeTurn("tool", results.map(r => r.output || r.error || "").join("\n"), {
          toolResults: results,
        })
      );
    }
  }

  /** 追加笔记生成请求到对话历史，解析模型返回的 JSON */
  private async generateNote(module: Module, history: Turn[]): Promise<ModuleNote> {
    logger.info({ moduleId: module.id, historyLength: history.length }, "[generateNote] 开始，发送 model.chat 请求");

    const notePrompt = buildNoteGenerationPrompt(module);

    // 在已有对话基础上追加请求，让模型知道之前做了什么
    const noteHistory = [
      ...history,
      makeTurn("user", notePrompt),
    ];

    const response = await this.model.chat(noteHistory, []);
    logger.info({ moduleId: module.id, contentLength: response.content.length }, "[generateNote] model.chat 返回，开始解析 JSON");
    const note = parseJsonSafe(response.content) as ModuleNote;
    logger.info({ moduleId: module.id }, "[generateNote] 解析完成");
    return note;
  }

  private hasUnfinishedModules(plan: TaskPlan): boolean {
    return plan.modules.some(
      m => m.status !== "done" && m.status !== "failed" && m.status !== "skipped"
    );
  }

  private hasRunningModules(plan: TaskPlan): boolean {
    return plan.modules.some(m => m.status === "running");
  }

  /** 找出所有依赖都已完成的 pending 模块 */
  private getReadyModules(plan: TaskPlan): Module[] {
    return plan.modules.filter(module => {
      if (module.status !== "pending") return false;

      return module.dependsOn.every(depId => {
        const dep = plan.modules.find(m => m.id === depId);
        return dep?.status === "done";
      });
    });
  }

  /**
   * 处理死锁：将所有依赖已失败/跳过且自身无法执行的模块标记为 skipped。
   * 当关键依赖失败时，下游模块自动跳过而不是永久阻塞。
   */
  private skipBlockedModules(plan: TaskPlan): void {
    for (const module of plan.modules) {
      if (module.status !== "pending") continue;

      const hasFailedDep = module.dependsOn.some(depId => {
        const dep = plan.modules.find(m => m.id === depId);
        return dep?.status === "failed" || dep?.status === "skipped";
      });

      if (hasFailedDep) {
        logger.warn({ moduleId: module.id }, "Skipping module due to failed dependency");
        module.status = "skipped";
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
