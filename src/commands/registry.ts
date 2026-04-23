import { createChildLogger } from "../logger/index.js";
import type { CommandDefinition, CommandContext } from "./types.js";

const logger = createChildLogger("command-registry");

class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();

  register(cmd: CommandDefinition): void {
    if (this.commands.has(cmd.name)) {
      logger.warn({ command: cmd.name }, "Overwriting existing command");
    }
    this.commands.set(cmd.name, cmd);
    logger.debug({ command: cmd.name }, "Command registered");
  }

  registerAll(cmds: CommandDefinition[]): void {
    for (const cmd of cmds) {
      this.register(cmd);
    }
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  getAll(): CommandDefinition[] {
    return [...this.commands.values()];
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * 解析并执行斜杠命令字符串，如 "/clear" 或 "/help foo"
   * 返回 true 表示命令已处理，false 表示命令不存在
   */
  async execute(input: string, ctx: CommandContext): Promise<boolean> {
    const trimmed = input.startsWith("/") ? input.slice(1) : input;
    const spaceIdx = trimmed.indexOf(" ");
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

    const cmd = this.commands.get(name);
    if (!cmd) return false;

    logger.debug({ command: name, args }, "Executing command");
    await cmd.execute(args, ctx);
    return true;
  }
}

export const commandRegistry = new CommandRegistry();
