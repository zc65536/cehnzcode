# Context Compression Design

## 概述

本文档描述上下文压缩模块的完整设计方案。压缩模块负责在对话历史超过 token 限制时，智能压缩旧对话，同时保留关键信息。

**设计原则**：
- **高可扩展性**：压缩策略可插拔，支持自定义压缩算法
- **高解耦性**：压缩模块独立运行，不依赖主对话流程
- **信息保留**：通过 RAG 存储大块内容，避免信息丢失

---

## 核心概念

### 1. 压缩触发

**触发条件**：当前上下文 token 数超过配置的阈值时触发压缩。

```typescript
// 触发逻辑
if (tokenTracker.totalInContext() > config.contextLimit * 0.85) {
  await conversationManager.compress();
}
```

**阈值计算**：考虑系统提示词、压缩提示词、保留轮数、最大生成 token，确保压缩时不会溢出。

```typescript
function calculateSafeThreshold(config: AppConfig): number {
  const overhead = 
    500 +                              // 系统提示词
    300 +                              // 压缩提示词
    (config.keepRecentTurns * 500) +   // 保留的最新轮次
    config.maxTokens;                  // 模型最大生成
  
  const safeThreshold = (config.contextLimit - overhead) / config.contextLimit;
  return Math.max(0.5, Math.min(0.85, safeThreshold));
}
```

### 2. 压缩策略

根据**压缩次数**选择不同的压缩策略：

| 压缩次数 | 策略名称 | 提示词 | 说明 |
|---------|---------|--------|------|
| 第 1 次 | deletion | `DELETION_COMPRESSION_PROMPT` | 删除冗余，保留自然语言风格 |
| 第 2 次 | tagging | `COMPRESSION_PROMPT + COMPRESSION_LABELS` | 标签式压缩，结构化提取 |
| 第 3+ 次 | supplement | `COMPRESSION_SUPPLEMENT_PROMPT + COMPRESSION_LABELS` | 增量更新标签 |

### 3. 分段压缩

为避免 token 溢出，将待压缩内容分成两段，分别压缩：

```
待压缩内容 (N 轮)
├─ 第一段 (0 ~ N/2)  → 压缩为 summary1
└─ 第二段 (N/2 ~ N)  → 压缩为 summary2

最终结果 = summary1 + "\n\n---\n\n" + summary2
```

### 4. RAG 存储

**RAG (Retrieval-Augmented Generation)** 用于存储大块内容（代码、数据、错误日志等），避免在压缩时丢失。

**RAG 文件位置**：`.cehnzcode/sessions/<session-id>/rag.json`

**RAG 格式**：
```json
{
  "entries": {
    "rag#001": {
      "type": "code|data|error|decision",
      "content": "...",
      "file": "src/example.ts",
      "tags": ["auth", "implementation"],
      "timestamp": 1234567890,
      "confidence": "high|medium|stale"
    }
  },
  "metadata": {
    "createdAt": 1234567890,
    "lastUpdatedAt": 1234567890,
    "sessionId": "2024-01-15_abc123"
  }
}
```

**RAG 生命周期**：
- 创建会话时初始化空 RAG
- 压缩时模型可以读写 RAG
- 删除会话时自动删除 RAG

### 5. 压缩即 Mini-Agent

压缩过程本身是一个独立的 agent，有自己的工具调用循环：

```
1. 构造压缩对话（system + user）
2. 调用模型
3. 如果模型返回工具调用 → 执行工具 → 返回结果 → 继续循环
4. 如果模型不调用工具 → 返回压缩结果
```

模型可以在压缩过程中：
- 读取 RAG：`read_file .cehnzcode/sessions/<id>/rag.json`
- 写入 RAG：`write_file` 或 `edit_file`
- 引用 RAG：在压缩结果中使用 `<REF id="rag#001"/>`

---

## 模块设计

### 目录结构

