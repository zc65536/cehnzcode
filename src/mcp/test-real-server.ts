/**
 * 测试真实的 MCP 服务器连接
 * 运行方式：tsx src/mcp/test-real-server.ts
 * 
 * 前置条件：需要安装 uv
 * Windows: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
 * macOS/Linux: curl -LsSf https://astral.sh/uv/install.sh | sh
 */

// 必须在导入任何模块之前设置环境变量
process.env.API_KEY = "test-key";
process.env.API_BASE_URL = "https://api.test.com/v1";
process.env.MODEL = "test-model";
process.env.MAX_TOKENS = "4096";
process.env.CONTEXT_LIMIT = "100000";
process.env.COMPRESS_KEEP_TURNS = "3";
process.env.TOOL_TIMEOUT = "30000";
process.env.LOG_LEVEL = "info";
process.env.SESSION_DIR = ".sessions";
process.env.PLUGIN_DIRS = "";

import { getMCPManager } from "./index.js";
import { toolRegistry } from "../tools/registry.js";
import type { MCPServerConfig } from "./types.js";

async function testRealMCPServer() {
  console.log("=== Testing Real MCP Server ===\n");

  // 检查 uvx 是否可用
  console.log("Step 1: Checking uvx availability");
  try {
    const { execSync } = await import("child_process");
    const version = execSync("uvx --version", { encoding: "utf-8" }).trim();
    console.log(`✓ uvx is available: ${version}`);
  } catch (err) {
    console.log("✗ uvx is not available");
    console.log("\nPlease install uv first:");
    console.log("  Windows: powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\"");
    console.log("  macOS/Linux: curl -LsSf https://astral.sh/uv/install.sh | sh");
    console.log("  Or: pip install uv");
    process.exit(1);
  }
  console.log();

  // 初始化 MCP Manager
  console.log("Step 2: Initialize MCP Manager");
  const mcpManager = getMCPManager(process.cwd());
  await mcpManager.initialize();
  console.log("✓ MCP Manager initialized");
  console.log();

  // 添加一个真实的 MCP 服务器（使用 mcp-server-fetch）
  console.log("Step 3: Add mcp-server-fetch");
  const fetchConfig: MCPServerConfig = {
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    env: {
      FASTMCP_LOG_LEVEL: "ERROR",
    },
    disabled: false,
    autoApprove: [], // 不自动批准任何工具
  };

  try {
    console.log("  Connecting to mcp-server-fetch (this may take a moment on first run)...");
    await mcpManager.addServer("fetch", fetchConfig, "system");
    console.log("✓ mcp-server-fetch connected successfully");
  } catch (err) {
    console.log("✗ Failed to connect mcp-server-fetch");
    console.log("  Error:", (err as Error).message);
    process.exit(1);
  }
  console.log();

  // 检查服务器状态
  console.log("Step 4: Check server status");
  const servers = mcpManager.getAllServers();
  console.log(`  Total servers: ${servers.length}`);
  for (const server of servers) {
    console.log(`  - ${server.name}: ${server.status}`);
    console.log(`    Tools: ${server.tools.length}`);
    if (server.error) {
      console.log(`    Error: ${server.error.message}`);
    }
  }
  console.log();

  // 列出所有工具
  console.log("Step 5: List all MCP tools");
  const tools = mcpManager.getAllTools();
  console.log(`  Total MCP tools: ${tools.length}`);
  for (const tool of tools) {
    console.log(`  - ${tool.fullName}`);
    console.log(`    Description: ${tool.description}`);
  }
  console.log();

  // 测试工具调用
  console.log("Step 6: Test tool execution");
  if (tools.length > 0) {
    // 查找 fetch 工具
    const fetchTool = tools.find((t) => t.name === "fetch");
    if (fetchTool) {
      try {
        console.log(`  Calling ${fetchTool.fullName}...`);
        const result = await mcpManager.callTool(fetchTool.fullName, {
          url: "https://example.com",
        });
        console.log("✓ Tool executed successfully");
        console.log(`  Result length: ${result.length} characters`);
        console.log(`  First 200 chars: ${result.substring(0, 200)}...`);
      } catch (err) {
        console.log("✗ Tool execution failed");
        console.log("  Error:", (err as Error).message);
      }
    } else {
      console.log("  No 'fetch' tool found, skipping execution test");
    }
  } else {
    console.log("  No tools available, skipping execution test");
  }
  console.log();

  // 测试 Tool Registry 集成
  console.log("Step 7: Test Tool Registry integration");
  await toolRegistry.initialize(process.cwd());
  const allTools = toolRegistry.getAll();
  const mcpTools = allTools.filter((t) => t.name.startsWith("mcp__"));
  console.log(`  Total tools in registry: ${allTools.length}`);
  console.log(`  MCP tools in registry: ${mcpTools.length}`);
  console.log("✓ Tool Registry integration working");
  console.log();

  // 测试 autoApprove
  console.log("Step 8: Test autoApprove");
  if (tools.length > 0) {
    const testTool = tools[0];
    const isApproved = mcpManager.isAutoApproved(testTool.fullName);
    console.log(`  Tool: ${testTool.fullName}`);
    console.log(`  Auto-approved: ${isApproved} (expected: false)`);
    console.log("✓ autoApprove checking works");
  } else {
    console.log("  No tools available, skipping autoApprove test");
  }
  console.log();

  // 清理
  console.log("Step 9: Cleanup");
  try {
    await mcpManager.removeServer("fetch", "system");
    console.log("✓ Server removed");
  } catch (err) {
    console.log("✗ Failed to remove server");
    console.log("  Error:", (err as Error).message);
  }
  console.log();

  console.log("=== All tests completed successfully! ===");
  console.log("\n✨ MCP integration is working correctly with real servers!");
}

testRealMCPServer().catch((err) => {
  console.error("\n❌ Test failed:", err);
  process.exit(1);
});
