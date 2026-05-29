import { hookRunner } from "../hooks/index.js";
import { toolRegistry } from "../tools/registry.js";
import { getConfig } from "../config/index.js";
import { createChildLogger } from "../logger/index.js";
import {
  readStore,
  appendRecord,
  generateId,
  getSystemStorePath,
  getProjectStorePath,
} from "./storage.js";
import {
  KNOWLEDGE_INJECTION_INSTRUCTION,
  formatRecordsForPrompt,
} from "../prompts/knowledge.js";
import type {
  IKnowledgeManager,
  KnowledgeRecord,
  RecordKnowledgeArgs,
} from "./types.js";

const logger = createChildLogger("knowledge");

/** 大数据集阈值：超过此条数切换为摘要注入 */
const LARGE_DATASET_THRESHOLD = 20;

/** 自动清除注入状态的最大模型调用次数 */
const MAX_PENDING_CALLS = 5;

class KnowledgeManager implements IKnowledgeManager {
  private enabled: boolean;
  private pendingInjection = false;
  private pendingCallCount = 0;

  constructor() {
    this.enabled = getConfig().knowledgeEnabled ?? true;
    this.registerHooks();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info({ enabled }, "Knowledge manager toggled");
  }

  resetPending(): void {
    this.pendingInjection = false;
    this.pendingCallCount = 0;
  }

  async record(args: RecordKnowledgeArgs): Promise<KnowledgeRecord | null> {
    // skipped 只关闭 flag，不落盘
    if (args.outcome === "skipped") return null;

    const record: KnowledgeRecord = {
      id: generateId(),
      timestamp: Date.now(),
      scope: args.scope,
      error: args.error,
      background: args.background,
      solution: args.solution,
      outcome: args.outcome,
    };

    await appendRecord(record, args.scope, process.cwd());
    logger.info({ id: record.id, scope: record.scope, outcome: record.outcome }, "Knowledge recorded");
    return record;
  }

  async getAll(): Promise<KnowledgeRecord[]> {
    const [systemStore, projectStore] = await Promise.all([
      readStore(getSystemStorePath()),
      readStore(getProjectStorePath(process.cwd())),
    ]);
    return [...systemStore.errors, ...projectStore.errors];
  }

  async search(query: string, limit = 5): Promise<KnowledgeRecord[]> {
    const all = await this.getAll();
    const lq = query.toLowerCase();
    const matched = all.filter(
      (r) =>
        r.error.toLowerCase().includes(lq) ||
        r.background.toLowerCase().includes(lq) ||
        r.solution.toLowerCase().includes(lq)
    );
    return matched.slice(0, limit);
  }

  /** 构建注入内容（每次 flag=true 时调用） */
  private async buildInjection(): Promise<string> {
    const records = await this.getAll();

    let notebookSection: string;
    if (records.length === 0) {
      notebookSection = `## 错题本\n\n（暂无记录）`;
    } else if (records.length > LARGE_DATASET_THRESHOLD) {
      // 大数据集：只注入错误标题列表，模型可通过 search_knowledge 查询完整内容
      const titles = records.map((r, i) => `${i + 1}. [${r.scope}] ${r.error}`).join("\n");
      notebookSection = `## 错题本（共 ${records.length} 条，以下为摘要，可用 search_knowledge 搜索详情）\n\n${titles}`;
    } else {
      notebookSection = `## 错题本\n\n${formatRecordsForPrompt(records)}`;
    }

    return `${notebookSection}\n\n${KNOWLEDGE_INJECTION_INSTRUCTION}`;
  }

  private registerHooks(): void {
    // tool:after — 检测失败、管理 flag
    hookRunner.intercept("tool:after", async (data) => {
      if (!this.enabled) return { action: "continue" };

      const { call, result } = data;

      if (call.name === "record_knowledge") {
        // 模型已调用 record_knowledge，关闭注入
        this.pendingInjection = false;
        this.pendingCallCount = 0;
      } else if (result.error) {
        // 工具执行失败，开启注入
        this.pendingInjection = true;
        this.pendingCallCount = 0;
        logger.debug({ tool: call.name }, "Tool error detected, enabling knowledge injection");
      }

      return { action: "continue" };
    });

    // model:before — 过滤工具 & 注入错题本内容
    hookRunner.intercept("model:before", async (data) => {
      // 功能关闭：从工具列表中移除知识库工具
      if (!this.enabled) {
        return {
          action: "modify",
          data: {
            ...data,
            tools: data.tools.filter(
              (t) => t.name !== "record_knowledge" && t.name !== "search_knowledge"
            ),
          },
        };
      }

      // 无待处理错误，不注入
      if (!this.pendingInjection) return { action: "continue" };

      // 超过最大次数，自动清除
      this.pendingCallCount++;
      if (this.pendingCallCount > MAX_PENDING_CALLS) {
        logger.debug("Max pending calls exceeded, clearing injection flag");
        this.pendingInjection = false;
        this.pendingCallCount = 0;
        return { action: "continue" };
      }

      // 追加错题本内容到系统提示词末尾
      const injectionContent = await this.buildInjection();
      const messages = [...data.messages];
      const systemIndex = messages.findIndex((m) => m.role === "system");
      if (systemIndex !== -1) {
        messages[systemIndex] = {
          ...messages[systemIndex],
          content: messages[systemIndex].content + "\n\n" + injectionContent,
        };
      }

      // 大数据集场景：动态注入 search_knowledge 工具
      const records = await this.getAll();
      let tools = data.tools;
      if (records.length > LARGE_DATASET_THRESHOLD) {
        const hasSearchTool = tools.some((t) => t.name === "search_knowledge");
        if (!hasSearchTool) {
          // 从 toolRegistry 取，避免循环依赖和动态 import（打包后动态 import 失效）
          const searchTool = toolRegistry.get("search_knowledge");
          if (searchTool) tools = [...tools, searchTool];
        }
      }

      return {
        action: "modify",
        data: { ...data, messages, tools },
      };
    });
  }
}

/** 全局单例 */
export const knowledgeManager: IKnowledgeManager = new KnowledgeManager();
export type { IKnowledgeManager, KnowledgeRecord, RecordKnowledgeArgs } from "./types.js";
