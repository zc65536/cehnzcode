# Knowledge System — 错题本系统

## 目标

维护两个错题本，记录项目开发过程中遇到的错误和解决方案：
1. **全局错题本**：与用户绑定，跨项目共享，记录通用错误
2. **项目错题本**：与项目绑定，记录项目特定错误

模型在对话时自动检索相关错误记录，避免重复犯错。

## 核心功能

1. **错误记录**：自动或手动记录错误及解决方案
2. **智能检索**：根据上下文检索相关错误
3. **自动注入**：将相关错误注入到 prompt 中
4. **分类管理**：按类别、标签组织错误
5. **跨项目共享**：全局错误在所有项目中可用

## 接口设计

```typescript
// src/knowledge/types.ts

interface KnowledgeManager {
  /**
   * 记录错误
   * @param error 错误记录
   * @param scope 作用域（全局或项目）
   */
  recordError(error: ErrorRecordInput, scope: ErrorScope): Promise<ErrorRecord>;
  
  /**
   * 搜索相关错误
   * @param query 搜索查询（关键词、错误信息等）
   * @param options 搜索选项
   * @returns 相关错误列表
   */
  searchErrors(query: string, options?: SearchOptions): Promise<ErrorRecord[]>;
  
  /**
   * 获取所有错误（用于注入 prompt）
   * @param scope 作用域
   * @param limit 最大数量
   * @returns 错误列表
   */
  getAllErrors(scope?: ErrorScope, limit?: number): Promise<ErrorRecord[]>;
  
  /**
   * 根据上下文获取相关错误
   * @param context 当前上下文（用户输入、最近的错误等）
   * @returns 相关错误列表
   */
  getRelevantErrors(context: ErrorContext): Promise<ErrorRecord[]>;
  
  /**
   * 更新错误记录
   * @param id 错误 ID
   * @param updates 更新内容
   * @param scope 作用域
   */
  updateError(id: string, updates: Partial<ErrorRecordInput>, scope: ErrorScope): Promise<void>;
  
  /**
   * 删除错误记录
   * @param id 错误 ID
   * @param scope 作用域
   */
  removeError(id: string, scope: ErrorScope): Promise<void>;
  
  /**
   * 导出错误记录（用于分享）
   * @param scope 作用域
   * @param format 导出格式
   */
  exportErrors(scope: ErrorScope, format: "json" | "markdown"): Promise<string>;
  
  /**
   * 导入错误记录
   * @param data 导入数据
   * @param scope 作用域
   */
  importErrors(data: string, scope: ErrorScope): Promise<number>;
}

type ErrorScope = "global" | "project" | "both";

interface ErrorRecord {
  id: string;
  timestamp: number;
  category: ErrorCategory;
  error: string;              // 错误信息
  context: string;            // 发生时的上下文
  solution: string;           // 解决方案
  tags: string[];             // 标签（便于检索）
  frequency: number;          // 遇到次数
  lastSeen: number;           // 最后一次遇到的时间
  projectId?: string;         // 项目 ID（项目级别错误才有）
  relatedFiles?: string[];    // 相关文件
  metadata: ErrorMetadata;
}

interface ErrorRecordInput {
  category: ErrorCategory;
  error: string;
  context: string;
  solution: string;
  tags?: string[];
  relatedFiles?: string[];
}

type ErrorCategory = 
  | "typescript"      // TypeScript 类型错误
  | "build"           // 构建错误
  | "runtime"         // 运行时错误
  | "dependency"      // 依赖问题
  | "configuration"   // 配置错误
  | "git"             // Git 相关
  | "test"            // 测试错误
  | "lint"            // 代码规范
  | "security"        // 安全问题
  | "performance"     // 性能问题
  | "other";          // 其他

interface ErrorMetadata {
  severity: "low" | "medium" | "high" | "critical";
  autoRecorded: boolean;      // 是否自动记录
  verified: boolean;          // 解决方案是否已验证
  source: string;             // 来源（如 "compiler", "runtime", "user"）
}

interface SearchOptions {
  scope?: ErrorScope;
  category?: ErrorCategory;
  tags?: string[];
  limit?: number;
  sortBy?: "timestamp" | "frequency" | "relevance";
}

interface ErrorContext {
  userInput: string;
  recentErrors?: string[];    // 最近遇到的错误
  currentFiles?: string[];    // 当前操作的文件
  projectType?: string;       // 项目类型（如 "typescript", "react"）
}
```

