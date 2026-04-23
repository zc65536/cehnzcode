import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";
import { commandRegistry } from "./registry.js";
import { createChildLogger } from "../logger/index.js";
import type { CommandDefinition } from "./types.js";

const logger = createChildLogger("command-loader");

/**
 * 扫描 builtins/ 目录，自动注册所有导出 CommandDefinition 的模块
 */
export async function loadBuiltinCommands(): Promise<void> {
  const builtinsDir = path.join(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "builtins"
  );

  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(builtinsDir, { withFileTypes: true });
  } catch {
    logger.warn({ dir: builtinsDir }, "Builtins directory not found");
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const modulePath = path.join(builtinsDir, entry.name);
    try {
      const mod = await import(modulePath);
      // 支持 default export 或任意具名 export（只要符合 CommandDefinition 形状）
      const candidates: unknown[] = mod.default
        ? [mod.default]
        : Object.values(mod);
      for (const candidate of candidates) {
        if (isCommandDefinition(candidate)) {
          commandRegistry.register(candidate);
        }
      }
    } catch (err) {
      logger.warn({ file: entry.name, error: (err as Error).message }, "Failed to load builtin command");
    }
  }
}

function isCommandDefinition(v: unknown): v is CommandDefinition {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as CommandDefinition).name === "string" &&
    typeof (v as CommandDefinition).description === "string" &&
    typeof (v as CommandDefinition).execute === "function"
  );
}

export { commandRegistry } from "./registry.js";
export type { CommandDefinition, CommandContext } from "./types.js";
