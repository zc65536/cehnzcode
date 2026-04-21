import type { ToolDefinition } from "../types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("tool-registry");

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      logger.warn({ tool: tool.name }, "Overwriting existing tool");
    }
    this.tools.set(tool.name, tool);
    logger.debug({ tool: tool.name }, "Tool registered");
  }

  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  getSchemas(): { name: string; description: string; parameters: unknown }[] {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  clear(): void {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistry();
