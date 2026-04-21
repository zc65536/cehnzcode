import type { Turn, AppConfig, CompressionResult, CompressionStrategy } from "../types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("compression");

const strategies = new Map<string, CompressionStrategy>();

export function registerStrategy(strategy: CompressionStrategy): void {
  strategies.set(strategy.name, strategy);
}

export function getStrategy(name: string): CompressionStrategy | undefined {
  return strategies.get(name);
}

export async function compress(turns: Turn[], config: AppConfig): Promise<CompressionResult> {
  try {
    // Group turns by their tags
    const tagGroups = new Map<string, Turn[]>();
    for (const turn of turns) {
      for (const tag of turn.tags) {
        if (!tagGroups.has(tag)) tagGroups.set(tag, []);
        tagGroups.get(tag)!.push(turn);
      }
    }

    // Try tag-specific strategies first, fall back to default
    const summaries: string[] = [];
    const processedTurns = new Set<string>();

    for (const [tag, tagTurns] of tagGroups) {
      const strategy = strategies.get(tag) ?? strategies.get("default");
      if (!strategy) continue;

      const unprocessed = tagTurns.filter((t) => !processedTurns.has(t.id));
      if (unprocessed.length === 0) continue;

      const summary = await strategy.compress(unprocessed);
      summaries.push(summary);
      for (const t of unprocessed) processedTurns.add(t.id);
    }

    // If no strategies matched, use simple truncation
    if (summaries.length === 0) {
      const { truncateStrategy } = await import("./strategies/truncate.js");
      const summary = await truncateStrategy.compress(turns);
      summaries.push(summary);
    }

    const finalSummary = summaries.join("\n\n");
    logger.info({ removedCount: turns.length }, "Context compressed");

    return {
      summary: finalSummary,
      removedCount: turns.length,
      success: true,
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
