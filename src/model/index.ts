import OpenAI from "openai";
import { withRetry } from "./retry.js";
import { eventBus } from "../events/index.js";
import { tokenTracker } from "../tokens/index.js";
import type { AppConfig, Turn, ToolDefinition, ModelResponse, ToolCall } from "../types.js";

export class ModelClient {
  private client: OpenAI;
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.apiBaseUrl,
    });
  }

  async chat(turns: Turn[], tools: ToolDefinition[]): Promise<ModelResponse> {
    const messages = this.turnsToMessages(turns);
    const toolSchemas = tools.length > 0 ? this.toolsToSchemas(tools) : undefined;

    await eventBus.emit("model:before", { messages: turns });

    try {
      const response = await withRetry(async () => {
        return this.client.chat.completions.create({
          model: this.config.model,
          messages,
          tools: toolSchemas,
          max_tokens: this.config.maxTokens,
        });
      });

      const choice = response.choices[0];
      const toolCalls = this.extractToolCalls(choice.message.tool_calls);

      const result: ModelResponse = {
        content: choice.message.content ?? "",
        toolCalls,
        usage: {
          prompt: response.usage?.prompt_tokens ?? 0,
          completion: response.usage?.completion_tokens ?? 0,
          total: response.usage?.total_tokens ?? 0,
        },
        finishReason: choice.finish_reason ?? "stop",
      };

      tokenTracker.track(result.usage);
      await eventBus.emit("model:after", { response: result });
      return result;
    } catch (err) {
      await eventBus.emit("model:error", { error: err as Error });
      throw err;
    }
  }

  async *chatStream(turns: Turn[], tools: ToolDefinition[]): AsyncIterable<string> {
    const messages = this.turnsToMessages(turns);
    const toolSchemas = tools.length > 0 ? this.toolsToSchemas(tools) : undefined;

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages,
      tools: toolSchemas,
      max_tokens: this.config.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  private turnsToMessages(turns: Turn[]): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    for (const turn of turns) {
      if (turn.role === "system") {
        messages.push({ role: "system", content: turn.content });
      } else if (turn.role === "user") {
        messages.push({ role: "user", content: turn.content });
      } else if (turn.role === "assistant") {
        if (turn.toolCalls && turn.toolCalls.length > 0) {
          messages.push({
            role: "assistant",
            content: turn.content || null,
            tool_calls: turn.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          });
        } else {
          messages.push({ role: "assistant", content: turn.content });
        }
      } else if (turn.role === "tool" && turn.toolResults) {
        for (const result of turn.toolResults) {
          messages.push({
            role: "tool",
            tool_call_id: result.callId,
            content: result.error ?? result.output,
          });
        }
      }
    }

    return messages;
  }

  private toolsToSchemas(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
      },
    }));
  }

  private extractToolCalls(
    raw: OpenAI.ChatCompletionMessageToolCall[] | undefined | null
  ): ToolCall[] {
    if (!raw) return [];
    return raw.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}"),
    }));
  }
}