## 存储结构

### 全局错题本

位置：`~/.cehnzcode/knowledge/errors.json`

```json
{
  "version": "1.0",
  "userId": "user_12345",
  "errors": [
    {
      "id": "err_global_001",
      "timestamp": 1715270400000,
      "category": "typescript",
      "error": "Cannot find module 'xxx' or its corresponding type declarations",
      "context": "尝试导入一个新安装的 npm 包",
      "solution": "需要安装类型定义: npm install --save-dev @types/xxx",
      "tags": ["typescript", "types", "npm"],
      "frequency": 5,
      "lastSeen": 1715270400000,
      "metadata": {
        "severity": "medium",
        "autoRecorded": true,
        "verified": true,
        "source": "compiler"
      }
    },
    {
      "id": "err_global_002",
      "timestamp": 1715270500000,
      "category": "build",
      "error": "Module not found: Error: Can't resolve 'fs' in ...",
      "context": "在浏览器环境中使用了 Node.js 内置模块",
      "solution": "使用 webpack 的 resolve.fallback 配置或使用浏览器兼容的替代库",
      "tags": ["webpack", "browser", "node"],
      "frequency": 3,
      "lastSeen": 1715270500000,
      "metadata": {
        "severity": "high",
        "autoRecorded": false,
        "verified": true,
        "source": "user"
      }
    }
  ],
  "statistics": {
    "totalErrors": 2,
    "byCategory": {
      "typescript": 1,
      "build": 1
    }
  }
}
```

### 项目错题本

位置：`.cehnzcode/knowledge/errors.json`

```json
{
  "version": "1.0",
  "projectId": "my-project",
  "projectName": "My Awesome Project",
  "errors": [
    {
      "id": "err_project_001",
      "timestamp": 1715270600000,
      "category": "configuration",
      "error": "Database connection failed: ECONNREFUSED",
      "context": "启动开发服务器时数据库连接失败",
      "solution": "确保 .env 文件中的 DATABASE_URL 正确，并且数据库服务已启动",
      "tags": ["database", "env", "config"],
      "frequency": 2,
      "lastSeen": 1715270600000,
      "projectId": "my-project",
      "relatedFiles": [".env", "src/config/database.ts"],
      "metadata": {
        "severity": "high",
        "autoRecorded": true,
        "verified": true,
        "source": "runtime"
      }
    }
  ],
  "statistics": {
    "totalErrors": 1,
    "byCategory": {
      "configuration": 1
    }
  }
}
```

## 工作流程

### 1. 自动记录错误

当检测到错误时（如工具执行失败、编译错误等），自动记录：

```typescript
// 在 orchestrator 或 tool executor 中
try {
  const result = await executeTool(toolCall);
} catch (error) {
  // 检查是否是可记录的错误
  if (isRecordableError(error)) {
    await knowledgeManager.recordError({
      category: inferCategory(error),
      error: error.message,
      context: getCurrentContext(),
      solution: "", // 初始为空，后续补充
      tags: extractTags(error),
    }, "project");
  }
  throw error;
}
```

### 2. 检索相关错误

在每次对话开始时，检索相关错误并注入 prompt：

