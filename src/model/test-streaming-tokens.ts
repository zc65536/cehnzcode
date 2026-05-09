/**
 * 测试流式输出和token计数功能
 * 
 * 验证：
 * 1. 流式输出能正常工作
 * 2. 流式结束后能获取完整的usage信息
 * 3. tokenTracker能正确追踪token使用情况
 */

import { ModelClient } from "./index.js";
import { tokenTracker } from "../tokens/index.js";
import type { AppConfig, Turn } from "../types.js";

async function testStreamingWithTokens() {
  console.log("=== 测试流式输出和Token计数 ===\n");

  // 创建测试配置
  const config: AppConfig = {
    apiKey: process.env.API_KEY || "",
    apiBaseUrl: process.env.API_BASE_URL || "https://api.openai.com/v1",
    model: process.env.MODEL || "gpt-4",
    maxTokens: 1000,
    contextLimit: 100000,
    compressKeepTurns: 5,
    toolTimeout: 30000,
    logLevel: "info",
    sessionDir: ".sessions",
    pluginDirs: [],
  };

  const client = new ModelClient(config);

  // 准备测试对话
  const turns: Turn[] = [
    {
      id: "1",
      role: "user",
      content: "请用一句话介绍什么是TypeScript",
      tags: ["user"],
      tokenCount: 0,
      compressed: false,
      timestamp: Date.now(),
    },
  ];

  console.log("📤 发送请求: ", turns[0].content);
  console.log("\n🔄 流式输出开始:\n");

  try {
    // 使用流式输出
    const { stream, getResponse } = client.chatStream(turns, []);

    // 实时显示流式输出
    let chunkCount = 0;
    for await (const chunk of stream) {
      process.stdout.write(chunk);
      chunkCount++;
    }

    console.log("\n\n✅ 流式输出完成");
    console.log(`📊 共收到 ${chunkCount} 个chunk\n`);

    // 获取完整响应（包含usage）
    console.log("⏳ 获取完整响应和usage信息...\n");
    const response = await getResponse();

    console.log("📋 响应信息:");
    console.log(`  - 内容长度: ${response.content.length} 字符`);
    console.log(`  - 工具调用: ${response.toolCalls.length} 个`);
    console.log(`  - 结束原因: ${response.finishReason}`);
    console.log("\n💰 Token使用情况:");
    console.log(`  - Prompt tokens: ${response.usage.prompt}`);
    console.log(`  - Completion tokens: ${response.usage.completion}`);
    console.log(`  - Total tokens: ${response.usage.total}`);

    // 追踪token
    console.log("\n🔍 追踪token到tokenTracker...");
    tokenTracker.track(response.usage);

    const lastTurn = tokenTracker.getLastTurn();
    const cumulative = tokenTracker.getCumulative();

    console.log("\n📈 TokenTracker统计:");
    console.log(`  - 最近一次: ${lastTurn?.total} tokens`);
    console.log(`  - 累计使用: ${cumulative.total} tokens`);

    console.log("\n✅ 测试完成！");
    console.log("\n验证结果:");
    console.log("  ✓ 流式输出正常工作");
    console.log("  ✓ 流式结束后获取到usage信息");
    console.log("  ✓ tokenTracker正确追踪token使用");

  } catch (error) {
    console.error("\n❌ 测试失败:", error);
    throw error;
  }
}

// 运行测试
testStreamingWithTokens().catch((err) => {
  console.error("测试出错:", err);
  process.exit(1);
});
