import * as fs from "node:fs/promises";
import * as path from "node:path";
import { toolRegistry } from "../tools/registry.js";
import { hookRunner } from "../hooks/index.js";
import { createChildLogger } from "../logger/index.js";
import type { Plugin } from "../types.js";

const logger = createChildLogger("plugin-loader");

export async function loadPlugins(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginPath = path.join(dir, entry.name, "index.js");
        try {
          const module = await import(pluginPath);
          const plugin: Plugin = module.default ?? module;
          registerPlugin(plugin);
          logger.info({ plugin: plugin.name }, "Plugin loaded");
        } catch (err) {
          logger.warn({ plugin: entry.name, error: (err as Error).message }, "Failed to load plugin");
        }
      }
    } catch {
      logger.debug({ dir }, "Plugin directory not found, skipping");
    }
  }
}

function registerPlugin(plugin: Plugin): void {
  if (plugin.tools) {
    toolRegistry.registerAll(plugin.tools);
  }
  if (plugin.hooks) {
    for (const [event, handler] of Object.entries(plugin.hooks)) {
      if (handler) {
        hookRunner.register(event as any, handler as any);
      }
    }
  }
}