```
src/context/
├─ compression.ts           # 主压缩逻辑
├─ compression-tools.ts     # 压缩专用工具（read_file, write_file, edit_file）
├─ compression-agent.ts     # Mini-agent 实现（工具调用循环）
├─ index.ts                 # ConversationManager
├─ types.ts                 # 类型定义
└─ strategies/              # 压缩策略（可扩展）
    ├─ summary.ts
    └─ truncate.ts
```

### 核心接口

#### 1. CompressionResult

```typescript
export interface CompressionResult {
  summary: string;           // 压缩后的内容
  removedCount: number;      // 删除的轮数
  success: boolean;          // 是否成功
  error?: string;            // 错误信息
  ragEntriesAdded?: number;  // 新增的 RAG 条目数
}
```

#### 2. CompressionStrategy

```typescript
export interface CompressionStrategy {
  name: string;              // 策略名称：deletion, tagging, supplement
  compress(turns: Turn[]): Promise<string>;
}
```

#### 3. CompressionMetadata

```typescript
export interface CompressionMetadata {
  count: number;             // 压缩次数
  lastCompressedAt: number;  // 上次压缩时间
  lastRatio: number;         // 上次压缩比（压缩后/压缩前）
  totalRemoved: number;      // 累计删除的轮数
}
```

---

## 核心函数

### 1. compress()

**职责**：主压缩入口，协调整个压缩流程。

**签名**：
```typescript
async function compress(
  turns: Turn[], 
  config: AppConfig, 
  sessionId: string
): Promise<CompressionResult>
```

**流程**：
1. 获取当前压缩次数
2. 确定压缩策略（deletion/tagging/supplement）
3. 分段压缩（两段）
4. 合并结果
5. 更新压缩元信息
6. 返回结果

**实现要点**：
- 从 `sessionManager.loadMetadata()` 获取压缩次数
- 调用 `compressSegment()` 分别压缩两段
- 可以并行压缩两段（`Promise.all`）
- 更新 `metadata.compressionCount`

### 2. compressSegment()

**职责**：压缩单个段落。

**签名**：
```typescript
async function compressSegment(
  turns: Turn[],
  strategy: 'deletion' | 'tagging' | 'supplement',
  ragPath: string,
  config: AppConfig
): Promise<string>
```

**流程**：
1. 获取对应的压缩提示词
2. 调用 `compressWithTools()` 执行压缩
3. 返回压缩结果

### 3. compressWithTools()

**职责**：Mini-agent 实现，支持工具调用的压缩循环。

**签名**：
```typescript
async function compressWithTools(
  turns: Turn[],
  prompt: string,
  tools: ToolDefinition[],
  ragPath: string,
  config: AppConfig
): Promise<string>
```

**流程**：
```typescript
1. 构造压缩对话：
   - system: 压缩提示词 + RAG 路径说明
   - user: 待压缩的对话内容

2. 进入循环（最多 10 次迭代）：
   a. 调用模型
   b. 如果没有工具调用 → 返回结果
   c. 如果有工具调用：
      - 执行工具
      - 将工具结果加入对话
      - 继续循环

3. 返回最终压缩内容
```

**实现要点**：
- 使用 `ModelClient` 调用模型
- 使用 `ToolExecutor` 执行工具
- 设置最大迭代次数（防止无限循环）
- 每次迭代都要将 assistant 和 tool 的 turn 加入对话

### 4. getCompressionPrompt()

**职责**：根据策略和 RAG 路径生成完整的压缩提示词。

**签名**：
```typescript
function getCompressionPrompt(
  strategy: 'deletion' | 'tagging' | 'supplement',
  ragPath: string
): string
```

**实现**：
```typescript
const basePrompt = 
  strategy === 'deletion' ? DELETION_COMPRESSION_PROMPT :
  strategy === 'tagging' ? COMPRESSION_PROMPT + COMPRESSION_LABELS :
  COMPRESSION_SUPPLEMENT_PROMPT + COMPRESSION_LABELS;

return `${basePrompt}

