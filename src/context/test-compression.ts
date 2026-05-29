/**
 * 压缩模块完整测试
 * 
 * 测试三种压缩策略：
 * 1. deletion - 第一次压缩，删除冗余内容
 * 2. tagging - 第二次压缩，结构化标签提取
 * 3. supplement - 第三次压缩，增量更新
 */

// 必须在最开始导入 dotenv 来加载 .env 文件
import 'dotenv/config';

import { randomUUID } from "node:crypto";
import { compress } from "./compression.js";
import type { Turn, AppConfig } from "../types.js";
import type { CompressionMetadata } from "./types.js";

// 模拟配置（从环境变量读取，如果没有则使用默认值）
const mockConfig: AppConfig = {
  apiKey: process.env.API_KEY || "test-key",
  apiBaseUrl: process.env.API_BASE_URL || "https://api.openai.com/v1",
  model: process.env.MODEL || "gpt-4o",
  maxTokens: parseInt(process.env.MAX_TOKENS || "8192"),
  contextLimit: parseInt(process.env.CONTEXT_LIMIT || "100000"),
  compressKeepTurns: parseInt(process.env.COMPRESS_KEEP_TURNS || "3"),
  toolTimeout: parseInt(process.env.TOOL_TIMEOUT || "30000"),
  logLevel: (process.env.LOG_LEVEL as any) || "info",
  sessionDir: process.env.SESSION_DIR || "./.sessions",
  pluginDirs: process.env.PLUGIN_DIRS ? process.env.PLUGIN_DIRS.split(",") : [],
  knowledgeEnabled: true,
};

/**
 * 创建复杂的测试对话 - 模拟真实的开发场景
 */
