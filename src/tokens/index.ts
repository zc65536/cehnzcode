import type { TokenUsage } from "../types.js";

class TokenTracker {
  private cumulative: TokenUsage = { prompt: 0, completion: 0, total: 0 };
  private turnHistory: TokenUsage[] = [];

  track(usage: TokenUsage): void {
    this.cumulative.prompt += usage.prompt;
    this.cumulative.completion += usage.completion;
    this.cumulative.total += usage.total;
    this.turnHistory.push(usage);
  }

  getCumulative(): TokenUsage {
    return { ...this.cumulative };
  }

  getLastTurn(): TokenUsage | null {
    return this.turnHistory.length > 0
      ? { ...this.turnHistory[this.turnHistory.length - 1] }
      : null;
  }

  getTurnHistory(): TokenUsage[] {
    return [...this.turnHistory];
  }

  reset(): void {
    this.cumulative = { prompt: 0, completion: 0, total: 0 };
    this.turnHistory = [];
  }
}

export const tokenTracker = new TokenTracker();

export function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English, ~2 for CJK
  // For accurate counting, use gpt-tokenizer when needed
  return Math.ceil(text.length / 3.5);
}
