import { exec } from "child_process";
import { promisify } from "util";
import { createChildLogger } from "../logger/index.js";

const execAsync = promisify(exec);

// 延迟创建 logger
let logger: ReturnType<typeof createChildLogger> | null = null;
function getLogger() {
  if (!logger) {
    logger = createChildLogger("mcp-installer");
  }
  return logger;
}

/**
 * MCP 安装器
 * 检查运行环境并提供安装指引
 */
export class MCPInstaller {
  /**
   * 检查运行环境是否满足要求
   * @param transport 传输方式
   */
  async checkEnvironment(transport: "stdio" | "sse"): Promise<boolean> {
    if (transport === "sse") {
      // SSE 传输不需要特殊环境
      return true;
    }

    // stdio 传输需要检查 uvx/npx 是否可用
    // 这里只检查 uvx，因为它是推荐的方式
    try {
      await execAsync("uvx --version");
      getLogger().info("uvx is available");
      return true;
    } catch (err) {
      getLogger().warn("uvx is not available");
      return false;
    }
  }

  /**
   * 获取安装指引
   * @param command 命令名称（如 uvx, npx）
   */
  async getInstallInstructions(command: string): Promise<string> {
    if (command === "uvx") {
      return `
uvx is not installed. Please install uv first:

# Using pip
pip install uv

# Using Homebrew (macOS/Linux)
brew install uv

# Using curl (Linux/macOS)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Using PowerShell (Windows)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

For more information, visit: https://docs.astral.sh/uv/getting-started/installation/

Note: Once uv is installed, uvx will be available automatically.
MCP servers will be downloaded and run automatically when you add them.
      `.trim();
    }

    if (command === "npx") {
      return `
npx is not installed. Please install Node.js first:

Visit: https://nodejs.org/

npx is included with Node.js (version 5.2.0 and above).
      `.trim();
    }

    return `Unknown command: ${command}`;
  }
}