function createComplexTestTurns(): Turn[] {
  const baseTime = Date.now();
  
  return [
    // 1. 初始需求讨论
    {
      id: randomUUID(),
      role: "user",
      content: "你好！我想创建一个 TypeScript 的 CLI 工具，用于管理项目的配置文件。",
      tags: ["user"],
      tokenCount: 30,
      compressed: false,
      timestamp: baseTime - 60000,
    },
    {
      id: randomUUID(),
      role: "assistant",
      content: "好的，我可以帮你创建。请问这个 CLI 工具需要支持哪些功能？比如读取、写入、验证配置等？",
      tags: ["assistant"],
      tokenCount: 35,
      compressed: false,
      timestamp: baseTime - 59000,
    },
    {
      id: randomUUID(),
      role: "user",
      content: "需要支持：1. 读取 JSON 和 YAML 格式的配置文件 2. 验证配置是否符合 schema 3. 支持环境变量替换 4. 可以合并多个配置文件",
      tags: ["user"],
      tokenCount: 50,
      compressed: false,
      timestamp: baseTime - 58000,
    },
    
    // 2. 技术选型讨论
    {
      id: randomUUID(),
      role: "assistant",
      content: "明白了。对于这些需求，我建议使用以下技术栈：\n- commander.js 用于 CLI 参数解析\n- js-yaml 用于 YAML 解析\n- zod 用于 schema 验证\n- dotenv 用于环境变量\n\n你觉得这个方案如何？",
      tags: ["assistant"],
      tokenCount: 80,
      compressed: false,
      timestamp: baseTime - 57000,
    },
    {
      id: randomUUID(),
      role: "user",
      content: "听起来不错！不过我更倾向于使用 yargs 而不是 commander，因为我们团队更熟悉它。其他的都可以。",
      tags: ["user"],
      tokenCount: 40,
      compressed: false,
      timestamp: baseTime - 56000,
    },
    {
      id: randomUUID(),
      role: "assistant",
      content: "好的，那我们就用 yargs。让我开始创建项目结构。",
      tags: ["assistant"],
      tokenCount: 25,
      compressed: false,
      timestamp: baseTime - 55000,
    },
    
    // 3. 实现过程中的问题
    {
      id: randomUUID(),
      role: "user",
      content: "等等，我发现一个问题。当配置文件中有循环引用时，合并功能会导致栈溢出。比如 config1 引用 config2，config2 又引用 config1。",
      tags: ["user"],
      tokenCount: 55,
      compressed: false,
      timestamp: baseTime - 50000,
    },
    {
      id: randomUUID(),
      role: "assistant",
      content: "这是个好问题。我们需要添加循环引用检测。我会实现一个基于 Set 的访问追踪机制，在合并前检测循环依赖。如果发现循环，抛出明确的错误信息。",
      tags: ["assistant"],
      tokenCount: 60,
      compressed: false,
      timestamp: baseTime - 49000,
    },
    
    // 4. 代码实现（包含工具调用）
    {
      id: randomUUID(),
      role: "assistant",
      content: "让我创建循环检测的代码：",
      tags: ["assistant"],
      tokenCount: 15,
      compressed: false,
      timestamp: baseTime - 48000,
      toolCalls: [
        {
          id: "tool_1",
          name: "write_file",
          arguments: {
            path: "src/utils/cycle-detector.ts",
            content: `export class CycleDetector {
  private visited = new Set<string>();
  
  check(path: string): void {
    if (this.visited.has(path)) {
      throw new Error(\`Circular reference detected: \${path}\`);
    }
    this.visited.add(path);
  }
  
  reset(): void {
    this.visited.clear();
  }
}`
          }
        }
      ]
    },
    {
      id: randomUUID(),
      role: "tool",
      content: "File written successfully: src/utils/cycle-detector.ts",
      tags: ["tool"],
      tokenCount: 10,
      compressed: false,
      timestamp: baseTime - 47000,
      toolResults: [
        {
          callId: "tool_1",
          output: "File written successfully: src/utils/cycle-detector.ts"
        }
      ]
    },
    
    // 5. 测试和错误修复
    {
      id: randomUUID(),
      role: "user",
      content: "测试了一下，发现当配置文件路径包含中文时会报错：Error: ENOENT: no such file or directory",
      tags: ["user"],
      tokenCount: 35,
      compressed: false,
      timestamp: baseTime - 40000,
    },
    {
      id: randomUUID(),
      role: "assistant",
      content: "这是编码问题。在 Windows 上，Node.js 默认使用 UTF-8，但文件系统可能使用 GBK。我们需要在读取文件前对路径进行编码转换。",
      tags: ["assistant"],
      tokenCount: 50,
      compressed: false,
      timestamp: baseTime - 39000,
    },
    {
      id: randomUUID(),
      role: "user",
      content: "好的，那你帮我修复一下。另外，我还需要添加一个 --watch 模式，可以监听配置文件变化并自动重新加载。",
      tags: ["user"],
      tokenCount: 40,
      compressed: false,
      timestamp: baseTime - 38000,
    },
    
    // 6. 新功能讨论
    {
      id: randomUUID(),
      role: "assistant",
      content: "明白了。对于 watch 模式，我建议使用 chokidar 库，它比 Node.js 原生的 fs.watch 更稳定，支持跨平台。实现思路是：\n1. 监听配置文件和其依赖文件\n2. 文件变化时重新加载并验证\n3. 如果验证失败，保留旧配置并输出错误\n\n这样可以避免因配置错误导致程序崩溃。",
      tags: ["assistant"],
      tokenCount: 100,
      compressed: false,
      timestamp: baseTime - 37000,
    },
    {
      id: randomUUID(),
      role: "user",
      content: "完美！就按这个方案实现吧。",
      tags: ["user"],
      tokenCount: 15,
      compressed: false,
      timestamp: baseTime - 36000,
    },
    
    // 7. 总结和后续计划
    {
      id: randomUUID(),
      role: "assistant",
      content: "好的，我会开始实现。总结一下我们确定的方案：\n\n**技术栈**：\n- yargs (CLI)\n- js-yaml (YAML 解析)\n- zod (验证)\n- chokidar (文件监听)\n\n**核心功能**：\n1. 多格式支持 (JSON/YAML)\n2. Schema 验证\n3. 环境变量替换\n4. 配置合并（带循环检测）\n5. Watch 模式\n\n**已解决的问题**：\n- 循环引用检测\n- 中文路径支持\n\n开始实现了！",
      tags: ["assistant"],
      tokenCount: 120,
      compressed: false,
      timestamp: baseTime - 35000,
    },
  ];
}

