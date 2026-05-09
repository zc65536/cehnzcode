# 流式输出与Token计数实现文档

## 实现概述

根据 `Future_Vision.md` 中的需求：
> 增强流式输出（Streaming）支持，Orchestrator 层确保只有在获取到完整的 usage 后才调用 track
> 对于计数token的，流式全部输出完之后再进行token计数，避免usage没有输出出来

本次实现确保了**流式输出完成后才进行token计数**，避免在usage信息未返回时就进行追踪。

## 实现细节

### 1. Model层改造 (`src/model/index.ts`)

#### 1.1 新的流式API设计

将原来的简单生成器改为返回对象的形式：

```typescript
chatStream(turns: Turn[], tools: ToolDefinition[]): {
  stream: AsyncIterable<string>;      // 流式输出
  getResponse: () => Promise<ModelResponse>;  // 获取完整响应（含usage）
}
```

**设计理念：**
- `stream`: 用于实时显示输出内容
- `getResponse()`: 在流式结束后调用，获取完整的响应信息（包括usage）

#### 1.2 OpenAI实现 (`chatStreamWithOpenAIWrapper`)

**关键点：**
1. 使用 `stream_options: { include_usage: true }` 请求usage信息
2. 在流式过程中收集：
   - 文本内容 (`fullContent`)
   - 工具调用 (`toolCallsMap`)
   - 最后的chunk（包含usage）
3. `getResponse()` 等待流式完成后返回完整响应

**工具调用处理：**
- 使用 `Map<number, {...}>` 存储工具调用
- 累积拼接 `arguments` 字符串
- 最后统一解析JSON

#### 1.3 Claude实现 (`chatStreamWithClaudeWrapper`)

**关键点：**
1. 使用 Anthropic SDK 的 `messages.stream()` API
2. 通过 `streamResponse.finalMessage()` 获取完整消息（含usage）
3. Claude的usage信息在 `finalMessage.usage` 中

### 2. Orchestrator层改造 (`src/orchestrator/index.ts`)

#### 2.1 使用流式输出

```typescript
// 旧代码：非流式
const response = await this.model.chat(this.context.getTurns(), tools);

// 新代码：流式
const { stream, getResponse } = this.model.chatStream(this.context.getTurns(), tools);

// 实时显示
for await (const chunk of stream) {
  this.ui.showAssistantChunk(chunk);
}

// 流式结束后获取完整响应
const response = await getResponse();

// 只有在获取到完整响应后才追踪token
tokenTracker.track(response.usage);
```

**关键改进：**
- ✅ 用户能实时看到AI的回复（流式输出）
- ✅ 确保在获取到usage后才调用 `tokenTracker.track()`
- ✅ 避免了usage信息缺失的问题

### 3. UI层改造

#### 3.1 UIAdapter接口 (`src/types.ts`)

新增方法：
```typescript
showAssistantChunk(chunk: string): void;  // 显示单个流式chunk
```

#### 3.2 TUI实现 (`src/ui/tui/index.ts`)

**改进：**
1. 添加 `isStreamingLine` 状态标记
2. `showAssistantChunk()`: 直接输出chunk，不换行
3. 其他方法（`showToolStatus`, `showTokenUsage`等）：
   - 检查是否在流式输出中
   - 如果是，先换行再显示内容
   - 避免输出混乱

**效果：**
```
> 你好

TypeScript是JavaScript的超集，添加了静态类型系统...

  📊 Tokens - API call: 150 (context: 50 + response: 100) | session total: 150
```

## 测试

### 测试文件
`src/model/test-streaming-tokens.ts`

### 运行测试
```bash
# 设置环境变量
export API_KEY="your-api-key"
export API_BASE_URL="https://api.openai.com/v1"
export MODEL="gpt-4"

# 运行测试
npm run build
node dist/model/test-streaming-tokens.js
```

### 测试验证点
1. ✅ 流式输出能正常工作
2. ✅ 流式结束后能获取完整的usage信息
3. ✅ tokenTracker能正确追踪token使用情况

## 技术要点

### 1. 流式输出的状态管理

**问题：** 如何在流式输出完成后获取usage？

**解决方案：**
- 使用闭包保存状态（`fullContent`, `fullResponse`, `streamFinished`）
- `getResponse()` 检查 `streamFinished`，如果未完成则先消费完流
- 确保usage信息在流式结束时已收集完毕

### 2. OpenAI的stream_options

OpenAI API支持在流式响应的最后一个chunk中返回usage：
```typescript
stream_options: { include_usage: true }
```

这样可以在流式结束时获取准确的token计数。

### 3. Claude的finalMessage

Anthropic SDK提供了 `finalMessage()` 方法：
```typescript
const streamResponse = await this.anthropicClient.messages.stream(params);
// ... 消费流
const fullMessage = await streamResponse.finalMessage();
// fullMessage.usage 包含token信息
```

### 4. 向后兼容

保留了原有的 `chatStreamWithOpenAI` 和 `chatStreamWithClaude` 方法，
以防其他地方有直接使用。新代码统一使用 `chatStream()` 方法。

## 优势

1. **用户体验提升**
   - 实时看到AI回复，不用等待完整响应
   - 类似ChatGPT的流式输出体验

2. **Token计数准确**
   - 确保在获取到API返回的usage后才追踪
   - 避免了usage缺失导致的统计错误

3. **架构清晰**
   - Model层负责流式输出和数据收集
   - Orchestrator层负责流程控制和token追踪
   - UI层负责显示，支持流式chunk

4. **易于扩展**
   - 新的API设计便于添加更多流式相关功能
   - 例如：流式工具调用、流式思考过程等

## 后续优化建议

1. **流式工具调用显示**
   - 当前工具调用在流式结束后才显示
   - 可以考虑在流式过程中实时显示工具调用信息

2. **进度指示**
   - 添加流式输出的进度指示（如字符计数）
   - 显示预估的剩余token数

3. **错误处理**
   - 增强流式中断时的错误处理
   - 支持流式输出的取消操作

4. **性能监控**
   - 记录流式输出的延迟
   - 统计首字节时间（TTFB）和完成时间

## 相关文件

- `src/model/index.ts` - Model层实现
- `src/orchestrator/index.ts` - Orchestrator层实现
- `src/ui/tui/index.ts` - TUI实现
- `src/types.ts` - 类型定义
- `src/tokens/index.ts` - Token追踪（未修改，已支持）
- `src/model/test-streaming-tokens.ts` - 测试文件

## 符合项目规范

根据 `CLAUDE.md` 的要求：

1. ✅ **易读优先**: 代码清晰，注释完整
2. ✅ **异步处理**: 使用 `async/await`
3. ✅ **接口约定**: 保持对外接口稳定，内部实现改进
4. ✅ **测试文件**: 放在对应模块目录下（`src/model/test-streaming-tokens.ts`）

## 总结

本次实现完全满足了 `Future_Vision.md` 中的需求：
- ✅ 增强了流式输出支持
- ✅ Orchestrator层确保只有在获取到完整usage后才调用track
- ✅ 流式全部输出完之后再进行token计数
- ✅ 避免了usage没有输出的问题

用户现在可以享受实时的流式输出体验，同时系统能准确追踪token使用情况。