## RAG File Location

The RAG file for this session is located at: \`${ragPath}\`

- If the file doesn't exist yet, you can create it using \`write_file\`
- If it exists, you can read it using \`read_file\` and update it using \`edit_file\`
- All large content blocks should be stored in this file
- Use unique IDs like "rag#001", "rag#002", etc.

Remember: This RAG file persists across multiple compressions. You can reference entries created in previous compressions.
`;
```

### 5. createCompressionTools()

**职责**：创建压缩专用的工具集。

**签名**：
```typescript
function createCompressionTools(): ToolDefinition[]
```

**返回**：
```typescript
[
  readFileTool,    // 读取文件（包括 RAG）
  writeFileTool,   // 写入文件（创建或覆盖）
  editFileTool,    // 编辑文件（替换内容）
]
```

**实现要点**：
- 可以复用 `src/tools/builtins/` 中的实现
- 或者创建简化版（只支持基本的读写操作）
- 工具应该限制只能操作 `.cehnzcode/sessions/` 目录（安全性）

---

## 压缩提示词设计

### DELETION_COMPRESSION_PROMPT

**用途**：第一次压缩，删除冗余内容。

**核心要求**：
1. 删除寒暄、重复、中间推导步骤
2. 保留用户决策、错误解决方案、当前任务状态
3. 保持自然语言风格
4. 识别大块内容（代码、数据）→ 存入 RAG → 用 `<REF>` 引用

**提示词结构**：
```
# Context Compression - Deletion Mode

## RAG Management
[说明如何使用 RAG 工具]

## Compression Rules
[说明删除和保留的规则]

## Example Workflow
[展示一个完整的压缩示例]
```

### COMPRESSION_PROMPT + COMPRESSION_LABELS

**用途**：第二次压缩，标签式结构化提取。

**核心要求**：
1. 使用结构化标签（`<PROJECT>`, `<DECISION>`, `<ERROR_LOG>` 等）
2. 提取关键信息到对应标签
3. 代码块用 `<REF>` 引用
4. `<PITFALL>` 标签必须标记为 STICKY

**提示词结构**：
```
# Context Compression - Tagging Mode

## RAG Management
[说明如何使用 RAG 工具]

## Compression Rules
[说明如何使用标签]

## Tag Reference
[列出所有可用标签及其说明]
```

### COMPRESSION_SUPPLEMENT_PROMPT + COMPRESSION_LABELS

**用途**：第三次及以后，增量更新标签。

**核心要求**：
1. 输入包含已有的压缩结果 + 新的对话
2. 新内容补充或细化已有结论 → 合并保留
3. 新内容与已有结论矛盾 → 新内容优先，标记 `updated="true"`
4. 已有内容未被新内容涉及 → 原样保留

**提示词结构**：
```
# Context Compression - Supplement Mode

## Multi-Pass Merge Rules
[说明如何合并已有压缩和新对话]

## RAG Management
[说明如何使用 RAG 工具]

## Tag Reference
[列出所有可用标签及其说明]
```

---

## 集成点

### 1. ConversationManager

**修改点**：
- 构造函数接收 `SessionManager` 实例
- `compress()` 方法调用新的压缩逻辑
- 压缩后保存 turns 到文件

```typescript
export class ConversationManager {
  private turns: Turn[] = [];
  private config: AppConfig;
  private sessionManager: SessionManager;

  constructor(config: AppConfig, sessionManager: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager;
  }

