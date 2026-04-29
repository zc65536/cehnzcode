/**
 * 测试 bash 工具的环境检测功能
 */

import os from "node:os";
import { execSync } from "node:child_process";

/**
 * 获取父进程名称（仅 Windows）
 */
function getParentProcessName(): string {
  try {
    const ppid = process.ppid; // 父进程 ID
    
    // 使用 wmic 查询父进程名称
    const result = execSync(`wmic process where processid=${ppid} get name`, {
      encoding: "utf8",
      timeout: 1000,
    });
    
    // 解析输出，格式类似：
    // Name
    // cmd.exe
    const lines = result.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length > 1) {
      return lines[1].toLowerCase();
    }
  } catch (err) {
    // 如果查询失败，返回空字符串
  }
  
  return "";
}

function detectEnvironment(): { platform: string; shell: string } {
  const platform = os.platform();
  
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

console.log("=== Environment Detection Test ===\n");

const env = detectEnvironment();

console.log("Detected Environment:");
console.log(`  Platform: ${env.platform}`);
console.log(`  Shell: ${env.shell}`);
console.log();

console.log("Process Information:");
console.log(`  Current PID: ${process.pid}`);
console.log(`  Parent PID: ${process.ppid}`);
if (os.platform() === "win32") {
  const parentName = getParentProcessName();
  console.log(`  Parent Process Name: ${parentName || "(failed to detect)"}`);
}
console.log();

console.log("Environment Variables:");
console.log(`  os.platform(): ${os.platform()}`);
console.log(`  process.env.SHELL: ${process.env.SHELL || "(not set)"}`);
console.log(`  process.env.ComSpec: ${process.env.ComSpec || "(not set)"}`);
console.log();

console.log("Tool Description that will be sent to AI:");
console.log(`  "Execute a shell command. Current system: ${env.platform}, shell: ${env.shell}."`);
