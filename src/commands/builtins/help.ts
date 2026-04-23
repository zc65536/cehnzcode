import type { CommandDefinition, CommandContext } from "../types.js";
import { commandRegistry } from "../registry.js";

export const helpCommand: CommandDefinition = {
  name: "help",
  description: "显示所有可用命令",
  execute(_args: string, ctx: CommandContext): void {
    const lines = commandRegistry
      .getAll()
      .map((cmd) => `  /${cmd.name.padEnd(10)} ${cmd.description}`);
    ctx.ui.showAssistantMessage("Available commands:\n" + lines.join("\n"));
  },
};
