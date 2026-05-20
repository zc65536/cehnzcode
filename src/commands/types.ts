import type { AppConfig, UIAdapter } from "../types.js";
import type { ConversationManager } from "../context/index.js";
import type { TaskPlanner } from "../planner/types.js";

// ============ Session 模式 ============

export type SessionMode = "normal" | "plan-discussion";

/** 会话模式管理器，提供模式切换和模式数据存储 */
export interface SessionModeManager {
  getMode(): SessionMode;
  /** 切换模式，可同时存储任意附属数据 */
  setMode(mode: SessionMode, data?: Record<string, unknown>): void;
  /** 读取当前模式附属数据中指定 key 的值 */
  getModeData<T = unknown>(key: string): T;
}

// ============ CommandContext ============

/** 命令执行时可访问的上下文 */
export interface CommandContext {
  ui: UIAdapter;
  config: AppConfig;
  context: ConversationManager;
  /** 任务规划器，仅在 Orchestrator 初始化 planner 后可用 */
  planner?: TaskPlanner;
  /** 会话模式管理器，负责讨论模式等特殊输入状态的路由 */
  session: SessionModeManager;
  /** 请求退出主循环 */
  exit(): void;
}

// ============ CommandDefinition ============

/** 单个斜杠命令的定义 */
export interface CommandDefinition {
  /** 命令名，不含 "/" */
  name: string;
  description: string;
  execute(args: string, ctx: CommandContext): Promise<void> | void;
}
