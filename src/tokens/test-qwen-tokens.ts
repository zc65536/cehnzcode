/**
 * 测试 Qwen API 的 token 计数行为
 * 
 * 目的：验证 Qwen API 返回的 completion_tokens 是否包含额外开销
 */

import OpenAI from 'openai';
import { config } from 'dotenv';

config();

const client = new OpenAI({
  apiKey: process.env.API_KEY,
  baseURL: process.env.API_BASE_URL,
});

async function testTokenCounting() {
  console.log('=== Qwen API Token 计数测试 ===\n');
  console.log(`模型: ${process.env.MODEL}\n`);

  const testCases = [
    { user: '1', expectedAssistant: '1' },
    { user: '回复：好', expectedAssistant: '好' },
    { user: '只说一个字：是', expectedAssistant: '是' },
    { user: 'Say: hi', expectedAssistant: 'hi' },
  ];

  for (const testCase of testCases) {
    console.log(`\n--- 测试 ---`);
    console.log(`用户输入: "${testCase.user}"`);
    console.log(`期望回复: "${testCase.expectedAssistant}"`);

    try {
      const response = await client.chat.completions.create({
        model: process.env.MODEL!,
        messages: [
          {
            role: 'system',
            content: '你是一个简洁的助手，严格按照用户要求回复，不要添加任何额外内容。'
          },
          {
            role: 'user',
            content: testCase.user
          }
        ],
        max_tokens: 100,
      });

      const message = response.choices[0].message;
      const usage = response.usage;

      console.log(`实际回复: "${message.content}"`);
      console.log(`回复长度: ${message.content?.length ?? 0} 字符`);
      console.log(`Token 使用:`);
      console.log(`  prompt_tokens: ${usage?.prompt_tokens ?? 0}`);
      console.log(`  completion_tokens: ${usage?.completion_tokens ?? 0}`);
      console.log(`  total_tokens: ${usage?.total_tokens ?? 0}`);
      
      // 计算比例
      const contentLength = message.content?.length ?? 0;
      const completionTokens = usage?.completion_tokens ?? 0;
      if (contentLength > 0) {
        const ratio = completionTokens / contentLength;
        console.log(`  比例: ${ratio.toFixed(2)} tokens/字符`);
      }

    } catch (error) {
      console.error('错误:', error);
    }
  }

  console.log('\n=== 结论 ===');
  console.log('如果 completion_tokens 远大于实际内容长度，说明:');
  console.log('1. Qwen API 的 token 计数包含了消息格式开销');
  console.log('2. 或者 Qwen 的 tokenizer 对某些字符的编码方式不同');
  console.log('3. 这是正常的，不同模型供应商的计数方式不同');
}

testTokenCounting().catch(console.error);
