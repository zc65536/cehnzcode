import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "../../types.js";

const execAsync = promisify(exec);

const grep: ToolDefinition = {
  name: "grep",
  description: "Search for a pattern in files. Uses ripgrep (rg) if available, falls back to grep.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for" },
      path: { type: "string", description: "File or directory to search in (defaults to current directory)" },
      glob: { type: "string", description: "File glob filter (e.g. '*.ts')" },
    },
    required: ["pattern"],
  },
  async execute(args, ctx) {
    const searchPath = (args.path as string) || ".";
    const pattern = args.pattern as string;
    const globFilter = args.glob as string | undefined;

    let cmd: string;
    const globArg = globFilter ? `--glob '${globFilter}'` : "";
    cmd = `rg --no-heading --line-number ${globArg} '${pattern}' '${searchPath}' 2>/dev/null || grep -rn '${pattern}' '${searchPath}'`;

    try {
      const { stdout } = await execAsync(cmd, { cwd: ctx.cwd, timeout: ctx.config.toolTimeout });
      return stdout.trim() || "No matches found.";
    } catch {
      return "No matches found.";
    }
  },
};

export default grep;
