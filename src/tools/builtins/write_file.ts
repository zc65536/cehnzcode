import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition } from "../../types.js";

const writeFile: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file. Creates the file and parent directories if they don't exist.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative file path to write" },
      content: { type: "string", description: "Content to write to the file" },
    },
    required: ["path", "content"],
  },
  async execute(args, ctx) {
    const filePath = path.resolve(ctx.cwd, args.path as string);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, args.content as string, "utf-8");
    return `File written: ${filePath}`;
  },
};

export default writeFile;
