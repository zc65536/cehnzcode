import { commandRegistry } from "./registry.js";
import { createChildLogger } from "../logger/index.js";
import type { CommandDefinition } from "./types.js";

const logger = createChildLogger("command-loader");

/**
 * 自动加载所有内置命令
 * 使用动态 import 配合显式的文件列表，确保打包工具能正确处理
 */
export async function loadBuiltinCommands(): Promise<void> {
  // 显式列出所有命令文件，这样打包工具可以静态分析
  const commandFiles = [
    "./builtins/clear.js",
    "./builtins/exit.js",
    "./builtins/help.js",
    "./builtins/mcp.js",
    "./builtins/plan.js",
    "./builtins/skill.js",
  ];

  const commands: CommandDefinition[] = [];

  for (const file of commandFiles) {
    try {
      const mod = await import(file);
      // 支持具名导出（如 clearCommand）或 default 导出
      const candidates: unknown[] = mod.default ? [mod.default] : Object.values(mod);
      
      for (const candidate of candidates) {
        if (isCommandDefinition(candidate)) {
          commands.push(candidate);
        }
      }
    } catch (err) {
      logger.warn({ file, error: (err as Error).message }, "Failed to load builtin command");
    }
  }

  commandRegistry.registerAll(commands);
  logger.debug({ count: commands.length }, "Builtin commands loaded");
}

function isCommandDefinition(v: unknown): v is CommandDefinition {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as CommandDefinition).name === "string" &&
    typeof (v as CommandDefinition).description === "string" &&
    typeof (v as CommandDefinition).execute === "function"
  );
}

export { commandRegistry } from "./registry.js";
export type { CommandDefinition, CommandContext } from "./types.js";
