import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition } from "../../types.js";

const readFile: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file at the given path. Returns the file content as a string.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative file path to read" },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    const filePath = path.resolve(ctx.cwd, args.path as string);
    const content = await fs.readFile(filePath, "utf-8");
    return content;
  },
};

export default readFile;
