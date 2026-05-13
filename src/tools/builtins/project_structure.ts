import { ToolDefinition } from "../types.js";
import { ProjectExplorer, formatStructureAsText } from "../../context/project-explorer.js";

/**
 * 项目结构工具
 * 获取项目的文件和目录结构
 */
const projectStructureTool: ToolDefinition = {
  name: "get_project_structure",
  description:
    "获取项目的文件和目录结构。当需要了解项目整体布局、查找特定文件位置、或理解项目组织方式时使用此工具。返回简洁的缩进格式，深层或大型目录会折叠显示。",
  parameters: {
    type: "object",
    properties: {
      max_depth: {
        type: "number",
        description:
          "最大递归深度，默认 3。如果看到折叠的目录需要展开，可以增加此值。",
        default: 3,
      },
      include_hidden: {
        type: "boolean",
        description: "是否包含隐藏文件（以 . 开头），默认 false。",
        default: false,
      },
      collapse_threshold: {
        type: "number",
        description:
          "目录内直接子项数超过此值时折叠显示，默认 10。设为 0 表示不折叠。",
        default: 10,
      },
    },
  },
  async execute(args, ctx) {
    // 获取项目根目录
    const rootPath = ctx.cwd || process.cwd();
    
    // 创建 ProjectExplorer 实例
    const explorer = new ProjectExplorer(rootPath);

    // 获取项目结构
    const structure = await explorer.getStructure({
      maxDepth: (args.max_depth as number) ?? 3,
      includeHidden: (args.include_hidden as boolean) ?? false,
      collapseThreshold: (args.collapse_threshold as number) ?? 10,
    });

    // 格式化为简洁的缩进文本
    return formatStructureAsText(structure);
  },
};

export default projectStructureTool;
