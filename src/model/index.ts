import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "./retry.js";
import { eventBus } from "../events/index.js";
import { tokenTracker } from "../tokens/index.js";
import { apiLogger } from "../debug/api-logger.js";
import type { AppConfig, Turn, ToolDefinition, ModelResponse, ToolCall } from "../types.js";

export class ModelClient {
  private openaiClient?: OpenAI;
  private anthropicClient?: Anthropic;
  private config: AppConfig;
  private isClaudeModel: boolean;

  constructor(config: AppConfig) {
    this.config = config;
    // 根据模型名称判断是否使用 Claude
    this.isClaudeModel = config.model.toLowerCase().includes("claude");

    if (this.isClaudeModel) {
      this.anthropicClient = new Anthropic({
        apiKey: config.apiKey,
      });
    } else {
      this.openaiClient = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.apiBaseUrl,
      });
    }
  }

  async chat(turns: Turn[], tools: ToolDefinition[]): Promise<ModelResponse> {
    await eventBus.emit("model:before", { messages: turns });

    try {
      const result = this.isClaudeModel
        ? await this.chatWithClaude(turns, tools)
        : await this.chatWithOpenAI(turns, tools);

      tokenTracker.track(result.usage);
      await eventBus.emit("model:after", { response: result });
      return result;
    } catch (err) {
      await eventBus.emit("model:error", { error: err as Error });
      throw err;
    }
  }

  private async chatWithOpenAI(turns: Turn[], tools: ToolDefinition[]): Promise<ModelResponse> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    const messages = this.turnsToOpenAIMessages(turns);
    const toolSchemas = tools.length > 0 ? this.toolsToOpenAISchemas(tools) : undefined;

    const response = await withRetry(async () => {
      return this.openaiClient!.chat.completions.create({
        model: this.config.model,
        messages,
        tools: toolSchemas,
        max_tokens: this.config.maxTokens,
      });
    });

    const choice = response.choices[0];
    const toolCalls = this.extractOpenAIToolCalls(choice.message.tool_calls);

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

    // 调试日志：记录完整的请求和响应
    if (apiLogger.isEnabled()) {
      await apiLogger.log(
        {
          model: this.config.model,
          messages,
          tools: toolSchemas,
          maxTokens: this.config.maxTokens,
        },
        {
          content: result.content,
          toolCalls: result.toolCalls,
          usage: result.usage,
          finishReason: result.finishReason,
          rawResponse: response,
        }
      );
    }

    return result;
  }

  private async chatWithClaude(turns: Turn[], tools: ToolDefinition[]): Promise<ModelResponse> {
    if (!this.anthropicClient) {
      throw new Error("Anthropic client not initialized");
    }

    const { system, messages } = this.turnsToClaudeMessages(turns);
    const toolSchemas = tools.length > 0 ? this.toolsToClaudeSchemas(tools) : undefined;

    const response = await withRetry(async () => {
      const params: Anthropic.MessageCreateParams = {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system,
        messages,
      };
      if (toolSchemas) {
        params.tools = toolSchemas;
      }
      return this.anthropicClient!.messages.create(params);
    });

    const toolCalls = this.extractClaudeToolCalls(response.content);
    const textContent = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as Anthropic.TextBlock).text)
      .join("");

    const result: ModelResponse = {
      content: textContent,
      toolCalls,
      usage: {
        prompt: response.usage.input_tokens,
        completion: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason ?? "end_turn",
    };

    // 调试日志：记录完整的请求和响应
    if (apiLogger.isEnabled()) {
      await apiLogger.log(
        {
          model: this.config.model,
          system,
          messages,
          tools: toolSchemas,
          maxTokens: this.config.maxTokens,
        },
        {
          content: result.content,
          toolCalls: result.toolCalls,
          usage: result.usage,
          finishReason: result.finishReason,
          rawResponse: response,
        }
      );
    }

    return result;
  }

  async *chatStream(turns: Turn[], tools: ToolDefinition[]): AsyncIterable<string> {
    if (this.isClaudeModel) {
      yield* this.chatStreamWithClaude(turns, tools);
    } else {
      yield* this.chatStreamWithOpenAI(turns, tools);
    }
  }

  private async *chatStreamWithOpenAI(
    turns: Turn[],
    tools: ToolDefinition[]
  ): AsyncIterable<string> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    const messages = this.turnsToOpenAIMessages(turns);
    const toolSchemas = tools.length > 0 ? this.toolsToOpenAISchemas(tools) : undefined;

    const stream = await this.openaiClient.chat.completions.create({
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

  private async *chatStreamWithClaude(
    turns: Turn[],
    tools: ToolDefinition[]
  ): AsyncIterable<string> {
    if (!this.anthropicClient) {
      throw new Error("Anthropic client not initialized");
    }

    const { system, messages } = this.turnsToClaudeMessages(turns);
    const toolSchemas = tools.length > 0 ? this.toolsToClaudeSchemas(tools) : undefined;

    const params: Anthropic.MessageStreamParams = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system,
      messages,
    };
    if (toolSchemas) {
      params.tools = toolSchemas;
    }

    const stream = await this.anthropicClient.messages.stream(params);

    for await (const chunk of stream) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta.type === "text_delta"
      ) {
        yield chunk.delta.text;
      }
    }
  }

  // ==================== OpenAI 格式转换 ====================

  private turnsToOpenAIMessages(turns: Turn[]): OpenAI.ChatCompletionMessageParam[] {
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

  private toolsToOpenAISchemas(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
      },
    }));
  }

  private extractOpenAIToolCalls(
    raw: OpenAI.ChatCompletionMessageToolCall[] | undefined | null
  ): ToolCall[] {
    if (!raw) return [];
    return raw.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}"),
    }));
  }

  // ==================== Claude 格式转换 ====================

  private turnsToClaudeMessages(turns: Turn[]): {
    system: string;
    messages: Anthropic.MessageParam[];
  } {
    // Claude 的 system 是单独的字段，不在 messages 里
    const systemTurns = turns.filter((t) => t.role === "system");
    const system = systemTurns.map((t) => t.content).join("\n\n");

    const messages: Anthropic.MessageParam[] = [];

    for (const turn of turns) {
      if (turn.role === "user") {
        messages.push({ role: "user", content: turn.content });
      } else if (turn.role === "assistant") {
        const content: Anthropic.ContentBlock[] = [];

        // 添加文本内容
        if (turn.content) {
          content.push({ 
            type: "text", 
            text: turn.content,
            citations: null,
          } as Anthropic.TextBlock);
        }

        // 添加工具调用
        if (turn.toolCalls && turn.toolCalls.length > 0) {
          for (const tc of turn.toolCalls) {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
              caller: { type: "direct" },
            } as Anthropic.ToolUseBlock);
          }
        }

        if (content.length > 0) {
          messages.push({ role: "assistant", content });
        }
      } else if (turn.role === "tool" && turn.toolResults) {
        // Claude 的工具结果需要放在 user 消息中
        const toolResultContent: Anthropic.ToolResultBlockParam[] = turn.toolResults.map(
          (result) => ({
            type: "tool_result" as const,
            tool_use_id: result.callId,
            content: result.error ?? result.output,
            is_error: !!result.error,
          })
        );

        messages.push({
          role: "user",
          content: toolResultContent,
        });
      }
    }

    return { system, messages };
  }

  private toolsToClaudeSchemas(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        ...tool.parameters,
        type: "object",
      } as Anthropic.Tool.InputSchema,
    }));
  }

  private extractClaudeToolCalls(content: Anthropic.ContentBlock[]): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    for (const block of content) {
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return toolCalls;
  }
}
