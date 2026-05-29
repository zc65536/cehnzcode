#!/usr/bin/env node
import { loadConfig, setConfig } from "./config/index.js";
import { createChildLogger } from "./logger/index.js";
import { toolRegistry } from "./tools/registry.js";
import { loadBuiltinCommands } from "./commands/index.js";
import { loadPlugins } from "./plugins/loader.js";
import { loadShellHooks } from "./hooks/shell-loader.js";
import { Orchestrator } from "./orchestrator/index.js";
import { TUIAdapter } from "./ui/tui/index.js";

// Import builtin tools
import readFile from "./tools/builtins/read_file.js";
import writeFile from "./tools/builtins/write_file.js";
import editFile from "./tools/builtins/edit_file.js";
import bash from "./tools/builtins/bash.js";
import globTool from "./tools/builtins/glob.js";
import grep from "./tools/builtins/grep.js";
import projectStructureTool from "./tools/builtins/project_structure.js";
import useSkillTool from "./tools/builtins/use_skill.js";
import { skillRegistry } from "./skills/index.js";
import { knowledgeManager } from "./knowledge/index.js";
import { recordKnowledgeTool, searchKnowledgeTool } from "./tools/builtins/knowledge.js";

async function main(): Promise<void> {
  try {
    const config = loadConfig();
    setConfig(config);

    const logger = createChildLogger("main");
    logger.info("cehnzcode starting...");

    // Initialize knowledge manager (registers hooks internally)
    // Access to trigger constructor; actual singleton is already created on import
    logger.info({ enabled: knowledgeManager.isEnabled() }, "Knowledge manager initialized");

    // Register builtin tools
    toolRegistry.registerAll([readFile, writeFile, editFile, bash, globTool, grep, projectStructureTool, useSkillTool, recordKnowledgeTool, searchKnowledgeTool]);
    logger.info({ count: toolRegistry.getAll().length }, "Builtin tools registered");

    // Initialize MCP and sync tools
    await toolRegistry.initialize(process.cwd());
    logger.info("MCP initialized and tools synchronized");

    // Scan skill directories (system-level + project-level)
    await skillRegistry.scan(process.cwd());
    logger.info({ count: skillRegistry.getAll().length }, "Skills scanned");

    // Load builtin commands (auto-scan)
    await loadBuiltinCommands();
    logger.info("Builtin commands registered");

    // Load plugins
    await loadPlugins(config.pluginDirs);

    // Load shell hooks from ~/.cehnzcode/hooks.json and .cehnzcode/hooks.json
    await loadShellHooks(process.cwd());

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
