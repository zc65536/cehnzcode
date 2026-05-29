import { commandRegistry } from "./registry.js";
import { createChildLogger } from "../logger/index.js";

// 静态导入所有内置命令，打包工具可以在编译期将其全部内联
// 不使用动态 import()，因为打包成单文件后运行时动态加载路径会失效
import { clearCommand } from "./builtins/clear.js";
import { exitCommand } from "./builtins/exit.js";
import { helpCommand } from "./builtins/help.js";
import { mcpCommand } from "./builtins/mcp.js";
import { planCommand } from "./builtins/plan.js";
import { skillCommand } from "./builtins/skill.js";
import { knowledgeCommand } from "./builtins/knowledge.js";

const logger = createChildLogger("command-loader");

/**
 * 注册所有内置命令
 */
export async function loadBuiltinCommands(): Promise<void> {
  const commands = [
    clearCommand,
    exitCommand,
    helpCommand,
    mcpCommand,
    planCommand,
    skillCommand,
    knowledgeCommand,
  ];

  commandRegistry.registerAll(commands);
  logger.debug({ count: commands.length }, "Builtin commands loaded");
}

export { commandRegistry } from "./registry.js";
export type { CommandDefinition, CommandContext } from "./types.js";