/**
 * 测试第一次压缩 - deletion 策略
 */
async function testFirstCompression(sessionId: string) {
  console.log("\n" + "=".repeat(60));
  console.log("测试 1：第一次压缩 (deletion 策略)");
  console.log("=".repeat(60) + "\n");

  const turns = createComplexTestTurns();
  const metadata: CompressionMetadata = {
    count: 0, // 第一次压缩
    lastCompressedAt: 0,
    lastRatio: 0,
    totalRemoved: 0,
  };

  console.log(`📊 输入信息：`);
  console.log(`  - 对话轮数：${turns.length}`);
  console.log(`  - 压缩次数：${metadata.count} (第一次)`);
  console.log(`  - 预期策略：deletion`);
  console.log(`  - 预期行为：删除寒暄和冗余，不使用工具\n`);

  try {
    const startTime = Date.now();
    const result = await compress(turns, mockConfig, sessionId, metadata);
    const elapsed = Date.now() - startTime;

    console.log(`\n📈 压缩结果：`);
    console.log(`  - 成功：${result.success ? "✅" : "❌"}`);
    console.log(`  - 删除轮数：${result.removedCount}`);
    console.log(`  - 摘要长度：${result.summary.length} 字符`);
    console.log(`  - 耗时：${elapsed}ms`);
    
    if (result.error) {
      console.log(`  - 错误：${result.error}`);
    }

    console.log(`\n📝 压缩摘要：`);
    console.log("-".repeat(60));
    console.log(result.summary);
    console.log("-".repeat(60));

    // 验证结果
    console.log(`\n🔍 验证：`);
    const hasGreeting = result.summary.includes("你好") || result.summary.includes("好的");
    const hasDecision = result.summary.includes("yargs") || result.summary.includes("技术栈");
    const hasProblem = result.summary.includes("循环引用") || result.summary.includes("中文路径");
    
    console.log(`  - 是否移除寒暄：${!hasGreeting ? "✅" : "❌ (仍包含寒暄)"}`);
    console.log(`  - 是否保留决策：${hasDecision ? "✅" : "❌ (缺少关键决策)"}`);
    console.log(`  - 是否保留问题：${hasProblem ? "✅" : "❌ (缺少问题记录)"}`);

    if (result.success && !hasGreeting && hasDecision && hasProblem) {
      console.log(`\n✅ 第一次压缩测试通过！`);
      return result.summary;
    } else {
      console.log(`\n⚠️  第一次压缩测试部分通过，但结果可能不理想`);
      return result.summary;
    }
  } catch (err) {
    console.error(`\n❌ 第一次压缩测试异常：`, (err as Error).message);
    console.error((err as Error).stack);
    return "";
  }
}

/**
 * 测试第二次压缩 - tagging 策略
 */
