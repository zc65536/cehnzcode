# Token 用量追踪模块

简单、准确的 token 用量追踪，基于模型 API 返回的 usage 字段。

## 设计理念

- ✅ **准确性优先**: 使用模型 API 返回的 usage 字段，而不是本地估算
- ✅ **简单易用**: 无需复杂的 tokenizer 依赖和配置
- ✅ **轻量级**: 只做用量追踪和统计，不做 token 计算

## 快速开始

```typescript
import { tokenTracker } from "./index.js";

// 模型调用后，追踪用量
const usage = { prompt: 100, completion: 50, total: 150 };
tokenTracker.track(usage);

// 获取累计用量
const cumulative = tokenTracker.getCumulative();
console.log(cumulative); // { prompt: 100, completion: 50, total: 150 }
```

## 核心 API

### TokenTracker 类

```typescript
class TokenTracker {
  // 追踪一次模型调用的用量
  track(usage: TokenUsage): void;

  // 获取累计用量
  getCumulative(): TokenUsage;

  // 获取最近一次调用的用量
  getLastTurn(): TokenUsage | null;

  // 获取完整的用量历史
  getTurnHistory(): TokenUsage[];

  // 获取当前上下文的 token 数
  totalInContext(): number;

  // 设置上下文 token 数（压缩后调用）
  setContextTokens(count: number): void;

  // 获取统计摘要
  getSummary(): {
    cumulative: TokenUsage;
    lastTurn: TokenUsage | null;
    contextTokens: number;
    turnCount: number;
  };

  // 重置所有统计
  reset(): void;
}
```

### 辅助函数

```typescript
// 粗略估算 Turn 数组的 token 数（用于压缩前判断）
estimateTokensFromTurns(turns: Turn[]): number;

// 创建空的 TokenUsage 对象
createEmptyUsage(): TokenUsage;

// 合并多个 TokenUsage 对象
mergeUsage(...usages: TokenUsage[]): TokenUsage;

// 格式化 TokenUsage 为可读字符串
formatUsage(usage: TokenUsage): string;

// 计算 token 用量的成本
calculateCost(
  usage: TokenUsage,
  pricing: { promptPer1M: number; completionPer1M: number }
): number;
```

## 使用示例

### 基本追踪

```typescript
import { tokenTracker } from "./index.js";

// 每次模型调用后追踪用量
const response = await model.chat(messages);
tokenTracker.track(response.usage);

// 查看累计用量
console.log(tokenTracker.getCumulative());
```

### 成本计算

```typescript
import { tokenTracker, calculateCost } from "./index.js";

// 获取累计用量
const usage = tokenTracker.getCumulative();

// 计算成本（GPT-4 价格示例）
const pricing = {
  promptPer1M: 30.0,      // $30 per 1M prompt tokens
  completionPer1M: 60.0,  // $60 per 1M completion tokens
};

const cost = calculateCost(usage, pricing);
console.log(`总成本: $${cost.toFixed(4)}`);
```

### 统计摘要

```typescript
import { tokenTracker, formatUsage } from "./index.js";

const summary = tokenTracker.getSummary();
console.log(`总调用次数: ${summary.turnCount}`);
console.log(`累计用量: ${formatUsage(summary.cumulative)}`);
console.log(`当前上下文: ${summary.contextTokens} tokens`);
```

### 粗略估算（压缩前判断）

```typescript
import { estimateTokensFromTurns } from "./index.js";

// 在压缩前粗略估算 token 数
const estimated = estimateTokensFromTurns(conversationTurns);
if (estimated > contextLimit) {
  // 触发压缩
  compressConversation();
}
```

## TokenUsage 类型

```typescript
interface TokenUsage {
  prompt: number;      // 输入 token 数
  completion: number;  // 输出 token 数
  total: number;       // 总 token 数
}
```

## 注意事项

1. **准确性**: 用量数据来自模型 API，完全准确
2. **估算函数**: `estimateTokensFromTurns` 只是粗略估算，用于压缩前判断
3. **成本计算**: 需要提供正确的价格配置（不同模型价格不同）
4. **全局单例**: `tokenTracker` 是全局单例，整个应用共享

## 测试

```bash
npx tsx src/tokens/test-tokenizer.ts
```

## 与旧版本的区别

### 旧版本（复杂）
- ❌ 依赖多个 tokenizer 库
- ❌ 需要配置镜像源
- ❌ 本地计算不准确
- ❌ 体积大、加载慢

### 新版本（简单）
- ✅ 无外部依赖
- ✅ 使用 API 返回的准确数据
- ✅ 轻量级、快速
- ✅ 易于维护

## 扩展性

如果未来需要支持没有 usage 字段的模型供应商，可以：

1. 创建 `TokenEstimator` 接口
2. 为不同供应商实现估算策略
3. 在 `TokenTracker` 中集成估算逻辑

但目前主流供应商（OpenAI、Anthropic、Google 等）都提供 usage 字段，暂不需要。
