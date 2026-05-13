# Context 模块

## 概述

Context 模块负责管理对话上下文、压缩历史记录以及项目结构探索。

## 主要组件

### 1. ConversationManager (`index.ts`)
管理对话历史，包括：
- 添加和获取对话轮次
- 计算 token 使用量
- 触发上下文压缩

### 2. Compression (`compression.ts`)
上下文压缩功能：
- 使用 AI 模型总结历史对话
- 保留最近的对话轮次
- 将旧对话压缩为摘要

### 3. ProjectExplorer (`project-explorer.ts`)
项目结构探索功能：
- 递归扫描项目目录
- 智能过滤无关文件
- 支持文件查找和元数据获取
- 缓存机制提升性能

## ProjectExplorer 使用示例

### 基本使用

```typescript
import { ProjectExplorer, formatStructureAsText } from './project-explorer.js';

// 创建实例
const explorer = new ProjectExplorer('/path/to/project');

// 获取项目结构
const structure = await explorer.getStructure({
  maxDepth: 3,              // 最大深度
  includeHidden: false,     // 不包含隐藏文件
  collapseThreshold: 10,    // 超过 10 个文件的目录会折叠
});

// 格式化输出
console.log(formatStructureAsText(structure));
```

### 查找文件

```typescript
// 查找所有 TypeScript 文件
const tsFiles = await explorer.findFiles('**/*.ts');

// 查找测试文件
const testFiles = await explorer.findFiles('**/*.test.ts');

// 查找特定目录下的文件
const srcFiles = await explorer.findFiles('src/**/*.ts');
```

### 获取文件元数据

```typescript
const metadata = await explorer.getFileMetadata('src/index.ts');
console.log(`Size: ${metadata.size} bytes`);
console.log(`Modified: ${new Date(metadata.modified).toISOString()}`);
console.log(`Extension: ${metadata.extension}`);
```

### 缓存管理

```typescript
// 清除缓存（强制重新扫描）
explorer.clearCache();
```

## 工具集成

ProjectExplorer 已集成为内置工具 `get_project_structure`，AI 模型可以直接调用：

```json
{
  "name": "get_project_structure",
  "arguments": {
    "max_depth": 2,
    "include_hidden": false,
    "collapse_threshold": 10
  }
}
```

## 输出格式

```
77 files, 26 directories

src/
  commands/
    builtins/
      clear.ts
      exit.ts
      help.ts
    index.ts
    registry.ts
  context/
    compression.ts
    index.ts
    project-explorer.ts
  tools/
    builtins/  (8 files)
    executor.ts
package.json
README.md
```

## 自动排除规则

以下目录和文件会被自动排除：
- `node_modules`, `.git`, `dist`, `build`, `coverage`
- `.next`, `.nuxt`, `.cache`
- `.vscode`, `.idea`
- `*.log`, `.DS_Store`
- `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`

## 性能特性

- **并行扫描**: 使用 Promise.all 并行读取目录
- **缓存机制**: 5 分钟 TTL，避免重复扫描
- **深度限制**: 可配置最大深度，避免过深递归
- **智能折叠**: 大型目录自动折叠，保持输出简洁

## 测试

运行测试：
```bash
npx tsx src/context/test-project-explorer.ts
```

测试覆盖：
- ✅ 基本结构扫描
- ✅ 格式化输出
- ✅ 缓存性能
- ✅ 文件查找
- ✅ 元数据获取
- ✅ 隐藏文件处理
- ✅ 深度递归
- ✅ 缓存清除

## 类型定义

详见 `types.ts`：
- `ProjectExplorer`: 主接口
- `ExploreOptions`: 配置选项
- `ProjectStructure`: 项目结构
- `FileNode`: 文件/目录节点
- `FileMetadata`: 文件元数据
- `ProjectSummary`: 项目摘要