  async compress(): Promise<void> {
    if (this.turns.length <= this.config.compressKeepTurns * 2) return;

    const keepCount = this.config.compressKeepTurns * 2;
    const toCompress = this.turns.slice(0, this.turns.length - keepCount);
    const toKeep = this.turns.slice(this.turns.length - keepCount);

    // 调用新的压缩逻辑
    const result = await compress(
      toCompress,
      this.config,
      this.sessionManager.getSessionId()
    );

    if (result.success) {
      const summaryTurn: Turn = {
        id: randomUUID(),
        role: "system",
        content: `[Compressed conversation summary]\n${result.summary}`,
        tags: ["compressed"],
        tokenCount: estimateTokens(result.summary),
        compressed: true,
        timestamp: Date.now(),
      };

      const systemTurn = this.turns.find((t) => t.role === "system" && !t.compressed);
      this.turns = systemTurn
        ? [systemTurn, summaryTurn, ...toKeep]
        : [summaryTurn, ...toKeep];

      // 保存到文件
      await this.sessionManager.saveTurns(this.turns);

      await eventBus.emit("context:compress", {
        removedCount: result.removedCount,
        summary: result.summary,
      });
    }
  }
}
```

### 2. SessionManager

**新增功能**：
- 管理压缩元信息（`metadata.json`）
- 提供 RAG 文件路径
- 更新压缩次数

```typescript
// 在 SessionManager 中新增方法

async getCompressionMetadata(): Promise<CompressionMetadata> {
  const metadata = await this.loadMetadata();
  return {
    count: metadata.compressionCount || 0,
    lastCompressedAt: metadata.lastCompressedAt || 0,
    lastRatio: 0,  // TODO: 从历史记录中计算
    totalRemoved: 0,  // TODO: 从历史记录中计算
  };
}

async updateCompressionMetadata(update: Partial<CompressionMetadata>): Promise<void> {
  const metadata = await this.loadMetadata();
  if (update.count !== undefined) {
    metadata.compressionCount = update.count;
  }
  if (update.lastCompressedAt !== undefined) {
    metadata.lastCompressedAt = update.lastCompressedAt;
  }
  await this.saveMetadata(metadata);
}
```

### 3. Orchestrator

**修改点**：
- 初始化 `SessionManager`
- 传递给 `ConversationManager`
- 会话结束时保存 turns

```typescript
export class Orchestrator {
  private sessionManager: SessionManager;

  constructor(config: AppConfig, ui: UIAdapter) {
    this.config = config;
    this.ui = ui;
    this.model = new ModelClient(config);
    
    // 初始化 SessionManager
    this.sessionManager = new SessionManager(process.cwd());
    
    // 传递给 ConversationManager
    this.context = new ConversationManager(config, this.sessionManager);
    
    this.executor = new ToolExecutor({
      cwd: process.cwd(),
      config,
      signal: new AbortController().signal,
    });
  }

  async run(): Promise<void> {
    // 初始化会话
    await this.sessionManager.init();
    
    await this.ui.init();
    this.setupSystemPrompt();
    this.running = true;

    while (this.running) {
      // ... 对话循环
    }

    // 保存会话
    await this.sessionManager.saveTurns(this.context.getTurns());
    
    this.ui.dispose();
  }
}
```

---

## 配置项

### AppConfig 新增字段

```typescript
export interface AppConfig {
  // ... 现有字段
  
  // 压缩相关
  contextLimit: number;           // 上下文 token 限制（默认 100000）
  compressKeepTurns: number;      // 保留最新 N 轮（默认 3）
  compressionThreshold: number;   // 压缩阈值（默认 0.85）
  
