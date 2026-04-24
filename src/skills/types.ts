import type { Turn, ToolCall, ToolResult, ToolDefinition, ModelResponse, AppConfig } from "../types.js";

export interface SkillContext {
  toolExecutor: { run(call: ToolCall): Promise<ToolResult> };
  model: { chat(messages: Turn[], tools: ToolDefinition[]): Promise<ModelResponse> };
  context: { getTurns(): Turn[]; addTurn(turn: Partial<Turn>): void };
  config: AppConfig;
  args: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  execute(ctx: SkillContext): Promise<string>;
}
