import type { KnowledgeRecord } from "../knowledge/types.js";

/**
 * 错题本注入内容：每次 flag=true 时追加到系统提示词末尾
 * 包含完整调用规则，错题本内容由调用方传入
 */
export const KNOWLEDGE_INJECTION_INSTRUCTION = `\
遇到错误时优先查阅上方错题本，有对应记录则直接参考解法。
解决问题后如果错误有记录价值，优先调用 \`record_knowledge\` 工具：
- 错题本中没有该错误 且 值得记录 → 填写完整信息，outcome: recorded
- 错题本中已有该错误 → outcome: skipped（无需重复记录）
- 解决了但不值得记录 → outcome: skipped
- 无法解决 → 填写尝试过的方法，outcome: unsolvable`;

/** 将错题记录格式化为注入到系统提示词中的文本 */
export function formatRecordsForPrompt(records: KnowledgeRecord[]): string {
  return records
    .map(
      (r) =>
        `- [${r.scope}] ${r.error}\n  背景：${r.background}\n  解法：${r.solution}`
    )
    .join("\n\n");
}

/** 将错题记录格式化为用户可读的列表（用于 /knowledge list 命令） */
export function formatRecordsForDisplay(records: KnowledgeRecord[]): string {
  if (records.length === 0) return "（暂无记录）";
  return records
    .map(
      (r, i) =>
        `${i + 1}. [${r.scope}][${r.outcome}] ${r.error}\n   背景：${r.background}\n   解法：${r.solution}`
    )
    .join("\n\n");
}
