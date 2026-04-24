/**
 * Token 估算器测试
 * 
 * 模拟模型调用返回的结构（不含 usage 字段），测试 TokenTracker 的估算功能
 */

import { TokenTracker } from './index.js';
import type { ModelResponse } from '../types.js';

console.log('=== Token 估算器测试（模拟模型响应） ===\n');

// 创建测试用的 TokenTracker 实例
const tracker = new TokenTracker('gpt-4');

/**
 * 模拟模型响应（不含 usage 字段）
 */
function createMockResponse(content: string, toolCalls: any[] = []): Omit<ModelResponse, 'usage'> {
  return {
    content,
    toolCalls,
    finishReason: 'stop'
  };
}

// 测试 1: 纯英文对话
console.log('测试 1 - 纯英文对话:');
const promptEn = "Hello, can you help me write a function?";
const responseEn = createMockResponse("Sure! I'd be happy to help you write a function. What would you like it to do?");
console.log(`Prompt: "${promptEn}"`);
console.log(`Response: "${responseEn.content}"`);
tracker.track(undefined, {
  promptText: promptEn,
  completionText: responseEn.content
});
console.log('估算结果:', tracker.getLastTurn());
console.log('累计用量:', tracker.getCumulative());
console.log();

// 测试 2: 纯中文对话
console.log('测试 2 - 纯中文对话:');
const promptZh = "你好，请帮我写一个排序函数。";
const responseZh = createMockResponse("好的，我来帮你写一个排序函数。你需要什么类型的排序算法？");
console.log(`Prompt: "${promptZh}"`);
console.log(`Response: "${responseZh.content}"`);
tracker.track(undefined, {
  promptText: promptZh,
  completionText: responseZh.content
});
console.log('估算结果:', tracker.getLastTurn());
console.log('累计用量:', tracker.getCumulative());
console.log();

// 测试 3: 中英混合对话
console.log('测试 3 - 中英混合对话:');
const promptMixed = "请用 TypeScript 写一个 hello world 函数";
const responseMixed = createMockResponse(
  "好的，这是一个 TypeScript 的 hello world 函数：\n\n```typescript\nfunction hello(name: string): void {\n  console.log(`Hello, ${name}!`);\n}\n```"
);
console.log(`Prompt: "${promptMixed}"`);
console.log(`Response: "${responseMixed.content}"`);
tracker.track(undefined, {
  promptText: promptMixed,
  completionText: responseMixed.content
});
console.log('估算结果:', tracker.getLastTurn());
console.log('累计用量:', tracker.getCumulative());
console.log();

// 测试 4: 包含工具调用的响应
console.log('测试 4 - 包含工具调用:');
const promptTool = "请读取 package.json 文件的内容";
const responseTool = createMockResponse(
  "我来帮你读取 package.json 文件。",
  [
    {
      id: 'call_123',
      name: 'read_file',
      arguments: { path: 'package.json' }
    }
  ]
);
console.log(`Prompt: "${promptTool}"`);
console.log(`Response: "${responseTool.content}"`);
console.log(`Tool Calls:`, JSON.stringify(responseTool.toolCalls, null, 2));
// 将工具调用也计入 completion
const toolCallsText = JSON.stringify(responseTool.toolCalls);
tracker.track(undefined, {
  promptText: promptTool,
  completionText: responseTool.content + toolCallsText
});
console.log('估算结果:', tracker.getLastTurn());
console.log('累计用量:', tracker.getCumulative());
console.log();

// 测试 5: 长文本代码生成
console.log('测试 5 - 长文本代码生成:');
const promptCode = "请写一个完整的 Express 服务器示例";
const responseCode = createMockResponse(`好的，这是一个完整的 Express 服务器示例：

\`\`\`typescript
import express, { Request, Response } from 'express';

const app = express();
const PORT = 3000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 路由
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Hello World!' });
});

app.get('/api/users', (req: Request, res: Response) => {
  res.json({ users: ['Alice', 'Bob', 'Charlie'] });
});

app.post('/api/users', (req: Request, res: Response) => {
  const { name } = req.body;
  res.json({ message: \`User \${name} created\` });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(\`Server is running on http://localhost:\${PORT}\`);
});
\`\`\`

这个服务器包含了基本的 GET 和 POST 路由。`);
console.log(`Prompt: "${promptCode}"`);
console.log(`Response length: ${responseCode.content.length} characters`);
tracker.track(undefined, {
  promptText: promptCode,
  completionText: responseCode.content
});
console.log('估算结果:', tracker.getLastTurn());
console.log('累计用量:', tracker.getCumulative());
console.log();

// 测试 6: 空响应边界情况
console.log('测试 6 - 空响应边界情况:');
const promptEmpty = "hi";
const responseEmpty = createMockResponse("");
console.log(`Prompt: "${promptEmpty}"`);
console.log(`Response: "${responseEmpty.content}" (空字符串)`);
tracker.track(undefined, {
  promptText: promptEmpty,
  completionText: responseEmpty.content
});
console.log('估算结果:', tracker.getLastTurn());
console.log('累计用量:', tracker.getCumulative());
console.log();

// 测试 7: 不提供 fallback 数据（应该跳过）
console.log('测试 7 - 不提供 fallback 数据:');
console.log('调用 track() 但不提供 usage 和 fallbackData...');
tracker.track(undefined, undefined);
console.log('应该看到警告信息，且用量不变');
console.log('累计用量:', tracker.getCumulative());
console.log();

// 测试 8: 提供真实 usage（应该优先使用）
console.log('测试 8 - 提供真实 usage（优先使用）:');
const promptReal = "测试真实 usage";
const responseReal = createMockResponse("这是响应");
const realUsage = { prompt: 100, completion: 50, total: 150 };
console.log(`Prompt: "${promptReal}"`);
console.log(`Response: "${responseReal.content}"`);
console.log(`提供的真实 usage:`, realUsage);
tracker.track(realUsage, {
  promptText: promptReal,
  completionText: responseReal.content
});
console.log('记录结果（应该使用真实 usage）:', tracker.getLastTurn());
console.log('累计用量:', tracker.getCumulative());
console.log();

// 最终统计
console.log('=== 最终统计摘要 ===');
const summary = tracker.getSummary();
console.log(`总轮次: ${summary.turnCount}`);
console.log(`累计用量:`, summary.cumulative);
console.log(`最后一轮:`, summary.lastTurn);
console.log(`当前上下文 tokens: ${summary.contextTokens}`);
console.log();

// 测试 9: 重置功能
console.log('测试 9 - 重置功能:');
console.log('调用 reset()...');
tracker.reset();
console.log('重置后的累计用量:', tracker.getCumulative());
console.log('重置后的轮次历史长度:', tracker.getTurnHistory().length);
console.log();

console.log('=== 测试完成 ===');
console.log('\n说明:');
console.log('1. 当模型 API 不返回 usage 字段时，TokenTracker 会自动使用本地估算');
console.log('2. 估算值与实际值可能有 10-20% 的误差，这是正常的');
console.log('3. 如果提供了真实的 usage，会优先使用真实值而非估算');
console.log('4. 不同模型的 tokenizer 实现略有差异，本估算器针对 GPT/Claude 等主流模型优化');
