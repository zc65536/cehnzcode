/**
 * 测试 MCP 命令集成
 * 运行方式：tsx src/mcp/test-commands.ts
 */

// 必须在导入任何模块之前设置环境变量
process.env.API_KEY = "test-key";
process.env.API_BASE_URL = "https://api.test.com/v1";
process.env.MODEL = "test-model";
process.env.MAX_TOKENS = "4096";
process.env.CONTEXT_LIMIT = "100000";
process.env.COMPRESS_KEEP_TURNS = "3";
process.env.TOOL_TIMEOUT = "30000";
process.env.LOG_LEVEL = "error";
process.env.SESSION_DIR = ".sessions";
process.env.PLUGIN_DIRS = "";

import { commandRegistry } from "../commands/registry.js";
import { mcpCommand } from "../commands/builtins/mcp.js";
import { getMCPManager } from "./index.js";
import type { CommandContext } from "../commands/types.js";

async function testMCPCommands() {
  console.log("=== Testing MCP Commands ===\n");

  // 初始化 MCP Manager
  const mcpManager = getMCPManager(process.cwd());
  await mcpManager.initialize().catch(() => {
    // 忽略初始化错误（可能没有配置文件）
  });

  // 注册 MCP 命令
  commandRegistry.register(mcpCommand);
  console.log("✓ MCP command registered\n");

  // 创建模拟的命令上下文
  const mockContext: CommandContext = {
    context: null as any,
    ui: null as any,
    config: null as any,
    session: null as any,
    knowledgeManager: null as any,
    exit: () => {},
  };

  // 测试 1: 显示帮助信息
  console.log("Test 1: Display help");
  console.log("--- Output start ---");
  await mcpCommand.execute("", mockContext);
  console.log("--- Output end ---");
  console.log("✓ Help displayed\n");

  // 测试 2: 列出服务器（初始状态）
  console.log("Test 2: List servers (initial state)");
  console.log("--- Output start ---");
  await mcpCommand.execute("list", mockContext);
  console.log("--- Output end ---");
  console.log("✓ Server list displayed\n");

  // 测试 3: 添加服务器（会失败，因为没有实际的服务器）
  console.log("Test 3: Add server (will fail without actual server)");
  console.log("--- Output start ---");
  await mcpCommand.execute("add test_cmd echo hello", mockContext);
  console.log("--- Output end ---");
  console.log("✓ Add command executed (expected to fail)\n");

  // 测试 4: 列出服务器（添加后）
  console.log("Test 4: List servers (after add attempt)");
  console.log("--- Output start ---");
  await mcpCommand.execute("list", mockContext);
  console.log("--- Output end ---");
  console.log("✓ Server list displayed\n");

  // 测试 5: 移除服务器
  console.log("Test 5: Remove server");
  console.log("--- Output start ---");
  await mcpCommand.execute("remove test_cmd", mockContext);
  console.log("--- Output end ---");
  console.log("✓ Remove command executed\n");

  // 测试 6: 重新加载服务器
  console.log("Test 6: Reload servers");
  console.log("--- Output start ---");
  await mcpCommand.execute("reload", mockContext);
  console.log("--- Output end ---");
  console.log("✓ Reload command executed\n");

  // 测试 7: 添加项目级服务器
  console.log("Test 7: Add project-level server");
  console.log("--- Output start ---");
  await mcpCommand.execute("add test_project echo test --project", mockContext);
  console.log("--- Output end ---");
  console.log("✓ Project-level add command executed\n");

  // 测试 8: 移除项目级服务器
  console.log("Test 8: Remove project-level server");
  console.log("--- Output start ---");
  await mcpCommand.execute("remove test_project --project", mockContext);
  console.log("--- Output end ---");
  console.log("✓ Project-level remove command executed\n");

  // 测试 9: 无效的子命令
  console.log("Test 9: Invalid subcommand");
  console.log("--- Output start ---");
  await mcpCommand.execute("invalid", mockContext);
  console.log("--- Output end ---");
  console.log("✓ Invalid subcommand handled\n");

  // 测试 10: 参数不足
  console.log("Test 10: Insufficient arguments");
  console.log("--- Output start ---");
  await mcpCommand.execute("add", mockContext);
  console.log("--- Output end ---");
  console.log("✓ Insufficient arguments handled\n");

  console.log("=== All command tests completed ===");
}

testMCPCommands().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
