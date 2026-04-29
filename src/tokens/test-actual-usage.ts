/**
 * 测试实际的 token 使用情况
 * 用于验证 "11" 这样的简单回复是否真的需要 37 tokens
 */

import { TokenTracker, estimateTokens } from './index.js';

console.log('=== Token 估算测试 ===\n');

// 测试简单文本
const tests = [
  '11',
  '1',
  'hello',
  '你好',
  'The answer is 11',
];

for (const text of tests) {
  const estimated = estimateTokens(text);
  console.log(`文本: "${text}"`);
  console.log(`估算 tokens: ${estimated}\n`);
}

console.log('=== TokenTracker 测试 ===\n');

// 模拟 API 返回的 usage
const tracker = new TokenTracker();

// 第一次调用：用户输入 "1"，助手回复 "11"
const usage1 = {
  prompt: 994,      // 包含 system prompt + tools + 用户输入 "1"
  completion: 37,   // 助手回复 "11" 
  total: 1031
};

console.log('第一次 API 调用:');
console.log('  API 返回的 usage:', usage1);
tracker.track(usage1);

const lastTurn = tracker.getLastTurn();
console.log('  getLastTurn():', lastTurn);
console.log('  getCumulative():', tracker.getCumulative());

console.log('\n=== 分析 ===');
console.log('问题: 回复 "11" 需要 37 tokens 是否合理？');
console.log('');
console.log('可能的原因:');
console.log('1. completion tokens 包含了消息格式开销（role, content 等 JSON 结构）');
console.log('2. 可能包含了 finish_reason、tool_calls 等元数据');
console.log('3. OpenAI API 的 completion_tokens 计算方式可能包含额外开销');
console.log('');
console.log('验证方法: 查看实际的 API 响应');
