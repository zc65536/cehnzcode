/**
 * Token 追踪功能测试脚本 - 真实模型调用版本
 * 运行: npx tsx src/tokens/test-tokenizer.ts
 */

import {
  TokenTracker,
  estimateTokensFromTurns,
  mergeUsage,
  formatUsage,
  calculateCost,
} from "./index.js";
import type { TokenUsage, Turn } from "../types.js";

// ========== 配置区域 ==========
// 请填写你的 API 配置
const API_BASE_URL = "https://www.dmxapi.cn" 
const API_KEY = "sk-CyBVeDkK7HEezkp0wfrXuhRXkfnHtmPdcfCVkcSffDgb0vDa"
const MODEL = "mimo-v2.5-free"
// ==============================

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * 调用 Claude API
 */
async function callClaude(
  messages: AnthropicMessage[]
): Promise<{ response: string; usage: TokenUsage }> {
  if (!API_BASE_URL || !API_KEY || !MODEL) {
    throw new Error(
      "请先配置 API_BASE_URL, API_KEY 和 MODEL 变量"
    );
  }

  const response = await fetch(`${API_BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API 调用失败: ${response.status} - ${error}`);
  }

  const data: AnthropicResponse = await response.json();

  return {
    response: data.content[0].text,
    usage: {
      prompt: data.usage.input_tokens,
      completion: data.usage.output_tokens,
      total: data.usage.input_tokens + data.usage.output_tokens,
    },
  };
}

async function testRealModelCalls() {
  console.log("🧪 测试真实模型调用\n");
  console.log(`模型: ${MODEL}`);
  console.log(`API: ${API_BASE_URL}\n`);

  const tracker = new TokenTracker(MODEL);

  // 第一次调用：简单问候
  console.log("1️⃣ 第一次调用 - 简单问候");
  try {
    const { response: response1, usage: usage1 } = await callClaude([
      { role: "user", content: "你好，请用一句话介绍你自己。" },
    ]);
    tracker.track(usage1);
    console.log(`   助手回复: ${response1}`);
    console.log(`   Token 用量: ${formatUsage(usage1)}`);
    console.log(`   累计用量: ${formatUsage(tracker.getCumulative())}\n`);
  } catch (error) {
    console.error(`   ❌ 调用失败:`, error);
    throw error;
  }

  // 第二次调用：带上下文的对话
  console.log("2️⃣ 第二次调用 - 多轮对话");
  try {
    const { response: response2, usage: usage2 } = await callClaude([
      { role: "user", content: "你好，请用一句话介绍你自己。" },
      {
        role: "assistant",
        content: "我是 Claude，一个由 Anthropic 开发的 AI 助手。",
      },
      { role: "user", content: "你能帮我做什么？" },
    ]);
    tracker.track(usage2);
    console.log(`   助手回复: ${response2}`);
    console.log(`   Token 用量: ${formatUsage(usage2)}`);
    console.log(`   累计用量: ${formatUsage(tracker.getCumulative())}\n`);
  } catch (error) {
    console.error(`   ❌ 调用失败:`, error);
    throw error;
  }

  // 第三次调用：较长的输入
  console.log("3️⃣ 第三次调用 - 较长输入");
  try {
    const { response: response3, usage: usage3 } = await callClaude([
      {
        role: "user",
        content:
          "请用 50 字以内总结一下什么是 Token 追踪，以及为什么它在 AI 应用中很重要。",
      },
    ]);
    tracker.track(usage3);
    console.log(`   助手回复: ${response3}`);
    console.log(`   Token 用量: ${formatUsage(usage3)}`);
    console.log(`   累计用量: ${formatUsage(tracker.getCumulative())}\n`);
  } catch (error) {
    console.error(`   ❌ 调用失败:`, error);
    throw error;
  }

  // 显示最终统计
  const summary = tracker.getSummary();
  console.log("📊 测试统计:");
  console.log(`   总调用次数: ${summary.turnCount}`);
  console.log(`   累计用量: ${formatUsage(summary.cumulative)}`);
  console.log(`   平均每次: prompt=${Math.round(summary.cumulative.prompt / summary.turnCount)}, completion=${Math.round(summary.cumulative.completion / summary.turnCount)}`);
  console.log(`   当前上下文: ${summary.contextTokens} tokens`);

  // 计算成本（Claude 3.5 Sonnet 价格）
  const pricing = { promptPer1M: 3.0, completionPer1M: 15.0 };
  const cost = calculateCost(summary.cumulative, pricing);
  console.log(`   估算成本: $${cost.toFixed(6)}\n`);

  // 显示每次调用的详细历史
  console.log("📜 调用历史:");
  tracker.getTurnHistory().forEach((turn, index) => {
    console.log(`   第 ${index + 1} 次: ${formatUsage(turn)}`);
  });
  console.log();
}

function testEstimation() {
  console.log("🧪 测试 Token 估算\n");

  const turns: Turn[] = [
    {
      id: "1",
      role: "user",
      content: "Hello, how are you?",
      tags: [],
      tokenCount: 0,
      compressed: false,
      timestamp: Date.now(),
    },
    {
      id: "2",
      role: "assistant",
      content: "I'm doing well, thank you! How can I help you today?",
      tags: [],
      tokenCount: 0,
      compressed: false,
      timestamp: Date.now(),
    },
  ];

  const estimated = estimateTokensFromTurns(turns);
  console.log(`估算的 token 数: ${estimated}`);
  console.log("注意: 这只是粗略估算，实际用量以模型 API 返回为准\n");
}

function testUsageHelpers() {
  console.log("🧪 测试辅助函数\n");

  // 测试合并
  const usage1: TokenUsage = { prompt: 100, completion: 50, total: 150 };
  const usage2: TokenUsage = { prompt: 200, completion: 80, total: 280 };
  const merged = mergeUsage(usage1, usage2);
  console.log("合并用量:");
  console.log(`  用量 1: ${formatUsage(usage1)}`);
  console.log(`  用量 2: ${formatUsage(usage2)}`);
  console.log(`  合并后: ${formatUsage(merged)}\n`);

  // 测试成本计算
  const pricing = {
    promptPer1M: 3.0,
    completionPer1M: 15.0,
  };
  const cost = calculateCost(merged, pricing);
  console.log("成本计算:");
  console.log(`  用量: ${formatUsage(merged)}`);
  console.log(`  价格: $${pricing.promptPer1M}/1M prompt, $${pricing.completionPer1M}/1M completion`);
  console.log(`  总成本: $${cost.toFixed(6)}\n`);
}

async function main() {
  try {
    // 先运行不需要 API 的测试
    testEstimation();
    testUsageHelpers();

    // 运行真实 API 调用测试
    await testRealModelCalls();

    console.log("✅ 所有测试完成!");
  } catch (error) {
    console.error("\n❌ 测试失败:", error);
    process.exit(1);
  }
}

main();
