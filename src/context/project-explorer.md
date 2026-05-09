# Project Explorer — 项目结构自主探索

## 目标

让模型能够根据 prompt 自主判断是否需要查看项目结构，并获取项目的文件和目录信息，帮助模型更好地理解项目上下文。

## 核心功能

1. **获取项目结构树**：递归扫描项目目录，生成树形结构
2. **智能过滤**：自动忽略 node_modules、.git 等无关目录
3. **元数据提取**：提供文件大小、修改时间、文件类型等信息
4. **缓存机制**：避免重复扫描，提升性能

## 接口设计

```typescript
// src/context/types.ts 中添加

interface ProjectExplorer {
  /**
   * 获取项目结构树
   * @param options 扫描选项
   * @returns 项目结构
   */
  getStructure(options?: ExploreOptions): Promise<ProjectStructure>;
  
  /**
   * 查找匹配的文件
   * @param pattern glob 模式
   * @returns 文件路径列表
   */
  findFiles(pattern: string): Promise<string[]>;
  
  /**
   * 获取文件元数据
   * @param path 文件路径
   * @returns 文件元数据
   */
  getFileMetadata(path: string): Promise<FileMetadata>;
  
  /**
   * 清除缓存
   */
  clearCache(): void;
}

interface ExploreOptions {
  maxDepth?: number;           // 最大递归深度，默认 3
  includeHidden?: boolean;     // 是否包含隐藏文件，默认 false
  excludePatterns?: string[];  // 额外的排除模式
  includeMetadata?: boolean;   // 是否包含文件元数据，默认 false
}

interface ProjectStructure {
  root: string;                // 项目根目录
  tree: FileNode;              // 文件树
  summary: ProjectSummary;     // 项目摘要
  timestamp: number;           // 扫描时间戳
}

interface FileNode {
  name: string;
  path: string;                // 相对于项目根目录的路径
  type: "file" | "directory";
  children?: FileNode[];       // 目录才有
  metadata?: FileMetadata;     // 可选的元数据
}

interface FileMetadata {
  size: number;                // 字节数
  modified: number;            // 修改时间戳
  extension?: string;          // 文件扩展名
  language?: string;           // 编程语言（根据扩展名推断）
}

interface ProjectSummary {
  totalFiles: number;
  totalDirectories: number;
  filesByLanguage: Record<string, number>;  // 如 { "typescript": 45, "json": 3 }
  largestFiles: Array<{ path: string; size: number }>;  // 前 5 个最大文件
}
```

## 实现细节

### 1. 默认排除规则

```typescript
const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.vscode',
  '.idea',
  '*.log',
  '.DS_Store',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];
```

### 2. 缓存策略

- 使用内存缓存，缓存时间 5 分钟
- 当检测到文件系统变化时（通过 fs.watch），自动失效缓存
- 提供手动清除缓存的方法

### 3. 性能优化

- 使用 `fs.promises` 异步 API
- 并行读取目录（Promise.all）
- 限制最大深度，避免过深递归
- 大文件（>1MB）不读取内容，只记录元数据

### 4. 语言识别

根据文件扩展名映射到语言：

```typescript
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  // ... 更多映射
};
```

## 工具集成

将 ProjectExplorer 暴露为工具，供模型调用：

```typescript
// src/tools/builtins/project_structure.ts

export const projectStructureTool: ToolDefinition = {
  name: "get_project_structure",
  description: "获取项目的文件和目录结构。当需要了解项目整体布局、查找特定文件位置、或理解项目组织方式时使用此工具。",
  parameters: {
    type: "object",
    properties: {
      max_depth: {
        type: "number",
        description: "最大递归深度，默认 3。更大的值会返回更详细的结构，但可能较慢。",
        default: 3,
      },
      include_metadata: {
        type: "boolean",
        description: "是否包含文件元数据（大小、修改时间等），默认 false。",
        default: false,
      },
    },
  },
  async execute(args, ctx) {
    const explorer = ctx.projectExplorer;
    const structure = await explorer.getStructure({
      maxDepth: args.max_depth as number,
      includeMetadata: args.include_metadata as boolean,
    });
    
    // 格式化为易读的文本
    return formatStructureAsText(structure);
  },
};
```

## 输出格式

工具返回的文本格式示例：

```
项目结构 (扫描深度: 3)
根目录: /path/to/project

📁 src/
  📁 context/
    📄 index.ts (2.3 KB)
    📄 compression.ts (5.1 KB)
    📄 types.ts (1.2 KB)
  📁 model/
    📄 index.ts (8.4 KB)
    📄 retry.ts (3.2 KB)
  📁 tools/
    📁 builtins/
      📄 read_file.ts (4.5 KB)
      📄 write_file.ts (3.8 KB)
    📄 registry.ts (6.2 KB)
📄 package.json (1.5 KB)
📄 tsconfig.json (0.8 KB)

项目摘要:
- 总文件数: 45
- 总目录数: 12
- 语言分布: TypeScript (42), JSON (3)
- 最大文件: src/model/index.ts (8.4 KB)
```

## Prompt 集成

在 system prompt 中添加说明：

```typescript
// src/prompts/index.ts

export const SYSTEM_PROMPT = `
你是一个智能代码助手...

## 可用工具

### 项目探索
- **get_project_structure**: 获取项目的文件和目录结构
  - 当用户询问"项目里有什么文件"、"代码在哪里"时，主动使用此工具
  - 当需要理解项目整体架构时使用
  - 当不确定某个功能在哪个文件中时使用

...
`;
```

## 使用场景

1. **用户问"这个项目是做什么的？"**
   - 模型调用 `get_project_structure` 查看整体结构
   - 然后读取 README.md 和 package.json
   - 综合给出项目说明

2. **用户说"帮我找到处理用户认证的代码"**
   - 模型调用 `get_project_structure` 查看目录
   - 发现 `src/auth/` 目录
   - 使用 `read_file` 读取相关文件

3. **用户问"为什么构建失败？"**
   - 模型调用 `get_project_structure` 检查是否有配置文件
   - 读取 tsconfig.json、package.json 等
   - 分析可能的问题

## 实现文件

```
src/context/
  ├── project-explorer.ts      # ProjectExplorer 实现
  ├── project-explorer.md       # 本方案文档
  └── types.ts                  # 类型定义（添加相关接口）

src/tools/builtins/
  └── project_structure.ts      # 工具定义
```

## 测试计划

```typescript
// src/context/test-project-explorer.ts

async function testProjectExplorer() {
  const explorer = new ProjectExplorer('/path/to/project');
  
  // 测试基本结构获取
  const structure = await explorer.getStructure({ maxDepth: 2 });
  console.log('文件数:', structure.summary.totalFiles);
  
  // 测试文件查找
  const tsFiles = await explorer.findFiles('**/*.ts');
  console.log('TypeScript 文件:', tsFiles.length);
  
  // 测试元数据
  const metadata = await explorer.getFileMetadata('src/index.ts');
  console.log('文件大小:', metadata.size);
  
  // 测试缓存
  const start = Date.now();
  await explorer.getStructure();
  console.log('首次扫描耗时:', Date.now() - start, 'ms');
  
  const start2 = Date.now();
  await explorer.getStructure();
  console.log('缓存命中耗时:', Date.now() - start2, 'ms');
}
```

## 未来扩展

1. **Git 集成**：显示文件的 Git 状态（modified、untracked 等）
2. **依赖分析**：分析文件之间的 import 关系
3. **热点文件**：根据修改频率标记常改动的文件
4. **智能推荐**：根据用户问题，推荐可能相关的文件
