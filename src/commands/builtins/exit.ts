import type { CommandDefinition, CommandContext } from "../types.js";

export const exitCommand: CommandDefinition = {
  name: "exit",
  description: "退出程序",
  execute(_args: string, ctx: CommandContext): void {
    ctx.exit();
  },
};