  // 会话相关
  sessionDir: string;             // 会话目录（默认 .cehnzcode/sessions）
}
```

### 环境变量

```bash
CONTEXT_LIMIT=100000           # 上下文 token 限制
COMPRESS_KEEP_TURNS=3          # 保留最新 N 轮
COMPRESSION_THRESHOLD=0.85     # 压缩阈值
```

---

## 错误处理

### 1. 压缩失败

**场景**：模型调用失败、工具执行失败、token 溢出等。

**处理**：
- 记录错误日志
- 返回 `CompressionResult { success: false, error: "..." }`
- 不修改原有对话历史
- 可以尝试降级策略（如使用简单的截断）

### 2. RAG 文件损坏

**场景**：RAG 文件格式错误、无法读取等。

**处理**：
- 记录警告日志
- 创建新的空 RAG 文件
- 继续压缩流程

### 3. 工具调用超时

**场景**：模型在压缩时调用工具超时。

**处理**：
- 设置工具超时时间（使用 `AbortSignal.timeout()`）
- 超时后返回错误，终止压缩循环
- 使用已有的部分压缩结果

### 4. 无限循环

**场景**：模型不断调用工具，不返回最终结果。

**处理**：
- 设置最大迭代次数（如 15 次）
- 超过限制后强制终止
- 使用最后一次 assistant 的内容作为结果

---

## 性能优化

### 1. 并行压缩

两段内容可以并行压缩：

```typescript
const [firstCompressed, secondCompressed] = await Promise.all([
  compressSegment(firstHalf, strategy, ragPath, config),
  compressSegment(secondHalf, strategy, ragPath, config),
]);
```

**注意**：如果两段都需要写 RAG，可能有并发冲突。解决方案：
- 使用文件锁
- 或者串行压缩（牺牲性能换取安全性）

### 2. 压缩缓存

**场景**：相同的对话内容不需要重复压缩。

**实现**：
- 计算 turns 的哈希值
- 缓存压缩结果
- 下次压缩时先检查缓存

**注意**：缓存需要考虑压缩策略和 RAG 状态的变化。

### 3. 增量压缩

**场景**：只压缩新增的对话，不重新压缩已压缩的内容。

**实现**：
- 记录上次压缩的位置
- 只压缩新增的 turns
- 合并到已有的压缩结果

---

## 测试策略

### 1. 单元测试

**测试对象**：
- `compress()` - 主压缩逻辑
- `compressSegment()` - 单段压缩
- `compressWithTools()` - Mini-agent 循环
- `getCompressionPrompt()` - 提示词生成
- `createCompressionTools()` - 工具创建

**测试用例**：
- 正常压缩流程
- 分段压缩
- 工具调用循环
- 错误处理（模型失败、工具失败、超时）
- 边界条件（空对话、单轮对话、超长对话）

### 2. 集成测试

**测试场景**：
- 完整的对话 → 压缩 → 继续对话流程
- 多次压缩（deletion → tagging → supplement）
- RAG 读写
- 会话保存和加载

### 3. 压缩质量测试

**评估指标**：
- 压缩比（压缩后 token / 压缩前 token）
- 信息保留率（关键信息是否保留）
- 可读性（压缩后内容是否易于理解）

**测试方法**：
- 准备标准测试对话
- 压缩后检查关键信息是否保留
- 人工评估压缩质量

---

## 扩展点

### 1. 自定义压缩策略

**接口**：`CompressionStrategy`

**实现步骤**：
1. 实现 `CompressionStrategy` 接口
2. 注册到 `strategies` Map
3. 在配置中指定策略名称

**示例**：
```typescript
// src/context/strategies/custom.ts
export const customStrategy: CompressionStrategy = {
  name: "custom",
  async compress(turns: Turn[]): Promise<string> {
    // 自定义压缩逻辑
    return "compressed content";
  },
};

