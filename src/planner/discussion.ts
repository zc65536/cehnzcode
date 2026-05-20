// src/planner/discussion.ts

import type { ModelClient } from "../model/index.js";
import type { Message, Turn, ToolDefinition, ToolCall, ToolResult } from "../types.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { PlanDiscussionSession, PlanContext } from "./types.js";
import { READY_MARKER } from "./types.js";
import { buildPlanDiscussionPrompt } from "../prompts/planner.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:discussion");

function makeTurn(id: string, role: Turn["role"], content: string, extra?: Partial<Turn>): Turn {
  return {
    id,
    role,
    content,
    tags: [role],
    tokenCount: 0,
    compressed: false,
    timestamp: Date.now(),
    ...extra,
  };
}

/** 讨论会话实现，管理用户与模型的多轮规划讨论，支持流式输出和工具调用 */
export class PlanDiscussionSessionImpl implements PlanDiscussionSession {
  /** 对外暴露的对话历史（仅 user/assistant，不含 tool 中间轮） */
  history: Message[];
  startedAt: number;

  private model: ModelClient;
  private context: PlanContext;
  /** 系统提示词单独存储 */
  private systemPrompt: string;
  /** 完整上下文（含 tool 结果），用于模型调用 */
  private contextTurns: Turn[];
  private turnSeq: number;

  constructor(model: ModelClient, context: PlanContext) {
    this.model = model;
    this.context = context;
    this.history = [];
    this.contextTurns = [];
    this.startedAt = Date.now();
    this.turnSeq = 0;
    this.systemPrompt = buildPlanDiscussionPrompt(context.projectInstructions);

    logger.info("Discussion session created");
  }

  async send(
    userInput: string,
    context: PlanContext,
    options: {
      onChunk?: (chunk: string) => void;
      tools?: ToolDefinition[];
      executor?: ToolExecutor;
    } = {}
  ): Promise<{ reply: string; readyToPlan: boolean }> {
    logger.info({ inputLength: userInput.length }, "Processing user input");

    // 允许调用方覆盖 context（例如更新后的 projectInstructions）
    this.context = { ...this.context, ...context };
    if (context.projectInstructions !== undefined) {
      this.systemPrompt = buildPlanDiscussionPrompt(context.projectInstructions);
    }

    const { onChunk, tools = [], executor } = options;

    // 追加用户消息
    this.history.push({ role: "user", content: userInput });
    this.contextTurns.push(this.newTurn("user", userInput));

    let finalReply = "";

    // agentic loop：模型可能连续调用工具，直到不再有工具调用为止
    while (true) {
      const turns: Turn[] = [
        this.newTurn("system", this.systemPrompt),
        ...this.contextTurns,
      ];

      let responseContent = "";
      let toolCalls: ToolCall[] = [];

      if (onChunk) {
        const { stream, getResponse } = this.model.chatStream(turns, tools);
        for await (const chunk of stream) {
          onChunk(chunk);
        }
        const response = await getResponse();
        responseContent = response.content;
        toolCalls = response.toolCalls;
      } else {
        const response = await this.model.chat(turns, tools);
        responseContent = response.content;
        toolCalls = response.toolCalls;
      }

      if (toolCalls.length === 0 || !executor) {
        finalReply = responseContent;
        break;
      }

      // 追加 assistant turn（含工具调用）
      this.contextTurns.push(this.newTurn("assistant", responseContent, { toolCalls }));
      logger.debug({ toolCount: toolCalls.length }, "Executing tool calls");

      // 执行工具
      const results: ToolResult[] = await executor.runAll(toolCalls);
      this.contextTurns.push(
        this.newTurn("tool", results.map(r => r.output || r.error || "").join("\n"), {
          toolResults: results,
        })
      );
    }

    const readyToPlan = this.detectReadyMarker(finalReply);
    // 存入历史时去掉标记——历史是传给下一阶段模型的对话记录，不应含实现细节标记
    const cleanReply = readyToPlan ? this.removeReadyMarker(finalReply) : finalReply;

    this.history.push({ role: "assistant", content: cleanReply });
    this.contextTurns.push(this.newTurn("assistant", cleanReply));

    logger.info({ readyToPlan, replyLength: cleanReply.length }, "Discussion turn completed");

    return { reply: cleanReply, readyToPlan };
  }

  getHistory(): Message[] {
    // system 提示词单独存储，不进入 history，此处再过滤一次作防御
    return this.history
      .filter(msg => msg.role !== "system")
      .map(msg => ({ ...msg }));
  }

  private newTurn(role: Turn["role"], content: string, extra?: Partial<Turn>): Turn {
    return makeTurn(`discussion-${++this.turnSeq}`, role, content, extra);
  }

  private detectReadyMarker(content: string): boolean {
    const pattern = new RegExp(`\\s*${escapeRegex(READY_MARKER)}\\s*$`);
    return pattern.test(content);
  }

  private removeReadyMarker(content: string): string {
    const pattern = new RegExp(`\\s*${escapeRegex(READY_MARKER)}\\s*$`);
    return content.replace(pattern, "").trimEnd();
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
