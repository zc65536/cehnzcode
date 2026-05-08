import { exec } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import type { ToolDefinition } from "../../types.js";

const execAsync = promisify(exec);

/**
 * 检测当前系统和 shell 环境
 */
function detectEnvironment(): { platform: string; shell: string } {
  const platform = os.platform(); // 'win32', 'darwin', 'linux', etc.
  
  let shell = "unknown";
  
  if (platform === "win32") {
    // 在 Windows 上，通过父进程名检测 shell
    const parentProcess = getParentProcessName();
    
    if (parentProcess.includes("powershell") || parentProcess.includes("pwsh")) {
      shell = "PowerShell";
    } else if (parentProcess.includes("bash")) {
      shell = "Bash";
    } else if (parentProcess.includes("cmd")) {
      shell = "CMD";
    } else {
      // 降级到环境变量检测
      const shellEnv = process.env.ComSpec || "";
      if (shellEnv.toLowerCase().includes("powershell") || shellEnv.toLowerCase().includes("pwsh")) {
        shell = "PowerShell";
      } else if (shellEnv.toLowerCase().includes("bash")) {
        shell = "Bash";
      } else {
        shell = "CMD";
      }
    }
  } else {
    // Unix-like 系统使用环境变量
    const shellEnv = process.env.SHELL || "";
    shell = shellEnv.includes("zsh") ? "Zsh" : "Bash";
  }
  
  return { platform, shell };
}

/**
 * 获取父进程名称（仅 Windows）
 */
function getParentProcessName(): string {
  try {
    const { execSync } = require("node:child_process");
    const ppid = process.ppid; // 父进程 ID
    
    // 使用 wmic 查询父进程名称
    const result = execSync(`wmic process where processid=${ppid} get name`, {
      encoding: "utf8",
      timeout: 1000,
    });
    
    // 解析输出，格式类似：
    // Name
    // cmd.exe
    const lines = result.split("\n").map((line: string) => line.trim()).filter(Boolean);
    if (lines.length > 1) {
      return lines[1].toLowerCase();
    }
  } catch (err) {
    // 如果查询失败，返回空字符串
  }
  
  return "";
}

const env = detectEnvironment();

const bash: ToolDefinition = {
  name: "bash",
  description: `Execute a shell command. Current system: ${env.platform}, shell: ${env.shell}. On Windows with bash, use forward slashes (/) for paths and standard Unix commands.`,
  parameters: {
    type: "object",
    properties: {
      command: { 
        type: "string", 
        description: `Shell command to execute in ${env.shell} on ${env.platform}. ` 
      },
      timeout: { type: "number", description: "Timeout in milliseconds (default: 30000)" },
    },
    required: ["command"],
  },
  async execute(args, ctx) {
    const command = args.command as string;
    const timeout = (args.timeout as number) || ctx.config.toolTimeout;
    
    try {
      // Windows CMD 输出 GBK 编码，需要使用 chcp 65001 切换到 UTF-8
      let actualCommand = command;
      let execOptions: any = {
        cwd: ctx.cwd,
        timeout,
        signal: ctx.signal,
      };
      
      if (os.platform() === "win32") {
        if (env.shell === "CMD") {
          // 在命令前添加 chcp 65001 切换到 UTF-8 编码
          actualCommand = `chcp 65001>nul && ${command}`;
        }
        
        // Windows 环境下，如果检测到系统shell是bash（Git Bash/WSL等），使用bash执行
        // 这样可以更好地处理路径和中文文件名
        const systemShell = process.env.SHELL || "";
        if (systemShell.includes("bash")) {
          execOptions.shell = systemShell;
        } else if (env.shell === "Bash") {
          // 如果检测到父进程是bash，也使用bash
          execOptions.shell = "bash";
        }
      }
      
      const { stdout, stderr } = await execAsync(actualCommand, execOptions);
      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n[stderr]\n" : "") + stderr;
      
      return output || "(no output)";
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message: string; code?: number };
      // 抛出异常，让 ToolExecutor 捕获并放入 error 字段
      throw new Error(`Command failed: ${error.message}${error.stderr ? "\n" + error.stderr : ""}`);
    }
  },
};

export default bash;
