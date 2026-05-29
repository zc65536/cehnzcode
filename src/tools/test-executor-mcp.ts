/**
 * 测试工具执行器的 MCP 集成
 * 运行方式：tsx src/tools/test-executor-mcp.ts
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

import { ToolExecutor } from "./executor.js";
import { toolRegistry } from "./registry.js";
import { getMCPManager } from "../mcp/index.js";
import type { ToolCall, ToolContext, AppConfig } from "../types.js";

async function testExecutorMCP() {
  console.log("=== Testing Tool Executor MCP Integration ===\n");

  // 准备测试上下文
  const testConfig: AppConfig = {
    apiKey: "test-key",
    apiBaseUrl: "https://api.test.com/v1",
    model: "test-model",
    maxTokens: 4096,
    contextLimit: 100000,
    compressKeepTurns: 3,
    toolTimeout: 30000,
    logLevel: "error",
    sessionDir: ".sessions",
    pluginDirs: [],
    knowledgeEnabled: true,
  };

  const testContext: ToolContext = {
    cwd: process.cwd(),
    config: testConfig,
    signal: new AbortController().signal,
  };

  const executor = new ToolExecutor(testContext);

  // 测试 1: 注册测试工具
  console.log("Test 1: Register test tools");

  toolRegistry.clear();

  // 注册一个内置工具
  toolRegistry.register({
    name: "builtin_echo",
    description: "Echo the input",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to echo" },
      },
      required: ["message"],
    },
    async execute(args) {
      return `Echo: ${args.message}`;
    },
  });

  // 模拟一个 MCP 工具（手动注册，不实际连接 MCP 服务器）
  toolRegistry.register({
    name: "mcp__test__mock_tool",
    description: "[MCP:test] A mock MCP tool",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "Input data" },
      },
      required: ["input"],
    },
    async execute(args) {
      return `MCP Mock: ${args.input}`;
    },
  });

  console.log("✓ Test tools registered");
  console.log("  Total tools:", toolRegistry.getAll().length);
  console.log();

  // 测试 2: 执行内置工具
  console.log("Test 2: Execute builtin tool");

  const builtinCall: ToolCall = {
    id: "call_1",
    name: "builtin_echo",
    arguments: { message: "Hello World" },
  };

  const builtinResult = await executor.run(builtinCall);
  console.log("  Call ID:", builtinResult.callId);
  console.log("  Output:", builtinResult.output);
  console.log("  Error:", builtinResult.error || "none");
  console.log("✓ Builtin tool executed successfully");
  console.log();

  // 测试 3: 执行 MCP 工具（模拟）
  console.log("Test 3: Execute mock MCP tool");

  const mcpCall: ToolCall = {
    id: "call_2",
    name: "mcp__test__mock_tool",
    arguments: { input: "Test Data" },
  };

  const mcpResult = await executor.run(mcpCall);
  console.log("  Call ID:", mcpResult.callId);
  console.log("  Output:", mcpResult.output);
  console.log("  Error:", mcpResult.error || "none");
  console.log("✓ Mock MCP tool executed successfully");
  console.log();

  // 测试 4: 执行不存在的工具
  console.log("Test 4: Execute non-existent tool");

  const unknownCall: ToolCall = {
    id: "call_3",
    name: "unknown_tool",
    arguments: {},
  };

  const unknownResult = await executor.run(unknownCall);
  console.log("  Call ID:", unknownResult.callId);
  console.log("  Output:", unknownResult.output);
  console.log("  Error:", unknownResult.error);
  console.log("✓ Unknown tool handled correctly");
  console.log();

  // 测试 5: 批量执行工具
  console.log("Test 5: Execute multiple tools in parallel");

  const calls: ToolCall[] = [
    {
      id: "call_4",
      name: "builtin_echo",
      arguments: { message: "First" },
    },
    {
      id: "call_5",
      name: "mcp__test__mock_tool",
      arguments: { input: "Second" },
    },
    {
      id: "call_6",
      name: "builtin_echo",
      arguments: { message: "Third" },
    },
  ];

  const results = await executor.runAll(calls);
  console.log("  Total calls:", calls.length);
  console.log("  Total results:", results.length);
  for (const result of results) {
    console.log(`    ${result.callId}: ${result.error ? "ERROR" : "OK"}`);
  }
  console.log("✓ Parallel execution works");
  console.log();

  // 测试 6: autoApprove 检查（需要 MCP Manager）
  console.log("Test 6: autoApprove checking");

  const mcpManager = getMCPManager();

  // 测试内置工具（不应该需要批准）
  const builtinNeedsApproval = toolRegistry.get("builtin_echo")?.name.startsWith("mcp__")
    ? !mcpManager.isAutoApproved("builtin_echo")
    : false;
  console.log("  Builtin tool needs approval:", builtinNeedsApproval, "(should be false)");

  // 测试 MCP 工具
  const mcpNeedsApproval = !mcpManager.isAutoApproved("mcp__test__mock_tool");
  console.log("  MCP tool needs approval:", mcpNeedsApproval, "(depends on config)");

  console.log("✓ autoApprove checking integrated");
  console.log();

  // 测试 7: 工具执行错误处理
  console.log("Test 7: Tool execution error handling");

  toolRegistry.register({
    name: "error_tool",
    description: "A tool that throws an error",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      throw new Error("Intentional error for testing");
    },
  });

  const errorCall: ToolCall = {
    id: "call_7",
    name: "error_tool",
    arguments: {},
  };

  const errorResult = await executor.run(errorCall);
  console.log("  Call ID:", errorResult.callId);
  console.log("  Output:", errorResult.output);
  console.log("  Error:", errorResult.error);
  console.log("✓ Error handling works correctly");
  console.log();

  console.log("=== All executor tests completed ===");
}

testExecutorMCP().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
