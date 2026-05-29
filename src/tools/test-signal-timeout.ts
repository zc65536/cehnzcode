/**
 * 测试修复后的 signal timeout 问题
 * 
 * 验证：
 * 1. 每次工具执行都有独立的超时信号
 * 2. 长时间运行的会话不会导致后续工具调用失败
 */

import { ToolExecutor } from "./executor.js";
import type { ToolCall, ToolContext, AppConfig } from "../types.js";

async function testSignalTimeout() {
  console.log("=== 测试 Signal Timeout 修复 ===\n");
  
  const mockConfig: AppConfig = {
    apiKey: "test",
    apiBaseUrl: "http://test",
    model: "test",
    maxTokens: 4096,
    contextLimit: 100000,
    compressKeepTurns: 3,
    toolTimeout: 2000, // 2秒超时
    logLevel: "error",
    sessionDir: ".sessions",
    pluginDirs: [],
    knowledgeEnabled: true,
  };

  const mockContext: ToolContext = {
    cwd: process.cwd(),
    config: mockConfig,
    signal: new AbortController().signal, // 这个不会被使用
  };
  
  const executor = new ToolExecutor(mockContext);
  
  try {
    // 测试1: 快速执行的命令应该成功
    console.log("测试1: 快速命令（应该成功）");
    const call1: ToolCall = {
      id: "test1",
      name: "bash",
      arguments: { command: "echo Hello" },
    };
    
    const result1 = await executor.run(call1);
    if (result1.error) {
      console.log("  ✗ 失败:", result1.error);
    } else {
      console.log("  ✓ 成功:", result1.output?.trim());
    }
    
    // 测试2: 等待3秒（超过工具超时时间），然后执行另一个命令
    console.log("\n测试2: 等待3秒后执行命令（测试信号是否独立）");
    console.log("  等待中...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const call2: ToolCall = {
      id: "test2",
      name: "bash",
      arguments: { command: "echo World" },
    };
    
    const result2 = await executor.run(call2);
    if (result2.error) {
      console.log("  ✗ 失败:", result2.error);
      console.log("  ⚠️  如果看到这个错误，说明信号仍然是共享的！");
    } else {
      console.log("  ✓ 成功:", result2.output?.trim());
      console.log("  ✓ 信号是独立的，修复成功！");
    }
    
    // 测试3: 执行一个会超时的命令
    console.log("\n测试3: 超时命令（应该在2秒后超时）");
    const call3: ToolCall = {
      id: "test3",
      name: "bash",
      arguments: { 
        command: process.platform === "win32" 
          ? "timeout /t 5 /nobreak" 
          : "sleep 5" 
      },
    };
    
    const startTime = Date.now();
    const result3 = await executor.run(call3);
    const elapsed = Date.now() - startTime;
    
    if (result3.error) {
      console.log(`  ✓ 预期的超时错误（${elapsed}ms）:`, result3.error);
    } else {
      console.log(`  ✗ 应该超时但没有（${elapsed}ms）`);
    }
    
    // 测试4: 超时后立即执行另一个命令
    console.log("\n测试4: 超时后立即执行新命令（应该成功）");
    const call4: ToolCall = {
      id: "test4",
      name: "bash",
      arguments: { command: "echo AfterTimeout" },
    };
    
    const result4 = await executor.run(call4);
    if (result4.error) {
      console.log("  ✗ 失败:", result4.error);
      console.log("  ⚠️  超时后的命令失败，可能还有问题！");
    } else {
      console.log("  ✓ 成功:", result4.output?.trim());
      console.log("  ✓ 每个工具调用都有独立的超时！");
    }
    
    console.log("\n=== 所有测试完成 ===");
    
  } catch (err) {
    console.error("\n✗ 测试失败:", err);
  }
}

// 运行测试
testSignalTimeout();
