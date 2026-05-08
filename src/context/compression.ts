import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Turn, AppConfig, CompressionStrategy } from "../types.js";
import type { CompressionResult, CompressionMetadata } from "./types.js";
import { createChildLogger } from "../logger/index.js";
import { compressWithTools } from "./compression-agent.js";
import { createCompressionTools } from "./compression-tools.js";
import { ModelClient } from "../model/index.js";
import { estimateTokens } from "../tokens/index.js";
import {
  DELETION_COMPRESSION_PROMPT,
  COMPRESSION_PROMPT,
  COMPRESSION_SUPPLEMENT_PROMPT,
  COMPRESSION_LABELS,
} from "../prompts/compression.js";

const logger = createChildLogger("compression");

const strategies = new Map<string, CompressionStrategy>();

export function registerStrategy(strategy: CompressionStrategy): void {
  strategies.set(strategy.name, strategy);
}

export function getStrategy(name: string): CompressionStrategy | undefined {
  return strategies.get(name);
}

/**
 * 主压缩入口
 * 
 * @param turns 待压缩的对话轮次
 * @param config 应用配置
 * @param sessionId 会话 ID
 * @param metadata 压缩元信息
 * @returns 压缩结果
 */
export async function compress(
  turns: Turn[],
  config: AppConfig,
  sessionId: string,
  metadata: CompressionMetadata
): Promise<CompressionResult> {
  try {
    logger.info({ 
      turnsCount: turns.length, 
      compressionCount: metadata.count,
      sessionId 
    }, "Starting compression");

    // 确定压缩策略
    const strategy = getCompressionStrategy(metadata.count);
    logger.debug({ strategy }, "Selected compression strategy");

    // 获取 RAG 文件路径
    const ragPath = path.join(config.sessionDir, sessionId, "rag.json");

    // 分段压缩（两段）
    const midPoint = Math.floor(turns.length / 2);
    const firstHalf = turns.slice(0, midPoint);
    const secondHalf = turns.slice(midPoint);

    logger.debug({ 
      firstHalfCount: firstHalf.length, 
      secondHalfCount: secondHalf.length 
    }, "Split turns into two segments");

    // 并行压缩两段
    const [firstCompressed, secondCompressed] = await Promise.all([
      compressSegment(firstHalf, strategy, ragPath, config),
      compressSegment(secondHalf, strategy, ragPath, config),
    ]);

    // 合并结果
    const finalSummary = `${firstCompressed}\n\n---\n\n${secondCompressed}`;

    logger.info({ 
      removedCount: turns.length,
      compressionCount: metadata.count + 1 
    }, "Compression completed successfully");

    return {
      summary: finalSummary,
      removedCount: turns.length,
      success: true,
      ragEntriesAdded: 0, // TODO: 从 RAG 文件中计算
    };
  } catch (err) {
    logger.error({ error: (err as Error).message }, "Compression failed");
    return {
      summary: "",
      removedCount: 0,
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * 压缩单个段落
 * 
 * @param turns 待压缩的对话轮次
 * @param strategy 压缩策略
 * @param ragPath RAG 文件路径
 * @param config 应用配置
 * @returns 压缩后的内容
 */
async function compressSegment(
  turns: Turn[],
  strategy: "deletion" | "tagging" | "supplement",
  ragPath: string,
  config: AppConfig
): Promise<string> {
  // 获取压缩提示词
  const prompt = getCompressionPrompt(strategy, ragPath);

  // 第一次压缩（deletion）不需要工具，直接调用模型
  if (strategy === "deletion") {
    const modelClient = new ModelClient(config);
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

    const response = await modelClient.chat(compressionTurns, []); // 不提供工具
    return response.content;
  }

  // 第二次和第三次压缩需要工具（tagging 和 supplement）
  const tools = createCompressionTools();
  const compressed = await compressWithTools(turns, prompt, tools, ragPath, config);
  return compressed;
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

/**
 * 根据压缩次数确定压缩策略
 * 
 * @param compressionCount 当前压缩次数
 * @returns 压缩策略名称
 */
function getCompressionStrategy(compressionCount: number): "deletion" | "tagging" | "supplement" {
  if (compressionCount === 0) {
    return "deletion";
  } else if (compressionCount === 1) {
    return "tagging";
  } else {
    return "supplement";
  }
}

/**
 * 获取压缩提示词
 * 
 * @param strategy 压缩策略
 * @param ragPath RAG 文件路径
 * @returns 完整的压缩提示词
 */
function getCompressionPrompt(
  strategy: "deletion" | "tagging" | "supplement",
  ragPath: string
): string {
  let basePrompt: string;

  if (strategy === "deletion") {
    // 第一次压缩：只删除冗余，不需要 RAG
    return DELETION_COMPRESSION_PROMPT;
  } else if (strategy === "tagging") {
    basePrompt = COMPRESSION_PROMPT + "\n\n" + COMPRESSION_LABELS;
  } else {
    basePrompt = COMPRESSION_SUPPLEMENT_PROMPT + "\n\n" + COMPRESSION_LABELS;
  }

  // 第二次和第三次压缩：添加 RAG 说明
  return `${basePrompt}

## RAG File Location

The RAG file for this session is located at: \`${ragPath}\`

- If the file doesn't exist yet, you can create it using \`write_file\`
- If it exists, you can read it using \`read_file\` and update it using \`edit_file\`
- All large content blocks (code, data, error logs) should be stored in this file
- Use unique IDs like "rag#001", "rag#002", etc.
- Reference stored content in your compressed output using: <REF id="unique-id" rag="rag#001" file="path/to/file" confidence="high|medium|stale"/>

Remember: This RAG file persists across multiple compressions. You can reference entries created in previous compressions.
`;
}