async function testSecondCompression(sessionId: string, previousSummary: string) {
  console.log("\n" + "=".repeat(60));
  console.log("测试 2：第二次压缩 (tagging 策略)");
  console.log("=".repeat(60) + "\n");

  // 创建包含上次压缩结果的对话
  const turns: Turn[] = [
    {
      id: randomUUID(),
      role: "system",
      content: "[Compressed conversation summary]\n" + previousSummary,
      tags: ["compressed"],
      tokenCount: previousSummary.length / 4,
      compressed: true,
      timestamp: Date.now() - 30000,
    },
    // 添加新的对话
    {
      id: randomUUID(),
      role: "user",
      content: "实现完成后，我发现性能有问题。加载一个 10MB 的配置文件需要 5 秒，这太慢了。",
      tags: ["user"],
      tokenCount: 40,
      compressed: false,
      timestamp: Date.now() - 20000,
    },
    {
      id: randomUUID(),
      role: "assistant",
      content: "性能问题可能来自几个方面：\n1. YAML 解析本身就比 JSON 慢\n2. Schema 验证对大对象很耗时\n3. 可能有不必要的深拷贝\n\n我建议：\n- 使用流式解析\n- 延迟验证（只验证访问的部分）\n- 添加缓存机制",
      tags: ["assistant"],
      tokenCount: 80,
      compressed: false,
      timestamp: Date.now() - 19000,
    },
    {
      id: randomUUID(),
      role: "user",
      content: "好主意！另外，我们需要支持配置文件的加密存储，因为里面可能包含敏感信息如 API 密钥。",
      tags: ["user"],
      tokenCount: 35,
      compressed: false,
      timestamp: Date.now() - 18000,
    },
  ];

  const metadata: CompressionMetadata = {
    count: 1, // 第二次压缩
    lastCompressedAt: Date.now() - 30000,
    lastRatio: 0.5,
    totalRemoved: 10,
  };

  console.log(`📊 输入信息：`);
  console.log(`  - 对话轮数：${turns.length} (包含 1 个压缩摘要)`);
  console.log(`  - 压缩次数：${metadata.count} (第二次)`);
  console.log(`  - 预期策略：tagging`);
  console.log(`  - 预期行为：使用结构化标签，可能使用 RAG 工具\n`);

  try {
    const startTime = Date.now();
    const result = await compress(turns, mockConfig, sessionId, metadata);
    const elapsed = Date.now() - startTime;

    console.log(`\n📈 压缩结果：`);
    console.log(`  - 成功：${result.success ? "✅" : "❌"}`);
    console.log(`  - 删除轮数：${result.removedCount}`);
    console.log(`  - 摘要长度：${result.summary.length} 字符`);
    console.log(`  - 耗时：${elapsed}ms`);
    console.log(`  - RAG 条目：${result.ragEntriesAdded || 0}`);

    if (result.error) {
      console.log(`  - 错误：${result.error}`);
    }

    console.log(`\n📝 压缩摘要：`);
    console.log("-".repeat(60));
    console.log(result.summary);
    console.log("-".repeat(60));

    // 验证结果
    console.log(`\n🔍 验证：`);
    const hasTag = result.summary.includes("<") && result.summary.includes(">");
    const hasPerformance = result.summary.includes("性能") || result.summary.includes("慢");
    const hasEncryption = result.summary.includes("加密") || result.summary.includes("敏感");

    console.log(`  - 是否使用标签：${hasTag ? "✅" : "❌ (未使用结构化标签)"}`);
    console.log(`  - 是否保留性能问题：${hasPerformance ? "✅" : "❌"}`);
    console.log(`  - 是否保留新需求：${hasEncryption ? "✅" : "❌"}`);

    if (result.success && hasTag) {
      console.log(`\n✅ 第二次压缩测试通过！`);
      return result.summary;
    } else {
      console.log(`\n⚠️  第二次压缩测试部分通过`);
      return result.summary;
    }
  } catch (err) {
    console.error(`\n❌ 第二次压缩测试异常：`, (err as Error).message);
    console.error((err as Error).stack);
    return "";
  }
}

/**
 * 测试第三次压缩 - supplement 策略
 */
