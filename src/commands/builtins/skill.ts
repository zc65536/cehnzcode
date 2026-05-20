import * as fs from "node:fs/promises";
import type { CommandDefinition, CommandContext } from "../types.js";
import { skillRegistry } from "../../skills/index.js";

/**
 * /skill 命令
 * 用法：
 *   /skill <name>   — 直接加载指定 skill 的 SKILL.md，注入对话上下文
 *   /skill list     — 列出所有已注册的 skill
 */
export const skillCommand: CommandDefinition = {
  name: "skill",
  description: "加载指定 Skill 的说明并注入上下文。用法：/skill <name> | /skill list",
  async execute(args: string, ctx: CommandContext): Promise<void> {
    const trimmed = args.trim();

    // /skill list — 列出所有已注册的 skill
    if (trimmed === "list" || trimmed === "") {
      const all = skillRegistry.getAll();
      if (all.length === 0) {
        ctx.ui.showAssistantMessage("当前没有已注册的 Skills。");
        return;
      }

      const lines = all.map((s) => {
        const domain = s.domain ? ` [${s.domain}]` : "";
        const source = s.source === "system" ? " (通用)" : " (项目)";
        const desc = s.description ? ` — ${s.description}` : "";
        return `  ${s.name}${domain}${source}${desc}`;
      });
      ctx.ui.showAssistantMessage("已注册的 Skills：\n" + lines.join("\n"));
      return;
    }

    // /skill <name> — 加载指定 skill
    const name = trimmed;
    const skill = skillRegistry.get(name);

    if (!skill) {
      const available = skillRegistry
        .getAll()
        .map((s) => s.name)
        .join(", ");
      ctx.ui.showAssistantMessage(
        `Skill "${name}" 不存在。可用的 Skills：${available || "（无）"}`
      );
      return;
    }

    const content = await fs.readFile(skill.skillMdPath, "utf-8");

    // 将 SKILL.md 内容注入对话上下文，模型在下一轮会话中可以按此说明执行
    ctx.context.addTurn({
      role: "user",
      content: `[已加载 Skill: ${skill.name}]\n\n以下是该 Skill 的使用说明，请在后续任务中按照说明执行：\n\n${content}`,
      tags: ["skill-injection"],
    });

    ctx.ui.showAssistantMessage(
      `✅ Skill "${skill.name}" 已加载${skill.description ? `（${skill.description}）` : ""}。\n请告诉我你想完成什么任务。`
    );
  },
};
