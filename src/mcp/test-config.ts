/**
 * 测试 MCP 配置管理器
 * 运行方式：tsx src/mcp/test-config.ts
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

import { MCPConfigManager } from "./config.js";
import type { MCPServerConfig } from "./types.js";

async function testConfigManager() {
  console.log("=== Testing MCP Config Manager ===\n");

  const manager = new MCPConfigManager();

  // 测试 1: 加载空配置
  console.log("Test 1: Load empty config");
  const emptyConfig = await manager.loadMergedConfig();
  console.log("Empty config:", JSON.stringify(emptyConfig, null, 2));
  console.log("✓ Test 1 passed\n");

  // 测试 2: 保存系统级配置
  console.log("Test 2: Save system config");
  const systemServerConfig: MCPServerConfig = {
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    env: {
      FASTMCP_LOG_LEVEL: "ERROR",
    },
    disabled: false,
    autoApprove: ["read_file"],
  };

  await manager.saveConfig(
    {
      mcpServers: {
        fetch: systemServerConfig,
      },
    },
    "system"
  );
  console.log("✓ System config saved\n");

  // 测试 3: 加载系统级配置
  console.log("Test 3: Load system config");
  const systemConfig = await manager.loadMergedConfig();
  console.log("System config:", JSON.stringify(systemConfig, null, 2));
  console.log("✓ Test 3 passed\n");

  // 测试 4: 配置合并（模拟项目级覆盖）
  console.log("Test 4: Config merging");
  const projectManager = new MCPConfigManager(process.cwd());

  // 保存项目级配置（覆盖部分字段）
  await projectManager.saveConfig(
    {
      mcpServers: {
        fetch: {
          transport: "stdio",
          env: {
            FASTMCP_LOG_LEVEL: "DEBUG", // 覆盖
          },
          autoApprove: ["write_file"], // 合并
        },
      },
    },
    "project"
  );

  const mergedConfig = await projectManager.loadMergedConfig();
  console.log("Merged config:", JSON.stringify(mergedConfig, null, 2));

  // 验证合并结果
  const fetchConfig = mergedConfig.mcpServers.fetch;
  if (fetchConfig.env?.FASTMCP_LOG_LEVEL === "DEBUG") {
    console.log("✓ env merged correctly");
  }
  if (
    fetchConfig.autoApprove?.includes("read_file") &&
    fetchConfig.autoApprove?.includes("write_file")
  ) {
    console.log("✓ autoApprove merged correctly");
  }
  console.log("✓ Test 4 passed\n");

  // 测试 5: 移除服务器
  console.log("Test 5: Remove server");
  await manager.removeServer("fetch", "system");
  await projectManager.removeServer("fetch", "project");
  const finalConfig = await manager.loadMergedConfig();
  console.log("Final config:", JSON.stringify(finalConfig, null, 2));
  console.log("✓ Test 5 passed\n");

  console.log("=== All tests passed! ===");
}

testConfigManager().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
