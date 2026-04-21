import { glob as globFn } from "glob";
import * as path from "node:path";
import type { ToolDefinition } from "../../types.js";

const globTool: ToolDefinition = {
  name: "glob",
  description: "Find files matching a glob pattern. Returns matched file paths.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts', 'src/**/*.js')" },
      cwd: { type: "string", description: "Directory to search in (defaults to working directory)" },
    },
    required: ["pattern"],
  },
  async execute(args, ctx) {
    const searchDir = args.cwd ? path.resolve(ctx.cwd, args.cwd as string) : ctx.cwd;
    const matches = await globFn(args.pattern as string, { cwd: searchDir, nodir: true });
    if (matches.length === 0) return "No files matched.";
    return matches.join("\n");
  },
};

export default globTool;
