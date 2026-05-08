import { randomUUID } from "node:crypto";
import { eventBus } from "../events/index.js";
import { estimateTokens } from "../tokens/index.js";
import { compress } from "./compression.js";
import type { AppConfig, Turn } from "../types.js";
import type { SessionManager } from "../session/index.js";

export class ConversationManager {
  private turns: Turn[] = [];
  private config: AppConfig;
  private sessionManager: SessionManager;

  constructor(config: AppConfig, sessionManager: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager;
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
    const threshold = this.config.contextLimit * 0.85; // 使用 85% 作为阈值
    return this.getTotalTokens() > threshold;
  }

  async compress(): Promise<void> {
    if (this.turns.length <= this.config.compressKeepTurns * 2) {
      return;
    }

    const keepCount = this.config.compressKeepTurns * 2; // keep N user+assistant pairs
    const toCompress = this.turns.slice(0, this.turns.length - keepCount);
    const toKeep = this.turns.slice(this.turns.length - keepCount);

    // 获取压缩元信息
    const metadata = await this.sessionManager.getCompressionMetadata();

    // 执行压缩
    const result = await compress(
      toCompress,
      this.config,
      this.sessionManager.getSessionId(),
      metadata
    );

    if (result.success) {
      // 创建压缩摘要 turn
      const summaryTurn: Turn = {
        id: randomUUID(),
        role: "system",
        content: `[Compressed conversation summary]\n${result.summary}`,
        tags: ["compressed"],
        tokenCount: estimateTokens(result.summary),
        compressed: true,
        timestamp: Date.now(),
      };

      // 保留系统提示词（如果存在）
      const systemTurn = this.turns.find((t) => t.role === "system" && !t.compressed);
      this.turns = systemTurn
        ? [systemTurn, summaryTurn, ...toKeep]
        : [summaryTurn, ...toKeep];

      // 更新压缩元信息
      await this.sessionManager.updateCompressionMetadata({
        count: metadata.count + 1,
        lastCompressedAt: Date.now(),
      });

      // 保存到文件
      await this.sessionManager.saveTurns(this.turns);

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
