// src/planner/persistence.ts

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AppConfig } from "../types.js";
import type { TaskPlan } from "./types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:persistence");

/** 计划持久化：保存和读取 .cehnzcode/plans/ 下的计划 JSON 文件 */
export class PlanPersistence {
  private plansDir: string;

  constructor(_config: AppConfig) {
    this.plansDir = path.join(process.cwd(), ".cehnzcode", "plans");
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

  /** 列出所有已保存的计划文件名 */
  async list(): Promise<string[]> {
    logger.info("Listing plans");

    try {
      const files = await fs.readdir(this.plansDir);
      return files.filter(f => f.endsWith(".json") && f !== "active.json");
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }
}
