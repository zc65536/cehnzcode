import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { createChildLogger } from "../logger/index.js";
import { hookRunner } from "./index.js";
import type { HookDataMap, HookResult, ListenerDataMap } from "../types.js";

const logger = createChildLogger("shell-hooks");

/** hooks.json 的文件结构 */
interface HooksConfig {
  hookTimeout?: number;
  hooks?: Partial<Record<keyof HookDataMap | keyof ListenerDataMap, string | string[]>>;
}

/** 可干预节点集合，其余均为纯观察节点 */
const INTERCEPTABLE_EVENTS = new Set<string>([
  "session:start",
  "turn:before",
  "model:before",
  "model:after",
  "tool:before",
  "tool:after",
]);

// ─── 路径处理 ────────────────────────────────────────────────────────────────

/**
 * 将脚本路径规范化为绝对路径：
 * - ~ 开头 → 展开为 home 目录（Node.js spawn 不会自动处理）
 * - 相对路径 → resolve 为当前工作目录的绝对路径
 */
function resolvePath(p: string): string {
  if (p.startsWith("~/") || p.startsWith("~\\") || p === "~") {
    return resolve(join(homedir(), p.slice(2)));
  }
  if (!isAbsolute(p)) {
    return resolve(p);
  }
  return p;
}

// ─── 文件读取 ────────────────────────────────────────────────────────────────

async function readHooksFile(filePath: string): Promise<HooksConfig | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as HooksConfig;
  } catch (err: unknown) {
    // 文件不存在是正常情况，其他错误才记警告
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logger.warn({ file: filePath, error: (err as Error).message }, "Failed to read hooks config");
    }
    return null;
  }
}

/**
 * 合并全局和项目级配置：
 * - hookTimeout：项目级优先
 * - hooks 各节点：脚本路径数组合并（全局在前，项目级在后）
 */
function mergeConfigs(global: HooksConfig | null, project: HooksConfig | null): HooksConfig {
  const result: HooksConfig = {
    hookTimeout: project?.hookTimeout ?? global?.hookTimeout ?? 5000,
    hooks: {},
  };

  const allEvents = new Set([
    ...Object.keys(global?.hooks ?? {}),
    ...Object.keys(project?.hooks ?? {}),
  ]) as Set<keyof HookDataMap | keyof ListenerDataMap>;

  for (const event of allEvents) {
    const globalScripts = toArray(global?.hooks?.[event]);
    const projectScripts = toArray(project?.hooks?.[event]);
    const merged = [...globalScripts, ...projectScripts];
    if (merged.length > 0) {
      result.hooks![event] = merged.length === 1 ? merged[0] : merged;
    }
  }

  return result;
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// ─── Shell 脚本执行 ───────────────────────────────────────────────────────────

/**
 * 根据脚本扩展名决定执行方式：
 * - .ps1 → powershell.exe -ExecutionPolicy Bypass -NonInteractive -File "path"
 *   Windows 的 cmd.exe 无法直接执行 .ps1，必须显式调用 powershell；
 *   ExecutionPolicy Bypass 绕过默认执行策略限制。
 * - 其他 → shell: true 直接执行
 */
function buildSpawnArgs(scriptPath: string): { cmd: string; args: string[]; useShell: boolean } {
  if (scriptPath.toLowerCase().endsWith(".ps1")) {
    return {
      cmd: "powershell.exe",
      args: ["-ExecutionPolicy", "Bypass", "-NonInteractive", "-NoProfile", "-File", scriptPath],
      useShell: false,
    };
  }
  return { cmd: scriptPath, args: [], useShell: true };
}

/**
 * 启动脚本，将 data 序列化为 JSON 写入 stdin，
 * 返回 stdout 字符串；超时或启动失败返回 null。
 */
async function runScript(rawPath: string, data: unknown, timeoutMs: number): Promise<string | null> {
  const scriptPath = resolvePath(rawPath);
  const { cmd, args, useShell } = buildSpawnArgs(scriptPath);

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      shell: useShell,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let settled = false;

    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      logger.warn({ script: scriptPath }, "Shell hook timed out");
      finish(null);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });

    child.stderr.on("data", (chunk: Buffer) => {
      logger.warn({ script: scriptPath, stderr: chunk.toString().trim() }, "Shell hook stderr");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        logger.warn({ script: scriptPath, code }, "Shell hook exited with non-zero code");
      }
      finish(stdout.trim());
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      logger.warn({ script: scriptPath, error: err.message }, "Shell hook failed to start");
      finish(null);
    });

    try {
      child.stdin.write(JSON.stringify(data));
      child.stdin.end();
    } catch {
      // 脚本已提前退出，stdin 写入失败，忽略
    }
  });
}

/** 解析 stdout 为 HookResult，无法解析则返回 null（等同 continue） */
function parseHookResult<T>(stdout: string | null): HookResult<T> | null {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout) as HookResult<T>;
    if (parsed.action === "cancel" || parsed.action === "modify" || parsed.action === "continue") {
      return parsed;
    }
    logger.warn({ stdout }, "Shell hook returned unrecognized action, treating as continue");
    return null;
  } catch {
    logger.warn({ stdout }, "Shell hook stdout is not valid JSON, treating as continue");
    return null;
  }
}

// ─── Hook 注册 ────────────────────────────────────────────────────────────────

function registerShellInterceptor(event: keyof HookDataMap, scriptPath: string, timeoutMs: number): void {
  hookRunner.intercept(event, async (data) => {
    const stdout = await runScript(scriptPath, data, timeoutMs);
    return parseHookResult(stdout) ?? { action: "continue" };
  });
}

function registerShellListener(event: keyof ListenerDataMap, scriptPath: string, timeoutMs: number): void {
  hookRunner.listen(event, async (data) => {
    await runScript(scriptPath, data, timeoutMs);
    // 纯观察节点忽略 stdout
  });
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

/**
 * 读取全局（~/.cehnzcode/hooks.json）和项目级（.cehnzcode/hooks.json）配置，
 * 合并后向 hookRunner 注册 shell 脚本。
 */
export async function loadShellHooks(cwd: string): Promise<void> {
  const globalPath = join(homedir(), ".cehnzcode", "hooks.json");
  const projectPath = join(cwd, ".cehnzcode", "hooks.json");

  const [globalConfig, projectConfig] = await Promise.all([
    readHooksFile(globalPath),
    readHooksFile(projectPath),
  ]);

  if (!globalConfig && !projectConfig) return;

  const config = mergeConfigs(globalConfig, projectConfig);
  if (!config.hooks || Object.keys(config.hooks).length === 0) return;

  const timeoutMs = config.hookTimeout!;

  for (const [event, scripts] of Object.entries(config.hooks)) {
    const scriptList = toArray(scripts as string | string[]);
    for (const scriptPath of scriptList) {
      if (INTERCEPTABLE_EVENTS.has(event)) {
        registerShellInterceptor(event as keyof HookDataMap, scriptPath, timeoutMs);
        logger.info({ event, script: scriptPath }, "Shell interceptor registered");
      } else {
        registerShellListener(event as keyof ListenerDataMap, scriptPath, timeoutMs);
        logger.info({ event, script: scriptPath }, "Shell listener registered");
      }
    }
  }
}
