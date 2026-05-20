import * as fs from "node:fs/promises";
import type { ToolDefinition } from "../../types.js";
import { skillRegistry } from "../../skills/index.js";

/**
 * use_skill tool
 * 按 name 查找 skill，读取其 SKILL.md，将内容作为 tool result 返回给模型。
 * 模型收到内容后，按 SKILL.md 中的指令完成后续任务。
 */
const useSkillTool: ToolDefinition = {
  name: "use_skill",
  description:
    "加载指定 Skill 的使用说明（SKILL.md）。" +
    "调用后模型将读取说明并按其中的步骤完成任务。" +
    "如果不确定有哪些 Skill 可用，可先用 read_file 读取对应领域的 index.md。",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Skill 的名称（目录名），例如 'pdf'、'refactor'",
      },
    },
    required: ["name"],
  },
  async execute(args) {
    const name = args.name as string;
    const skill = skillRegistry.get(name);

    if (!skill) {
      // 给模型一个有用的错误提示，包含当前可用的 skill 列表
      const available = skillRegistry
        .getAll()
        .map((s) => s.name)
        .join(", ");
      return `Skill "${name}" 不存在。当前已注册的 Skills：${available || "（无）"}`;
    }

    const content = await fs.readFile(skill.skillMdPath, "utf-8");
    return `# Skill: ${skill.name}\n\n${content}`;
  },
};

export default useSkillTool;