// 注册
registerStrategy(customStrategy);
```

### 2. 自定义压缩工具

**场景**：需要额外的工具来辅助压缩（如调用外部 API、数据库查询等）。

**实现步骤**：
1. 实现 `ToolDefinition` 接口
2. 添加到 `createCompressionTools()` 返回的数组中

### 3. 压缩钩子

**场景**：在压缩前后执行自定义逻辑（如记录日志、发送通知等）。

**实现**：
- 使用 `eventBus` 发送压缩事件
- 插件可以监听这些事件

**事件**：
```typescript
eventBus.emit("context:compress:before", { turns, strategy });
eventBus.emit("context:compress:after", { result, ragEntriesAdded });
eventBus.emit("context:compress:error", { error });
```

---

## 实现清单

### Phase 1：基础压缩（必须）

- [ ] `compression.ts` - 主压缩逻辑
  - [ ] `compress()` - 主入口
  - [ ] `compressSegment()` - 单段压缩
  - [ ] `getCompressionPrompt()` - 提示词生成
  
- [ ] `compression-agent.ts` - Mini-agent 实现
  - [ ] `compressWithTools()` - 工具调用循环
  
- [ ] `compression-tools.ts` - 压缩专用工具
  - [ ] `readFileTool` - 读取文件
  - [ ] `writeFileTool` - 写入文件
  - [ ] `editFileTool` - 编辑文件
  
- [ ] 更新 `src/prompts/compression.ts`
  - [ ] 添加 RAG 使用说明到提示词
  
- [ ] 更新 `ConversationManager`
  - [ ] 集成新的压缩逻辑
  - [ ] 调用 `SessionManager`
  
- [ ] 更新 `SessionManager`
  - [ ] 添加压缩元信息管理
  - [ ] 提供 RAG 路径

### Phase 2：优化和测试（重要）

- [ ] 错误处理
  - [ ] 压缩失败降级
  - [ ] RAG 文件损坏恢复
  - [ ] 工具调用超时
  - [ ] 无限循环保护
  
- [ ] 单元测试
  - [ ] 压缩逻辑测试
  - [ ] Mini-agent 测试
  - [ ] 工具测试
  
- [ ] 集成测试
  - [ ] 完整压缩流程测试
  - [ ] 多次压缩测试
  - [ ] RAG 读写测试

### Phase 3：扩展功能（可选）

- [ ] 并行压缩
- [ ] 压缩缓存
- [ ] 增量压缩
- [ ] 自定义压缩策略
- [ ] 压缩钩子

---

## 参考资料

- `src/mcp/INTEGRATION_GUIDE.md` - MCP 集成指南（工具调用模式参考）
- `src/prompts/compression.ts` - 现有压缩提示词(DELETION_COMPRESSION_PROMPT、COMPRESSION_PROMPT、COMPRESSION_SUPPLEMENT_PROMPT都在这个文件中)
- `src/tokens/index.ts` - Token 估算和追踪
- `src/tools/executor.ts` - 工具执行器
- `src/model/index.ts` - 模型客户端

---

## 附录：完整流程图

```
用户输入
  ↓
Orchestrator.handleUserInput()
  ↓
ConversationManager.addTurn()
  ↓
TokenTracker.totalInContext() > threshold?
  ↓ Yes
ConversationManager.compress()
  ↓
compress(turns, config, sessionId)
  ├─ 获取压缩次数 (SessionManager.getCompressionMetadata())
  ├─ 确定策略 (deletion/tagging/supplement)
  ├─ 分段 (firstHalf, secondHalf)
  ├─ 并行压缩
  │   ├─ compressSegment(firstHalf)
  │   │   └─ compressWithTools()
  │   │       ├─ 构造压缩对话
  │   │       ├─ 循环：
  │   │       │   ├─ ModelClient.chat()
  │   │       │   ├─ 有工具调用？
  │   │       │   │   ├─ Yes: ToolExecutor.runAll()
  │   │       │   │   │       ├─ read_file (RAG)
  │   │       │   │   │       ├─ write_file (RAG)
  │   │       │   │   │       └─ edit_file (RAG)
  │   │       │   │   └─ No: 返回结果
  │   │       │   └─ 继续循环
  │   │       └─ 返回压缩内容
  │   └─ compressSegment(secondHalf)
  │       └─ (同上)
  ├─ 合并结果
  ├─ 更新元信息 (SessionManager.updateCompressionMetadata())
  └─ 返回 CompressionResult
  ↓
ConversationManager 更新 turns
  ├─ 保留系统提示词
  ├─ 添加压缩摘要 turn
  └─ 保留最新 N 轮
  ↓
SessionManager.saveTurns()
  ↓
继续对话
```