async function testThirdCompression(sessionId: string, previousSummary: string) {
  console.log("\n" + "=".repeat(60));
  console.log("测试 3：第三次压缩 (supplement 策略)");
  console.log("=".repeat(60) + "\n");

  const turns: Turn[] = [
    {
      id: randomUUID(),
      role: "system",
      content: "[Compressed conversation summary]\n" + previousSummary,
      tags: ["compressed"],
      tokenCount: previousSummary.length / 4,
      compressed: true,
      timestamp: Date.now() - 10000,
    },
    {
      id: randomUUID(),
      role: "user",
      content: "加密功能实现后，我们决定改用 AES-256-GCM 而不是之前提到的 AES-128，因为安全性要求更高了。",
      tags: ["user"],
      tokenCount: 40,
      compressed: false,
      timestamp: Date.now() - 5000,
    },
    {
      id: randomUUID(),
      role: "assistant",
      content: "好的，我会更新为 AES-256-GCM。这确实更安全，虽然性能会稍微慢一点，但对于配置文件来说完全可以接受。",
      tags: ["assistant"],
      tokenCount: 45,
      compressed: false,
      timestamp: Date.now() - 4000,
    },
  ];

  const metadata: CompressionMetadata = {
    count: 2, // 第三次压缩
    lastCompressedAt: Date.now() - 10000,
    lastRatio: 0.6,
    totalRemoved: 20,
  };

  console.log(`📊 输入信息：`);
  console.log(`  - 对话轮数：${turns.length}`);
  console.log(`  - 压缩次数：${metadata.count} (第三次)`);
  console.log(`  - 预期策略：supplement`);
  console.log(`  - 预期行为：增量更新，合并到已有标签\n`);

  try {
    const startTime = Date.now();
    const result = await compress(turns, mockConfig, sessionId, metadata);
    const elapsed = Date.now() - startTime;

    console.log(`\n📈 压缩结果：`);
    console.log(`  - 成功：${result.success ? "✅" : "❌"}`);
    console.log(`  - 删除轮数：${result.removedCount}`);
    console.log(`  - 摘要长度：${result.summary.length} 字符`);
    console.log(`  - 耗时：${elapsed}ms`);

    if (result.error) {
      console.log(`  - 错误：${result.error}`);
    }

    console.log(`\n📝 压缩摘要：`);
    console.log("-".repeat(60));
    console.log(result.summary);
    console.log("-".repeat(60));

    // 验证结果
    console.log(`\n🔍 验证：`);
    const hasUpdate = result.summary.includes("AES-256-GCM") || result.summary.includes("updated");
    const retainsPrevious = result.summary.includes("yargs") || result.summary.includes("性能");

    console.log(`  - 是否包含更新：${hasUpdate ? "✅" : "❌"}`);
    console.log(`  - 是否保留旧信息：${retainsPrevious ? "✅" : "❌"}`);

    if (result.success) {
      console.log(`\n✅ 第三次压缩测试通过！`);
    } else {
      console.log(`\n⚠️  第三次压缩测试部分通过`);
    }
  } catch (err) {
    console.error(`\n❌ 第三次压缩测试异常：`, (err as Error).message);
    console.error((err as Error).stack);
  }
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log("\n" + "=".repeat(60));
  console.log("🧪 压缩模块完整测试");
  console.log("=".repeat(60));
  console.log(`\n⚙️  配置信息：`);
  console.log(`  - Model: ${mockConfig.model}`);
  console.log(`  - API Base URL: ${mockConfig.apiBaseUrl}`);
  console.log(`  - API Key: ${mockConfig.apiKey ? "已设置 ✅" : "未设置 ❌"}`);
  console.log(`  - Max Tokens: ${mockConfig.maxTokens}`);

  if (!mockConfig.apiKey || mockConfig.apiKey === "test-key") {
    console.log(`\n⚠️  警告：API Key 未设置或使用测试值，测试可能失败`);
    console.log(`   请在 .env 文件中设置 API_KEY`);
  }

  // 创建统一的 sessionId，所有测试共用
  const sessionId = "test-session-" + Date.now();
  console.log(`\n📁 会话 ID: ${sessionId}`);

  try {
    // 测试 1：第一次压缩
    const summary1 = await testFirstCompression(sessionId);
    
    if (!summary1) {
      console.log(`\n❌ 第一次压缩失败，跳过后续测试`);
      return;
    }

    // 等待一下，避免 API 限流
    console.log(`\n⏳ 等待 2 秒...`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 测试 2：第二次压缩
    const summary2 = await testSecondCompression(sessionId, summary1);

    if (!summary2) {
      console.log(`\n❌ 第二次压缩失败，跳过第三次测试`);
      return;
    }

    // 等待一下
    console.log(`\n⏳ 等待 2 秒...`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 测试 3：第三次压缩
    await testThirdCompression(sessionId, summary2);

    console.log("\n" + "=".repeat(60));
    console.log("🎉 所有测试完成！");
    console.log(`📁 会话目录: .sessions/${sessionId}`);
    console.log(`📄 RAG 文件: .sessions/${sessionId}/rag.json`);
    console.log("=".repeat(60) + "\n");

  } catch (err) {
    console.error(`\n❌ 测试失败：`, err);
    process.exit(1);
  }
}

// 执行测试
runAllTests().catch((err) => {
  console.error("测试失败：", err);
  process.exit(1);
});
