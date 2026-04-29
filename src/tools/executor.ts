import { eventBus } from "../events/index.js";
import { toolRegistry } from "./registry.js";
import { createChildLogger } from "../logger/index.js";
import { getMCPManager } from "../mcp/index.js";
import type { ToolCall, ToolResult, ToolContext } from "../types.js";

// 延迟创建 logger，避免在模块加载时触发配置加载
let logger: ReturnType<typeof createChildLogger> | null = null;
function getLogger() {
  if (!logger) {
    logger = createChildLogger("tool-executor");
  }
  return logger;
}

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

    // 检查是否需要用户批准
    if (this.needsApproval(call.name)) {
      // TODO: 实现用户确认提示
      // const approved = await ctx.ui.promptApproval(
      //   `Tool ${call.name} wants to execute. Approve?`
      // );
      // if (!approved) {
      //   return { callId: call.id, output: "", error: 'User denied tool execution' };
      // }

      // 临时：自动批准所有工具
      getLogger().warn({ tool: call.name }, "Tool requires approval but auto-approving for now");
    }

    await eventBus.emit("tool:before", { call });

    try {
      const output = await tool.execute(call.arguments, this.ctx);
      const result: ToolResult = { callId: call.id, output };
      await eventBus.emit("tool:after", { call, result });
      getLogger().debug({ tool: call.name }, "Tool executed successfully");
      return result;
    } catch (err) {
      const error = err as Error;
      await eventBus.emit("tool:error", { call, error });
      getLogger().error({ tool: call.name, error: error.message }, "Tool execution failed");
      return { callId: call.id, output: "", error: error.message };
    }
  }

  /**
   * 检查工具是否需要用户批准
   * @param toolName 工具名称
   */
  private needsApproval(toolName: string): boolean {
    // 如果是 MCP 工具，检查 autoApprove 列表
    if (toolName.startsWith("mcp__")) {
      const mcpManager = getMCPManager();
      return !mcpManager.isAutoApproved(toolName);
    }

    // 内置工具默认自动批准
    return false;
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
