import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "./retry.js";
import { eventBus } from "../events/index.js";
import { tokenTracker } from "../tokens/index.js";
import { apiLogger } from "../debug/api-logger.js";
import { createChildLogger } from "../logger/index.js";
import type { AppConfig, Turn, ToolDefinition, ModelResponse, ToolCall } from "../types.js";

const logger = createChildLogger("model");

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

  /**
   * 流式聊天，返回文本流和最终的usage信息
   * 使用方式：
   *   const { stream, getResponse } = model.chatStream(turns, tools);
   *   for await (const chunk of stream) { ... }
   *   const response = await getResponse(); // 获取完整响应和usage
   */
  chatStream(turns: Turn[], tools: ToolDefinition[]): {
    stream: AsyncIterable<string>;
    getResponse: () => Promise<ModelResponse>;
  } {
    if (this.isClaudeModel) {
      return this.chatStreamWithClaudeWrapper(turns, tools);
    } else {
      return this.chatStreamWithOpenAIWrapper(turns, tools);
    }
  }

  private chatStreamWithOpenAIWrapper(
    turns: Turn[],
    tools: ToolDefinition[]
  ): {
    stream: AsyncIterable<string>;
    getResponse: () => Promise<ModelResponse>;
  } {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    const messages = this.turnsToOpenAIMessages(turns);
    const toolSchemas = tools.length > 0 ? this.toolsToOpenAISchemas(tools) : undefined;

    let fullContent = "";
    let fullResponse: any = null;
    let streamFinished = false;
    const toolCallsMap = new Map<number, { id: string; name: string; argsStr: string }>();

    const streamPromise = this.openaiClient.chat.completions.create({
      model: this.config.model,
      messages,
      tools: toolSchemas,
      max_tokens: this.config.maxTokens,
      stream: true,
      stream_options: { include_usage: true }, // 请求返回usage信息
    });

    const stream = (async function* (this: ModelClient) {
      const streamResponse = await streamPromise;
      
      for await (const chunk of streamResponse) {
        const delta = chunk.choices[0]?.delta;
        
        // 收集文本内容
        if (delta?.content) {
          fullContent += delta.content;
          yield delta.content;
        }

        // 收集工具调用
        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index;
            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, {
                id: toolCall.id || "",
                name: toolCall.function?.name || "",
                argsStr: "",
              });
            }
            const existing = toolCallsMap.get(index)!;
            if (toolCall.id) existing.id = toolCall.id;
            if (toolCall.function?.name) existing.name = toolCall.function.name;
            if (toolCall.function?.arguments) {
              existing.argsStr += toolCall.function.arguments;
            }
          }
        }

        // 保存最后一个chunk（包含usage信息）
        fullResponse = chunk;
      }

      streamFinished = true;
    }).bind(this)();

    const getResponse = async (): Promise<ModelResponse> => {
      // 等待流式输出完成
      if (!streamFinished) {
        for await (const _ of stream) {
          // 消费完所有流
        }
      }

      // 解析工具调用
      const toolCalls: ToolCall[] = [];
      for (const [_, tc] of toolCallsMap) {
        if (tc.id && tc.name) {
          try {
            toolCalls.push({
              id: tc.id,
              name: tc.name,
              arguments: tc.argsStr ? JSON.parse(tc.argsStr) : {},
            });
          } catch (err) {
            logger.error({ error: err, argsStr: tc.argsStr }, "Failed to parse tool call arguments");
          }
        }
      }

      const result: ModelResponse = {
        content: fullContent,
        toolCalls,
        usage: {
          prompt: fullResponse?.usage?.prompt_tokens ?? 0,
          completion: fullResponse?.usage?.completion_tokens ?? 0,
          total: fullResponse?.usage?.total_tokens ?? 0,
        },
        finishReason: fullResponse?.choices[0]?.finish_reason ?? "stop",
      };

      // 如果没有usage信息，使用fallback估算
      if (result.usage.total === 0) {
        const promptText = JSON.stringify(messages);
        result.usage = {
          prompt: 0, // 将在track中估算
          completion: 0,
          total: 0,
        };
      }

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
          }
        );
      }

      return result;
    };

    return { stream, getResponse };
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

  private chatStreamWithClaudeWrapper(
    turns: Turn[],
    tools: ToolDefinition[]
  ): {
    stream: AsyncIterable<string>;
    getResponse: () => Promise<ModelResponse>;
  } {
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

    let fullContent = "";
    let fullMessage: Anthropic.Message | null = null;
    let streamFinished = false;

    const streamPromise = this.anthropicClient.messages.stream(params);

    const stream = (async function* () {
      const streamResponse = await streamPromise;

      for await (const chunk of streamResponse) {
        if (
          chunk.type === "content_block_delta" &&
          chunk.delta.type === "text_delta"
        ) {
          fullContent += chunk.delta.text;
          yield chunk.delta.text;
        }
      }

      // 获取最终的完整消息（包含usage）
      fullMessage = await streamResponse.finalMessage();
      streamFinished = true;
    })();

    const getResponse = async (): Promise<ModelResponse> => {
      // 等待流式输出完成
      if (!streamFinished) {
        for await (const _ of stream) {
          // 消费完所有流
        }
      }

      if (!fullMessage) {
        throw new Error("Stream did not complete successfully");
      }

      const toolCalls = this.extractClaudeToolCalls(fullMessage.content);

      const result: ModelResponse = {
        content: fullContent,
        toolCalls,
        usage: {
          prompt: fullMessage.usage.input_tokens,
          completion: fullMessage.usage.output_tokens,
          total: fullMessage.usage.input_tokens + fullMessage.usage.output_tokens,
        },
        finishReason: fullMessage.stop_reason ?? "end_turn",
      };

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
          }
        );
      }

      return result;
    };

    return { stream, getResponse };
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