```typescript
// 在 orchestrator 主循环中
async function handleUserInput(input: string) {
  // 检索相关错误
  const relevantErrors = await knowledgeManager.getRelevantErrors({
    userInput: input,
    currentFiles: getCurrentFiles(),
    projectType: detectProjectType(),
  });
  
  // 注入到 system prompt
  if (relevantErrors.length > 0) {
    const errorContext = formatErrorsForPrompt(relevantErrors);
    systemPrompt += `\n\n## 历史错误记录\n${errorContext}`;
  }
  
  // 继续正常流程
  // ...
}
```

### 3. 手动记录错误

用户可以通过命令手动记录：

```bash
/error record "错误信息" --solution "解决方案" --category typescript --global
```

### 4. 查询错误

```bash
/error search "typescript module"
/error list --category build
/error show err_global_001
```

## Prompt 集成

### 错误上下文格式

```typescript
function formatErrorsForPrompt(errors: ErrorRecord[]): string {
  return errors.map(err => `
### ${err.category.toUpperCase()}: ${err.error}

**上下文**: ${err.context}
**解决方案**: ${err.solution}
**遇到次数**: ${err.frequency}
**相关文件**: ${err.relatedFiles?.join(", ") || "无"}
**标签**: ${err.tags.join(", ")}
  `.trim()).join("\n\n---\n\n");
}
```

### System Prompt 增强

```typescript
export const SYSTEM_PROMPT = `
你是一个智能代码助手...

## 历史错误记录

以下是在此项目或其他项目中遇到过的错误及解决方案。在处理类似问题时，请参考这些记录避免重复犯错：

${errorContext}

当你遇到新的错误时，如果找到了解决方案，请使用 record_error 工具记录下来。
`;
```

## 工具集成

```typescript
// src/tools/builtins/knowledge.ts

export const recordErrorTool: ToolDefinition = {
  name: "record_error",
  description: "记录错误及其解决方案到错题本，避免将来重复犯错",
  parameters: {
    type: "object",
    properties: {
      error: {
        type: "string",
        description: "错误信息",
      },
      solution: {
        type: "string",
        description: "解决方案",
      },
      category: {
        type: "string",
        enum: ["typescript", "build", "runtime", "dependency", "configuration", "git", "test", "lint", "security", "performance", "other"],
        description: "错误类别",
      },
      scope: {
        type: "string",
        enum: ["global", "project"],
        description: "作用域：global 表示通用错误，project 表示项目特定错误",
        default: "project",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "标签（可选）",
      },
    },
    required: ["error", "solution", "category"],
  },
  async execute(args, ctx) {
    const record = await ctx.knowledgeManager.recordError({
      category: args.category as ErrorCategory,
      error: args.error as string,
      context: ctx.getCurrentContext(),
      solution: args.solution as string,
      tags: args.tags as string[] || [],
    }, args.scope as ErrorScope || "project");
    
    return `已记录错误 ${record.id} 到${args.scope === "global" ? "全局" : "项目"}错题本`;
  },
};

export const searchErrorsTool: ToolDefinition = {
  name: "search_errors",
  description: "搜索历史错误记录，查找类似问题的解决方案",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词",
      },
      category: {
        type: "string",
        enum: ["typescript", "build", "runtime", "dependency", "configuration", "git", "test", "lint", "security", "performance", "other"],
        description: "错误类别（可选）",
      },
      scope: {
        type: "string",
        enum: ["global", "project", "both"],
        description: "搜索范围",
        default: "both",
      },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    const errors = await ctx.knowledgeManager.searchErrors(
      args.query as string,
      {
        scope: args.scope as ErrorScope || "both",
        category: args.category as ErrorCategory,
        limit: 5,
      }
    );
    
    if (errors.length === 0) {
      return "未找到相关错误记录";
    }
    
    return formatErrorsForDisplay(errors);
  },
};
```

## 命令集成

```typescript
// src/commands/builtins/error.ts

export const errorCommand: CommandDefinition = {
  name: "error",
  description: "管理错题本",
  async execute(args, ctx) {
    const [subcommand, ...rest] = args.split(" ");
    
    switch (subcommand) {
      case "list":
        return await listErrors(rest, ctx);
      case "search":
        return await searchErrors(rest, ctx);
      case "show":
        return await showError(rest, ctx);
      case "record":
        return await recordError(rest, ctx);
      case "remove":
        return await removeError(rest, ctx);
      case "export":
        return await exportErrors(rest, ctx);
      case "import":
        return await importErrors(rest, ctx);
      default:
        return "用法: /error <list|search|show|record|remove|export|import>";
    }
  },
};
```

### 命令示例

```bash
# 列出所有错误
/error list

# 列出特定类别的错误
/error list --category typescript

# 搜索错误
/error search "module not found"

# 查看错误详情
/error show err_global_001

# 手动记录错误
/error record

# 删除错误
/error remove err_project_001

# 导出错误（用于分享）
/error export --scope global --format markdown

