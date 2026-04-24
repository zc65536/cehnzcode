/**
 * Token 用量追踪模块
 *
 * 设计理念：
 *   - 优先使用模型 API 返回的 usage 字段（最准确）
 *   - 当 API 不返回 usage 时，使用本地估算（基于正则和数学运算）
 *   - 提供简单的用量追踪和统计功能
 *
 * 使用场景：
 *   - 追踪每次模型调用的 token 用量
 *   - 统计累计用量
 *   - 监控上下文窗口大小
 */

import type { TokenUsage, Turn } from "../types.js";

// ==================== Token 估算器 ====================

/**
 * TokenEstimator：基于正则和数学运算的本地 token 估算器
 * 
 * 估算规则（基于 GPT/Claude 等主流模型的 tokenizer 特性）：
 *   - 中文字符：每个字符约 1.5-2 tokens（取 1.8）
 *   - 英文单词：平均每个单词约 1.3 tokens
 *   - 数字：连续数字每 2-3 位约 1 token
 *   - 标点符号：大部分单个标点 1 token
 *   - 空白字符：通常不单独计数，但影响分词
 *   - 代码：特殊字符和操作符通常各占 1 token
 */
class TokenEstimator {
  /**
   * 估算文本的 token 数量
   * @param text 要估算的文本
   * @returns 估算的 token 数量
   */
  estimate(text: string): number {
    if (!text || text.length === 0) return 0;

    let tokens = 0;

    // 1. 提取并计算中文字符（包括中文标点）
    const chineseChars = text.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g);
    if (chineseChars) {
      tokens += Math.ceil(chineseChars.length * 1.8);
      // 从文本中移除已计算的中文字符
      text = text.replace(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g, '');
    }

    // 2. 提取并计算英文单词（连续字母）
    const englishWords = text.match(/[a-zA-Z]+/g);
    if (englishWords) {
      tokens += Math.ceil(englishWords.length * 1.3);
      text = text.replace(/[a-zA-Z]+/g, '');
    }

    // 3. 提取并计算数字
    const numbers = text.match(/\d+/g);
    if (numbers) {
      for (const num of numbers) {
        // 每 2.5 位数字约 1 token
        tokens += Math.ceil(num.length / 2.5);
      }
      text = text.replace(/\d+/g, '');
    }

    // 4. 计算剩余字符（标点、特殊符号、空白等）
    // 移除空白字符后计算
    const remaining = text.replace(/\s+/g, '');
    if (remaining.length > 0) {
      // 大部分标点和特殊符号各占 1 token
      tokens += remaining.length;
    }

    // 5. 添加基础开销（消息格式、边界等）
    tokens += 4;

    return Math.ceil(tokens);
  }

  /**
   * 估算 JSON 对象的 token 数量
   * @param obj 要估算的对象
   * @returns 估算的 token 数量
   */
  estimateJSON(obj: any): number {
    return this.estimate(JSON.stringify(obj));
  }

  /**
   * 批量估算多个文本片段
   * @param texts 文本数组
   * @returns 总 token 数量
   */
  estimateBatch(texts: string[]): number {
    return texts.reduce((sum, text) => sum + this.estimate(text), 0);
  }
}

// 全局估算器实例
const estimator = new TokenEstimator();

// ==================== Token 用量追踪 ====================

/**
 * TokenTracker：追踪每轮和累计的 token 用量。
 * 由 Orchestrator 持有，在每次模型响应后调用 track()。
 */
export class TokenTracker {
  private cumulative: TokenUsage = { prompt: 0, completion: 0, total: 0 };
  private turnHistory: TokenUsage[] = [];
  private contextTokens = 0; // 当前上下文窗口中的 token 数
  readonly model: string;

  constructor(model = "gpt-4") {
    this.model = model;
  }

  /**
   * 记录一次模型调用的 token 用量
   * 
   * @param usage 模型 API 返回的 usage 对象（可选）
   * @param fallbackData 当 usage 不可用时，用于估算的原始数据
   */
  track(
    usage?: TokenUsage | null,
    fallbackData?: {
      promptText?: string;
      completionText?: string;
    }
  ): void {
    let finalUsage: TokenUsage;

    // 优先使用 API 返回的 usage
    if (usage && usage.total > 0) {
      finalUsage = usage;
    } 
    // 如果没有 usage，使用本地估算
    else if (fallbackData) {
      const promptTokens = fallbackData.promptText 
        ? estimator.estimate(fallbackData.promptText)
        : 0;
      const completionTokens = fallbackData.completionText
        ? estimator.estimate(fallbackData.completionText)
        : 0;

      finalUsage = {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens
      };
    } 
    // 既没有 usage 也没有 fallback 数据
    else {
      console.warn('[TokenTracker] No usage data or fallback data provided, skipping track');
      return;
    }

    // 记录用量
    this.cumulative.prompt += finalUsage.prompt;
    this.cumulative.completion += finalUsage.completion;
    this.cumulative.total += finalUsage.total;
    this.turnHistory.push({ ...finalUsage });
    
    // 上下文中的 token 数 = 本次请求的 prompt tokens
    this.contextTokens = finalUsage.prompt;
  }

