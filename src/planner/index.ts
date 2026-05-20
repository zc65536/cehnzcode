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

/** TaskPlanner 主实现，协调所有子模块 */
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

/** 工厂函数 */
export function createTaskPlanner(config: AppConfig, model: ModelClient): TaskPlanner {
  return new TaskPlannerImpl(config, model);
}
