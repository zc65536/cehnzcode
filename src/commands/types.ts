import type { AppConfig, UIAdapter } from "../types.js";
import type { ConversationManager } from "../context/index.js";

/** 命令执行时可访问的上下文 */
export interface CommandContext {
  ui: UIAdapter;
  config: AppConfig;
  context: ConversationManager;
  /** 请求退出主循环 */
  exit(): void;
}

/** 单个斜杠命令的定义 */
export interface CommandDefinition {
  /** 命令名，不含 "/" */
  name: string;
  description: string;
  execute(args: string, ctx: CommandContext): Promise<void> | void;
}
