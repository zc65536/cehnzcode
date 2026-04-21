import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "../../types.js";

const execAsync = promisify(exec);

const bash: ToolDefinition = {
  name: "bash",
  description: "Execute a bash command and return its stdout and stderr.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The bash command to execute" },
      timeout: { type: "number", description: "Timeout in milliseconds (default: 30000)" },
    },
    required: ["command"],
  },
  async execute(args, ctx) {
    const timeout = (args.timeout as number) || ctx.config.toolTimeout;
    try {
      const { stdout, stderr } = await execAsync(args.command as string, {
        cwd: ctx.cwd,
        timeout,
        signal: ctx.signal,
      });
      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n[stderr]\n" : "") + stderr;
      return output || "(no output)";
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message: string };
      return `Error: ${error.message}\n${error.stderr ?? ""}`.trim();
    }
  },
};

export default bash;