# 导入错误
/error import errors.json --scope project
```

## 智能检索算法

```typescript
async function getRelevantErrors(context: ErrorContext): Promise<ErrorRecord[]> {
  const allErrors = await this.getAllErrors("both");
  
  // 1. 关键词匹配
  const keywords = extractKeywords(context.userInput);
  const keywordMatches = allErrors.filter(err => 
    keywords.some(kw => 
      err.error.toLowerCase().includes(kw) ||
      err.tags.some(tag => tag.includes(kw))
    )
  );
  
  // 2. 文件相关性
  const fileMatches = allErrors.filter(err =>
    err.relatedFiles?.some(file => 
      context.currentFiles?.includes(file)
    )
  );
  
  // 3. 最近错误
  const recentMatches = allErrors.filter(err =>
    context.recentErrors?.some(recent => 
      similarity(err.error, recent) > 0.7
    )
  );
  
  // 4. 合并并排序
  const matches = [...new Set([
    ...keywordMatches,
    ...fileMatches,
    ...recentMatches,
  ])];
  
  // 按相关性排序
  matches.sort((a, b) => {
    const scoreA = calculateRelevanceScore(a, context);
    const scoreB = calculateRelevanceScore(b, context);
    return scoreB - scoreA;
  });
  
  // 返回前 5 个最相关的
  return matches.slice(0, 5);
}

function calculateRelevanceScore(error: ErrorRecord, context: ErrorContext): number {
  let score = 0;
  
  // 关键词匹配
  const keywords = extractKeywords(context.userInput);
  score += keywords.filter(kw => 
    error.error.toLowerCase().includes(kw)
  ).length * 10;
  
  // 标签匹配
  score += keywords.filter(kw =>
    error.tags.some(tag => tag.includes(kw))
  ).length * 5;
  
  // 文件相关性
  if (error.relatedFiles?.some(file => 
    context.currentFiles?.includes(file)
  )) {
    score += 20;
  }
  
  // 频率加权
  score += Math.log(error.frequency + 1) * 3;
  
  // 时间衰减（越新越重要）
  const daysSinceLastSeen = (Date.now() - error.lastSeen) / (1000 * 60 * 60 * 24);
  score += Math.max(0, 10 - daysSinceLastSeen);
  
  return score;
}
```

## 实现文件

```
src/knowledge/
  ├── plan.md                    # 本方案文档
  ├── types.ts                   # 类型定义
  ├── index.ts                   # KnowledgeManager 主实现
  ├── storage.ts                 # 存储层（读写 JSON 文件）
  ├── search.ts                  # 搜索和检索算法
  └── prompts.ts                 # 错误上下文格式化

src/tools/builtins/
  └── knowledge.ts               # record_error, search_errors 工具

src/commands/builtins/
  └── error.ts                   # /error 命令
```

## 测试计划

```typescript
// src/knowledge/test-knowledge.ts

async function testKnowledge() {
  const km = new KnowledgeManager(config);
  
  // 测试记录错误
  const record = await km.recordError({
    category: "typescript",
    error: "Cannot find module 'xxx'",
    context: "导入新包时",
    solution: "npm install @types/xxx",
    tags: ["typescript", "types"],
  }, "global");
  console.log("记录错误:", record.id);
  
  // 测试搜索
  const results = await km.searchErrors("module", {
    scope: "both",
    limit: 5,
  });
  console.log("搜索结果:", results.length);
  
  // 测试相关性检索
  const relevant = await km.getRelevantErrors({
    userInput: "为什么找不到模块？",
    currentFiles: ["src/index.ts"],
  });
  console.log("相关错误:", relevant.length);
  
  // 测试导出
  const exported = await km.exportErrors("global", "markdown");
  console.log("导出内容长度:", exported.length);
}
```

## 未来扩展

1. **AI 增强**：使用 embedding 进行语义搜索
2. **自动分类**：使用模型自动分类错误
3. **解决方案推荐**：根据错误自动推荐解决方案
4. **社区分享**：将错题本分享到社区，互相学习
5. **统计分析**：分析最常见的错误类型，生成报告
6. **自动修复**：对于已知错误，尝试自动应用解决方案
