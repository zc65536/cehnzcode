#!/usr/bin/env node
import 'dotenv/config' 
import { loadConfig, setConfig } from "./config/index.js";
import { createChildLogger } from "./logger/index.js";
import { toolRegistry } from "./tools/registry.js";
import { loadPlugins } from "./plugins/loader.js";
import { Orchestrator } from "./orchestrator/index.js";
import { TUIAdapter } from "./ui/tui/index.js";

// Import builtin tools
import readFile from "./tools/builtins/read_file.js";
import writeFile from "./tools/builtins/write_file.js";
import bash from "./tools/builtins/bash.js";
import globTool from "./tools/builtins/glob.js";
import grep from "./tools/builtins/grep.js";

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    setConfig(config);

    const logger = createChildLogger("main");
    logger.info("cehnzcode starting...");

    // Register builtin tools
    toolRegistry.registerAll([readFile, writeFile, bash, globTool, grep]);
    logger.info({ count: toolRegistry.getAll().length }, "Builtin tools registered");

    // Load plugins
    await loadPlugins(config.pluginDirs);

    // Create UI and orchestrator
    const ui = new TUIAdapter();
    const orchestrator = new Orchestrator(config, ui);

    // Run main loop
    await orchestrator.run();
  } catch (err) {
    console.error("Failed to start:", err);
    process.exit(1);
  }
}

main();
