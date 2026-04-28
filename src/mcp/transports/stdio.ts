import { spawn, type ChildProcess } from "child_process";
import { createChildLogger } from "../../logger/index.js";
import type { MCPTransport } from "../types.js";

// 延迟创建 logger
let logger: ReturnType<typeof createChildLogger> | null = null;
function getLogger() {
  if (!logger) {
    logger = createChildLogger("mcp-stdio");
  }
  return logger;
}

/**
 * stdio 传输层实现
 * 通过子进程的 stdin/stdout 与 MCP 服务器通信
 */
export class StdioTransport implements MCPTransport {
  private command: string;
  private args: string[];
  private env: Record<string, string>;
  private process: ChildProcess | null = null;
  private messageQueue: string[] = [];

  constructor(command: string, args: string[] = [], env: Record<string, string> = {}) {
    this.command = command;
    this.args = args;
    this.env = { ...process.env, ...env } as Record<string, string>;
  }

  async connect(): Promise<void> {
    if (this.process) {
      throw new Error("Transport already connected");
    }

    getLogger().debug({ command: this.command, args: this.args }, "Starting MCP server process");

    this.process = spawn(this.command, this.args, {
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // 监听进程错误
    this.process.on("error", (err) => {
      getLogger().error({ error: err.message }, "MCP server process error");
    });

    // 监听进程退出
    this.process.on("exit", (code, signal) => {
      getLogger().info({ code, signal }, "MCP server process exited");
      this.process = null;
    });

    // 监听 stderr（用于调试）
    this.process.stderr?.on("data", (data) => {
      getLogger().debug({ stderr: data.toString() }, "MCP server stderr");
    });

    // 等待进程启动
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("MCP server process startup timeout"));
      }, 5000);

      // 监听第一次 stdout 输出，表示进程已启动
      const onData = () => {
        clearTimeout(timeout);
        this.process?.stdout?.off("data", onData);
        resolve();
      };

      this.process?.stdout?.once("data", onData);

      // 如果进程立即退出，也算启动失败
      this.process?.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("MCP server process exited immediately"));
      });
    });

    getLogger().info("MCP server process started");
  }

  async send(message: unknown): Promise<void> {
    if (!this.process || !this.process.stdin) {
      throw new Error("Transport not connected");
    }

    const json = JSON.stringify(message);
    getLogger().debug({ message: json }, "Sending message to MCP server");

    return new Promise((resolve, reject) => {
      this.process!.stdin!.write(json + "\n", (err) => {
        if (err) {
          getLogger().error({ error: err.message }, "Failed to send message");
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async *receive(): AsyncIterable<unknown> {
    if (!this.process || !this.process.stdout) {
      throw new Error("Transport not connected");
    }

    let buffer = "";

    for await (const chunk of this.process.stdout) {
      buffer += chunk.toString();

      // 按行分割消息（JSON-RPC 每行一个消息）
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // 保留最后一个不完整的行

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            getLogger().debug({ message: line }, "Received message from MCP server");
            yield message;
          } catch (err) {
            getLogger().error({ line, error: (err as Error).message }, "Failed to parse message");
          }
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    if (!this.process) {
      return;
    }

    getLogger().debug("Disconnecting MCP server process");

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // 强制杀死进程
        this.process?.kill("SIGKILL");
        resolve();
      }, 3000);

      this.process!.once("exit", () => {
        clearTimeout(timeout);
        this.process = null;
        resolve();
      });

      // 尝试优雅关闭
      this.process!.kill("SIGTERM");
    });
  }
}