  /**
   * 更新当前上下文 token 数（压缩后由 ConversationManager 调用）
   * @param count 新的上下文 token 数
   */
  setContextTokens(count: number): void {
    this.contextTokens = count;
  }

  /**
   * 当前上下文窗口中的 token 数（用于判断是否触发压缩）
   */
  totalInContext(): number {
    return this.contextTokens;
  }

  /**
   * 累计用量（整个会话）
   */
  getCumulative(): TokenUsage {
    return { ...this.cumulative };
  }

  /**
   * 最近一次调用的用量
   */
  getLastTurn(): TokenUsage | null {
    if (this.turnHistory.length === 0) return null;
    return { ...this.turnHistory[this.turnHistory.length - 1] };
  }

  /**
   * 完整的每轮用量历史
   */
  getTurnHistory(): TokenUsage[] {
    return [...this.turnHistory];
  }

  /**
   * 重置所有统计（新会话时调用）
   */
  reset(): void {
    this.cumulative = { prompt: 0, completion: 0, total: 0 };
    this.turnHistory = [];
    this.contextTokens = 0;
  }

  /**
   * 获取统计摘要
   */
  getSummary(): {
    cumulative: TokenUsage;
    lastTurn: TokenUsage | null;
    contextTokens: number;
    turnCount: number;
  } {
    return {
      cumulative: this.getCumulative(),
      lastTurn: this.getLastTurn(),
      contextTokens: this.contextTokens,
      turnCount: this.turnHistory.length,
    };
  }
}

// ==================== 全局单例 ====================

/**
 * 全局单例，供 Orchestrator 直接使用
 * 模型名在 Orchestrator 初始化时通过构造函数传入
 */
export const tokenTracker = new TokenTracker();

// ==================== 辅助函数 ====================

/**
 * 从 Turn 数组估算 token 数（用于压缩前的粗略估算）
 * 使用本地估算器进行更精准的计算
 *
 * @param turns Turn 数组
 * @returns 估算的 token 数
 */
export function estimateTokensFromTurns(turns: Turn[]): number {
  let total = 0;

  for (const turn of turns) {
    // 如果 Turn 已经有缓存的 tokenCount，直接使用
    if (turn.tokenCount > 0) {
      total += turn.tokenCount;
      continue;
    }

    // 使用估算器计算
    if (turn.content) {
      total += estimator.estimate(turn.content);
    }

    if (turn.toolCalls) {
      for (const call of turn.toolCalls) {
        total += estimator.estimate(call.name);
        total += estimator.estimateJSON(call.arguments);
      }
    }

    if (turn.toolResults) {
      for (const result of turn.toolResults) {
        total += estimator.estimate(result.output);
        if (result.error) {
          total += estimator.estimate(result.error);
        }
      }
    }

    // 每个 Turn 的消息格式开销
    total += 4;
  }

  return total;
}

/**
 * 创建一个空的 TokenUsage 对象
 */
export function createEmptyUsage(): TokenUsage {
  return { prompt: 0, completion: 0, total: 0 };
}

/**
 * 合并多个 TokenUsage 对象
 */
export function mergeUsage(...usages: TokenUsage[]): TokenUsage {
  const result = createEmptyUsage();
  for (const usage of usages) {
    result.prompt += usage.prompt;
    result.completion += usage.completion;
    result.total += usage.total;
  }
  return result;
}

/**
 * 格式化 TokenUsage 为可读字符串
 */
export function formatUsage(usage: TokenUsage): string {
  return `prompt: ${usage.prompt}, completion: ${usage.completion}, total: ${usage.total}`;
}

/**
 * 计算 token 用量的成本（需要提供价格配置）
 * @param usage Token 用量
 * @param pricing 价格配置（每百万 token 的价格）
 */
export function calculateCost(
  usage: TokenUsage,
  pricing: { promptPer1M: number; completionPer1M: number }
): number {
  const promptCost = (usage.prompt / 1_000_000) * pricing.promptPer1M;
  const completionCost =
    (usage.completion / 1_000_000) * pricing.completionPer1M;
  return promptCost + completionCost;
}

/**
 * 直接估算文本的 token 数量（导出供外部使用）
 * @param text 要估算的文本
 * @returns 估算的 token 数量
 */
export function estimateTokens(text: string): number {
  return estimator.estimate(text);
}

/**
 * 估算 JSON 对象的 token 数量（导出供外部使用）
 * @param obj 要估算的对象
 * @returns 估算的 token 数量
 */
export function estimateTokensFromJSON(obj: any): number {
  return estimator.estimateJSON(obj);
}

/**
 * 创建包含估算标记的 TokenUsage 对象
 * 用于标识这是估算值而非 API 返回值
 */
export function createEstimatedUsage(
  promptText: string,
  completionText: string
): TokenUsage & { estimated: boolean } {
  const prompt = estimator.estimate(promptText);
  const completion = estimator.estimate(completionText);
  return {
    prompt,
    completion,
    total: prompt + completion,
    estimated: true
  };
}
