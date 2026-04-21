import { eventBus } from "../events/index.js";
import { toolRegistry } from "./registry.js";
import { createChildLogger } from "../logger/index.js";
import type { ToolCall, ToolResult, ToolContext } from "../types.js";

const logger = createChildLogger("tool-executor");

export class ToolExecutor {
  private ctx: ToolContext;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  async run(call: ToolCall): Promise<ToolResult> {
    const tool = toolRegistry.get(call.name);
    if (!tool) {
      return { callId: call.id, output: "", error: `Unknown tool: ${call.name}` };
    }

    await eventBus.emit("tool:before", { call });

    try {
      const output = await tool.execute(call.arguments, this.ctx);
      const result: ToolResult = { callId: call.id, output };
      await eventBus.emit("tool:after", { call, result });
      logger.debug({ tool: call.name }, "Tool executed successfully");
      return result;
    } catch (err) {
      const error = err as Error;
      await eventBus.emit("tool:error", { call, error });
      logger.error({ tool: call.name, error: error.message }, "Tool execution failed");
      return { callId: call.id, output: "", error: error.message };
    }
  }

  async runAll(calls: ToolCall[]): Promise<ToolResult[]> {
    const results = await Promise.allSettled(calls.map((call) => this.run(call)));
    return results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { callId: calls[i].id, output: "", error: (r.reason as Error).message }
    );
  }
}
