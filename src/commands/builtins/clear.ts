import type { CommandDefinition, CommandContext } from "../types.js";

export const clearCommand: CommandDefinition = {
  name: "clear",
  description: "清空当前对话上下文",
  async execute(_args: string, ctx: CommandContext): Promise<void> {
    ctx.context.clear();
    ctx.ui.showAssistantMessage("Context cleared.");
  },
};
