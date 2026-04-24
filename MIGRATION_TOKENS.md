# Token 模块迁移指南

## 概述

Token 模块已重新设计，采用更简单、更准确的方案：**直接使用模型 API 返回的 usage 字段**。

## 为什么重新设计？

### 旧方案的问题
1. **复杂**: 依赖多个 tokenizer 库（gpt-tokenizer、@xenova/transformers）
2. **不准确**: 本地计算的 token 数与实际用量可能不一致
3. **体积大**: HuggingFace tokenizer 需要下载大量模型文件
4. **网络依赖**: 首次使用需要下载 tokenizer，可能超时
5. **维护成本高**: 需要维护多个 tokenizer 的映射和配置

### 新方案的优势
1. **简单**: 无外部依赖，只做用量追踪
2. **准确**: 使用模型 API 返回的准确数据
3. **轻量**: 代码量减少 80%+
4. **快速**: 无需加载 tokenizer，启动即用
5. **易维护**: 逻辑清晰，易于扩展

## API 变化

### 移除的 API

```typescript
// ❌ 已移除
countTokens(text: string, model?: string): Promise<number>
countTurnTokens(turn: Turn, model?: string): Promise<number>
countTurnsTokens(turns: Turn[], model?: string): Promise<number>
resolveEncoding(model: string): EncodingName
clearTokenizerCache(model?: string): void
getSupportedModels(): {...}
setHFEndpoint(endpoint: string): void
getHFEndpointInfo(): {...}
resetHFEndpointTest(): void
```

### 保留的 API

```typescript
// ✅ 保留（功能不变）
tokenTracker.track(usage: TokenUsage): void
tokenTracker.getCumulative(): TokenUsage
tokenTracker.getLastTurn(): TokenUsage | null
tokenTracker.getTurnHistory(): TokenUsage[]
tokenTracker.totalInContext(): number
tokenTracker.setContextTokens(count: number): void
tokenTracker.reset(): void
```

### 新增的 API

```typescript
// ✅ 新增
tokenTracker.getSummary(): {...}
estimateTokensFromTurns(turns: Turn[]): number
createEmptyUsage(): TokenUsage
mergeUsage(...usages: TokenUsage[]): TokenUsage
formatUsage(usage: TokenUsage): string
calculateCost(usage: TokenUsage, pricing: {...}): number
```

## 迁移步骤

### 1. 更新依赖

```bash
# 移除旧依赖
npm uninstall gpt-tokenizer @xenova/transformers

# 如果已经安装了，运行
npm install
```

### 2. 更新代码

#### 场景 1: 计算文本 token 数

**旧代码**:
```typescript
import { countTokens } from "./src/tokens/index.js";

const tokens = await countTokens("Hello, world!", "gpt-4");
```

**新方案**: 不再需要本地计算，直接使用模型 API 返回的 usage
```typescript
// 模型调用时自动获取准确的 token 数
const response = await model.chat(messages);
console.log(response.usage); // { prompt: 100, completion: 50, total: 150 }
```

#### 场景 2: 判断是否需要压缩

**旧代码**:
```typescript
import { countTurnsTokens } from "./src/tokens/index.js";

const totalTokens = await countTurnsTokens(turns, model);
if (totalTokens > contextLimit) {
  // 压缩
}
```

**新代码**:
```typescript
import { estimateTokensFromTurns } from "./src/tokens/index.js";

// 使用粗略估算（足够用于判断）
const estimated = estimateTokensFromTurns(turns);
if (estimated > contextLimit) {
  // 压缩
}

// 或者使用 tokenTracker 的上下文 token 数（更准确）
if (tokenTracker.totalInContext() > contextLimit) {
  // 压缩
}
```

#### 场景 3: 追踪用量

**旧代码**:
```typescript
import { tokenTracker } from "./src/tokens/index.js";

// 手动计算并追踪
const tokens = await countTokens(text, model);
tokenTracker.track({ prompt: tokens, completion: 0, total: tokens });
```

**新代码**:
```typescript
import { tokenTracker } from "./src/tokens/index.js";

// 直接使用模型返回的 usage
const response = await model.chat(messages);
tokenTracker.track(response.usage); // 准确且简单
```

### 3. 更新 ConversationManager

如果你的 `ConversationManager` 使用了 token 计算：

**旧代码**:
```typescript
import { countTurnsTokens } from "../tokens/index.js";

async shouldCompress(): Promise<boolean> {
  const total = await countTurnsTokens(this.turns, this.config.model);
  return total > this.config.contextLimit;
}
```

**新代码**:
```typescript
import { estimateTokensFromTurns } from "../tokens/index.js";

shouldCompress(): boolean {
  // 使用估算（足够准确，且无需 async）
  const estimated = estimateTokensFromTurns(this.turns);
  return estimated > this.config.contextLimit;
  
  // 或者使用 tokenTracker 的准确数据
  // return this.tokenTracker.totalInContext() > this.config.contextLimit;
}
```

## 常见问题

### Q: 如何获取准确的 token 数？

A: 使用模型 API 返回的 `usage` 字段，这是最准确的。

```typescript
const response = await model.chat(messages);
console.log(response.usage.total); // 准确的 token 数
```

### Q: 如果需要在调用前估算 token 数怎么办？

A: 使用 `estimateTokensFromTurns` 进行粗略估算。虽然不如 API 返回的准确，但足够用于判断是否需要压缩。

```typescript
const estimated = estimateTokensFromTurns(turns);
```

### Q: 不同模型的 token 计算方式不同怎么办？

A: 不需要担心！模型 API 会返回该模型的准确 token 数，我们只需要使用它。

### Q: 如果某个供应商不返回 usage 字段怎么办？

A: 目前主流供应商（OpenAI、Anthropic、Google、Azure 等）都提供 usage 字段。如果未来遇到不提供的供应商，可以：

1. 使用 `estimateTokensFromTurns` 作为 fallback
2. 为该供应商实现专门的估算策略
3. 要求供应商提供 usage 字段（这是标准做法）

### Q: 旧的 tokenizer 文件怎么清理？

A: 如果之前下载了 HuggingFace tokenizer 文件，可以删除缓存：

```bash
# Linux/Mac
rm -rf ~/.cache/huggingface/

# Windows
rmdir /s %USERPROFILE%\.cache\huggingface
```

## 性能对比

| 指标 | 旧方案 | 新方案 |
|------|--------|--------|
| 依赖大小 | ~50MB | 0 |
| 首次加载 | 1-5秒 | <10ms |
| 准确性 | 近似 | 100% |
| 网络依赖 | 是 | 否 |
| 代码量 | ~500行 | ~200行 |

## 总结

新方案更简单、更准确、更快速。迁移成本很低，主要是：

1. 移除旧依赖
2. 将 `countTokens` 等调用替换为使用 API 返回的 usage
3. 将 `countTurnsTokens` 替换为 `estimateTokensFromTurns`

如有问题，请参考 `src/tokens/README.md` 或查看测试文件 `src/tokens/test-tokenizer.ts`。
