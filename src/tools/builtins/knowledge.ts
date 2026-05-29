import type { ToolDefinition } from "../../types.js";
import { knowledgeManager } from "../../knowledge/index.js";
import { formatRecordsForDisplay } from "../../prompts/knowledge.js";
import type { RecordKnowledgeArgs } from "../../knowledge/types.js";

/**
 * record_knowledge：模型调用此工具关闭错误处理闭环
 * 无论结果如何都必须调用
 */
export const recordKnowledgeTool: ToolDefinition = {
  name: "record_knowledge",
  description:
    "记录错误处理结果到错题本，关闭当前错误处理流程。无论错误是否解决，处理完毕后必须调用此工具。",
  parameters: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["system", "project"],
        description: "system：通用错误，跨项目共享；project：本项目特有错误",
      },
      error: {
        type: "string",
        description: "错误内容",
      },
      background: {
        type: "string",
        description: "发生错误时的背景和上下文",
      },
      solution: {
        type: "string",
        description: "解决方法。outcome 为 unsolvable 时，填写尝试过的方法",
      },
      outcome: {
        type: "string",
        enum: ["recorded", "skipped", "unsolvable"],
        description: [
          "recorded：新错误且值得记录，写入错题本",
          "skipped：错题本中已有该错误，或不值得记录，不写入",
          "unsolvable：未能解决，记录错误和已尝试的方法",
        ].join("；"),
      },
    },
    required: ["scope", "error", "background", "solution", "outcome"],
  },
  async execute(args) {
    const result = await knowledgeManager.record(args as unknown as RecordKnowledgeArgs);
    if (result) {
      return `已记录到${args.scope === "system" ? "系统级" : "项目级"}错题本，ID：${result.id}`;
    }
    return `已确认（outcome: ${args.outcome}），不写入错题本`;
  },
};

/**
 * search_knowledge：大数据集场景（>20 条）供模型按需查询完整记录
 */
export const searchKnowledgeTool: ToolDefinition = {
  name: "search_knowledge",
  description: "在错题本中关键词搜索，查找相关错误的解决方案",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词，如错误信息片段、模块名等",
      },
    },
    required: ["query"],
  },
  async execute(args) {
    const results = await knowledgeManager.search(args.query as string, 5);
    if (results.length === 0) return "未找到相关记录";
    return formatRecordsForDisplay(results);
  },
};
