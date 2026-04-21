import type { CompressionStrategy, Turn } from "../../types.js";

export const summaryStrategy: CompressionStrategy = {
  name: "summary",
  async compress(turns: Turn[]): Promise<string> {
    // This strategy will call the model to generate a summary
    // For now, use a basic extraction approach
    // In production, this should call ModelClient with COMPRESSION_PROMPT
    const keyContent = turns
      .filter((t) => t.role === "user" || t.role === "assistant")
      .map((t) => {
        const prefix = t.role === "user" ? "User" : "Assistant";
        const content = t.content.length > 200 ? t.content.slice(0, 200) + "..." : t.content;
        return `${prefix}: ${content}`;
      })
      .join("\n");

    return `Previous conversation summary:\n${keyContent}`;
  },
};
