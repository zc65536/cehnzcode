import type { CompressionStrategy, Turn } from "../../types.js";

export const truncateStrategy: CompressionStrategy = {
  name: "truncate",
  async compress(turns: Turn[]): Promise<string> {
    const userTurns = turns.filter((t) => t.role === "user");
    const assistantTurns = turns.filter((t) => t.role === "assistant");

    const topics = userTurns
      .map((t) => t.content.slice(0, 100))
      .slice(-5);

    const summary = [
      `Conversation had ${turns.length} turns.`,
      `Topics discussed: ${topics.join("; ")}`,
      `Last assistant actions: ${assistantTurns.slice(-2).map((t) => t.content.slice(0, 100)).join("; ")}`,
    ].join("\n");

    return summary;
  },
};
