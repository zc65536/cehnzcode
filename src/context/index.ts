import { randomUUID } from "node:crypto";
import { eventBus } from "../events/index.js";
import { estimateTokens } from "../tokens/index.js";
import { compress } from "./compression.js";
import type { AppConfig, Turn } from "../types.js";

export class ConversationManager {
  private turns: Turn[] = [];
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  addTurn(partial: Partial<Turn> & Pick<Turn, "role" | "content">): Turn {
    const turn: Turn = {
      id: partial.id ?? randomUUID(),
      role: partial.role,
      content: partial.content,
      toolCalls: partial.toolCalls,
      toolResults: partial.toolResults,
      tags: partial.tags ?? [partial.role],
      tokenCount: partial.tokenCount ?? estimateTokens(partial.content),
      compressed: false,
      timestamp: partial.timestamp ?? Date.now(),
    };
    this.turns.push(turn);
    eventBus.emit("turn:added", { turn });
    return turn;
  }

  getTurns(): Turn[] {
    return [...this.turns];
  }

  getTotalTokens(): number {
    return this.turns.reduce((sum, t) => sum + t.tokenCount, 0);
  }

  needsCompression(): boolean {
    return this.getTotalTokens() > this.config.contextLimit;
  }

  async compress(): Promise<void> {
    if (this.turns.length <= this.config.compressKeepTurns) return;

    const keepCount = this.config.compressKeepTurns * 2; // keep N user+assistant pairs
    const toCompress = this.turns.slice(0, this.turns.length - keepCount);
    const toKeep = this.turns.slice(this.turns.length - keepCount);

    const result = await compress(toCompress, this.config);

    if (result.success) {
      const summaryTurn: Turn = {
        id: randomUUID(),
        role: "system",
        content: `[Compressed conversation summary]\n${result.summary}`,
        tags: ["compressed"],
        tokenCount: estimateTokens(result.summary),
        compressed: true,
        timestamp: Date.now(),
      };

      this.turns = [this.turns[0]?.role === "system" ? this.turns[0] : summaryTurn, summaryTurn, ...toKeep].filter(
        (t, i, arr) => t !== arr[0] || i === 0
      );

      // Keep system prompt at index 0 if it exists, insert summary after it
      const systemTurn = this.turns.find((t) => t.role === "system" && !t.compressed);
      this.turns = systemTurn
        ? [systemTurn, summaryTurn, ...toKeep]
        : [summaryTurn, ...toKeep];

      await eventBus.emit("context:compress", {
        removedCount: result.removedCount,
        summary: result.summary,
      });
    }
  }

  clear(): void {
    this.turns = [];
  }

  setTurns(turns: Turn[]): void {
    this.turns = turns;
  }
}
