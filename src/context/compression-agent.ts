import { randomUUID } from "node:crypto";
import { ModelClient } from "../model/index.js";
import { estimateTokens } from "../tokens/index.js";
import { createChildLogger } from "../logger/index.js";
import type { Turn, ToolDefinition, AppConfig, ToolContext } from "../types.js";

const logger = createChildLogger("compression-agent");

/**
 * 压缩 Mini-Agent
 * 
 * 这是一个独立的 agent，有自己的工具调用循环
 * 用于执行带工具调用的压缩任务
 */

const MAX_ITERATIONS = 15; // 最大迭代次数，防止无限循环

/**
 * 使用工具进行压缩
 * 
 * @param turns 待压缩的对话轮次
 * @param prompt 压缩提示词（包含 RAG 说明）
 * @param tools 可用的工具列表
 * @param ragPath RAG 文件路径
 * @param config 应用配置
 * @returns 压缩后的内容
 */
export async function compressWithTools(
  turns: Turn[],
  prompt: string,
  tools: ToolDefinition[],
  ragPath: string,
  config: AppConfig
): Promise<string> {
  logger.debug({ turnsCount: turns.length, ragPath }, "Starting compression with tools");

  // 构造压缩对话
  const compressionTurns: Turn[] = [
    {
      id: randomUUID(),
      role: "system",
      content: prompt,
      tags: ["compression", "system"],
      tokenCount: estimateTokens(prompt),
      compressed: false,
      timestamp: Date.now(),
    },
    {
      id: randomUUID(),
      role: "user",
      content: formatTurnsForCompression(turns),
      tags: ["compression", "user"],
      tokenCount: estimateTokens(formatTurnsForCompression(turns)),
      compressed: false,
      timestamp: Date.now(),
    },
  ];

  // 创建模型客户端
  const modelClient = new ModelClient(config);
  
  // 创建工具映射表，用于快速查找
  const toolMap = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  let iteration = 0;
  let lastAssistantContent = "";

  // 工具调用循环
  while (iteration < MAX_ITERATIONS) {
    iteration++;
    logger.debug({ iteration }, "Compression iteration");

    try {
      // 调用模型
      const response = await modelClient.chat(compressionTurns, tools);

      // 记录 assistant 的回复
      const assistantTurn: Turn = {
        id: randomUUID(),
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
        tags: ["compression", "assistant"],
        tokenCount: response.usage.completion,
        compressed: false,
        timestamp: Date.now(),
      };
      compressionTurns.push(assistantTurn);
      lastAssistantContent = response.content;

      // 如果没有工具调用，说明压缩完成
      if (response.toolCalls.length === 0) {
        logger.info({ iterations: iteration }, "Compression completed without tool calls");
        return response.content;
      }

      // 执行工具调用（使用我们自己的工具映射）
      logger.debug({ toolCalls: response.toolCalls.length }, "Executing tool calls");
      const toolResults = [];
      
      for (const call of response.toolCalls) {
        const tool = toolMap.get(call.name);
        
        if (!tool) {
          toolResults.push({
            callId: call.id,
            output: "",
            error: `Unknown tool: ${call.name}`,
          });
          continue;
        }

        try {
          const toolContext: ToolContext = {
            cwd: process.cwd(),
            config,
            signal: AbortSignal.timeout(config.toolTimeout),
          };
          
          const output = await tool.execute(call.arguments, toolContext);
          toolResults.push({
            callId: call.id,
            output,
          });
        } catch (err) {
          const error = err as Error;
          toolResults.push({
            callId: call.id,
            output: "",
            error: error.message,
          });
        }
      }

      // 记录工具结果
      const toolTurn: Turn = {
        id: randomUUID(),
        role: "tool",
        content: "",
        toolResults,
        tags: ["compression", "tool"],
        tokenCount: estimateTokens(toolResults.map((r) => r.output || r.error || "").join("\n")),
        compressed: false,
        timestamp: Date.now(),
      };
      compressionTurns.push(toolTurn);

      // 检查是否有工具执行失败
      const hasError = toolResults.some((r) => r.error);
      if (hasError) {
        logger.warn({ errors: toolResults.filter((r) => r.error) }, "Some tools failed");
      }
    } catch (err) {
      const error = err as Error;
      logger.error({ error: error.message, iteration }, "Compression iteration failed");
      
      // 如果已经有部分压缩结果，返回它
      if (lastAssistantContent) {
        logger.warn("Returning partial compression result due to error");
        return lastAssistantContent;
      }
      
      throw new Error(`Compression failed at iteration ${iteration}: ${error.message}`);
    }
  }

  // 达到最大迭代次数
  logger.warn({ maxIterations: MAX_ITERATIONS }, "Reached max iterations, returning last result");
  
  if (!lastAssistantContent) {
    throw new Error("Compression failed: no result after max iterations");
  }
  
  return lastAssistantContent;
}

/**
 * 格式化对话轮次为压缩输入
 * 
 * @param turns 对话轮次
 * @returns 格式化后的字符串
 */
function formatTurnsForCompression(turns: Turn[]): string {
  const formatted = turns.map((turn) => {
    let header = `[${turn.role.toUpperCase()}]`;
    
    if (turn.timestamp) {
      const date = new Date(turn.timestamp);
      header += ` ${date.toISOString()}`;
    }
    
    let content = turn.content;
    
    // 如果有工具调用，添加到内容中
    if (turn.toolCalls && turn.toolCalls.length > 0) {
      const toolCallsStr = turn.toolCalls
        .map((tc) => `Tool Call: ${tc.name}(${JSON.stringify(tc.arguments)})`)
        .join("\n");
      content = content ? `${content}\n\n${toolCallsStr}` : toolCallsStr;
    }
    
    // 如果有工具结果，添加到内容中
    if (turn.toolResults && turn.toolResults.length > 0) {
      const toolResultsStr = turn.toolResults
        .map((tr) => {
          if (tr.error) {
            return `Tool Error: ${tr.error}`;
          }
          return `Tool Result: ${tr.output}`;
        })
        .join("\n");
      content = content ? `${content}\n\n${toolResultsStr}` : toolResultsStr;
    }
    
    return `${header}\n${content}`;
  });
  
  return formatted.join("\n\n---\n\n");
}
