import type { CommandDefinition } from "../types.js";
import { formatRecordsForDisplay } from "../../prompts/knowledge.js";

export const knowledgeCommand: CommandDefinition = {
  name: "knowledge",
  description: "管理错题本功能。用法: /knowledge <on|off|list|clear>",
  async execute(args, ctx) {
    const [subcommand] = args.trim().split(/\s+/);

    switch (subcommand) {
      case "on":
        ctx.knowledgeManager.setEnabled(true);
        ctx.ui.showAssistantMessage("错题本已开启");
        break;

      case "off":
        ctx.knowledgeManager.setEnabled(false);
        ctx.ui.showAssistantMessage("错题本已关闭");
        break;

      case "list": {
        const records = await ctx.knowledgeManager.getAll();
        ctx.ui.showAssistantMessage(
          `错题本共 ${records.length} 条记录：\n\n${formatRecordsForDisplay(records)}`
        );
        break;
      }

      case "clear":
        ctx.knowledgeManager.resetPending();
        ctx.ui.showAssistantMessage("已重置错题本注入状态");
        break;

      default:
        ctx.ui.showAssistantMessage(
          "用法: /knowledge <on|off|list|clear>"
        );
    }
  },
};
