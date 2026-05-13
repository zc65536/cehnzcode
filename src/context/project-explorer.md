# Project Explorer — 项目结构自主探索

## 目标

让模型能够根据 prompt 自主判断是否需要查看项目结构，并获取项目的文件和目录信息，帮助模型更好地理解项目上下文。

## 核心功能

1. **获取项目结构树**：递归扫描项目目录，生成树形结构
2. **智能过滤**：自动忽略 node_modules、.git 等无关目录
3. **元数据提取**：提供文件大小、修改时间、文件扩展名等信息
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
  collapseThreshold?: number;  // 目录内文件数超过此值时折叠，默认 10
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
}

interface ProjectSummary {
  totalFiles: number;
  totalDirectories: number;
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

### 4. 折叠逻辑

```typescript
function shouldCollapse(node: FileNode, options: ExploreOptions): boolean {
  // 超过深度限制
  if (node.depth >= options.maxDepth) {
    return true;
  }
  
  // 目录内文件数过多
  if (node.type === "directory" && node.children) {
    const fileCount = countFiles(node.children);
    if (fileCount > options.collapseThreshold) {
      return true;
    }
  }
  
  // 在排除列表中
  if (DEFAULT_EXCLUDE_PATTERNS.some(pattern => 
    minimatch(node.path, pattern)
  )) {
    return true;
  }
  
  return false;
}

function formatCollapsed(node: FileNode): string {
  if (isExcluded(node)) {
    return `${node.name}/  (excluded)`;
  }
  const fileCount = countFiles(node.children);
  return `${node.name}/  (${fileCount} files)`;
}
```

## 工具集成

将 ProjectExplorer 暴露为工具，供模型调用：

```typescript
// src/tools/builtins/project_structure.ts

export const projectStructureTool: ToolDefinition = {
  name: "get_project_structure",
  description: "获取项目的文件和目录结构。当需要了解项目整体布局、查找特定文件位置、或理解项目组织方式时使用此工具。返回简洁的缩进格式，深层或大型目录会折叠显示。",
  parameters: {
    type: "object",
    properties: {
      max_depth: {
        type: "number",
        description: "最大递归深度，默认 3。如果看到折叠的目录需要展开，可以增加此值。",
        default: 3,
      },
      include_hidden: {
        type: "boolean",
        description: "是否包含隐藏文件（以 . 开头），默认 false。",
        default: false,
      },
      collapse_threshold: {
        type: "number",
        description: "目录内文件数超过此值时折叠显示，默认 10。设为 0 表示不折叠。",
        default: 10,
      },
    },
  },
  async execute(args, ctx) {
    const explorer = ctx.projectExplorer;
    const structure = await explorer.getStructure({
      maxDepth: args.max_depth as number,
      includeHidden: args.include_hidden as boolean,
      collapseThreshold: args.collapse_threshold as number,
    });
    
    // 格式化为简洁的缩进文本
    return formatStructureAsText(structure);
  },
};
```

## 输出格式

工具返回的文本格式示例（极简缩进格式）：

```
45 files, 12 directories

src/
  commands/
    builtins/
      clear.ts
      exit.ts
      help.ts
      mcp.ts
    index.ts
    registry.ts
    types.ts
  context/
    strategies/
      summary.ts
      truncate.ts
    compression-agent.ts
    compression-tools.ts
    compression.ts
    index.ts
    types.ts
  model/
    index.ts
    retry.ts
  tools/
    builtins/  (15 items)
    executor.ts
    registry.ts
  types.ts
  index.ts
node_modules/
package.json
tsconfig.json
README.md
```

### 格式规范

1. **开头摘要**：第一行显示文件和目录总数，帮助模型快速了解项目规模
2. **目录标识**：目录名后加 `/`，文件名不加任何后缀
3. **缩进规则**：每层使用 2 个空格缩进
4. **无元数据**：不显示文件大小、修改时间、语言等信息（保持简洁）
5. **折叠显示**：当目录内容过多时，显示 `dirname/ (N items)` 提示模型这里有内容但未展开
6. **深度限制**：达到 maxDepth 的目录只显示 `dirname/` 不展开子项

### 目录显示说明

- `dirname/` - 普通目录（可能达到深度限制或为空）
- `dirname/ (N items)` - 被折叠的目录（子项数量超过阈值）
- `node_modules/` - 被排除的目录（在排除列表中，不扫描内容）

### 折叠策略

满足以下任一条件时折叠目录：
- 目录内**直接子项数量** > collapseThreshold（默认 10）
- 目录在排除列表中（如 node_modules，不扫描内容）

达到 maxDepth 的目录会停止扫描子项，但不标记为折叠。

折叠后显示格式：
- `dirname/ (N items)` - 子项过多被折叠
- `dirname/` - 达到深度限制或为空

模型看到折叠提示后，如果需要查看详细内容，会主动调用工具指定更大的 maxDepth 或 collapseThreshold，或使用其他工具（如 glob、grep）深入探索。

## Prompt 集成

在 system prompt 中添加工具使用原则（不重复描述具体工具）：

```typescript
// src/prompts/index.ts

export const SYSTEM_PROMPT = `
You are a helpful AI coding assistant. You have access to tools that allow you to read files, write files, and execute commands.

When the user asks you to perform a task:
1. Understand what they need
2. Before making changes, gather the necessary context:
   - If the project layout is unfamiliar, start with a shallow listing of the 
      root . Skip dependency and build directories 
      like node_modules, dist, build, .next, target, .git, coverage. Go deeper 
      only into subdirectories that look relevant to the task.
   - Use grep to locate relevant code (function definitions, imports, usages, error messages) rather than reading files blindly
   - Only read_file on files that grep confirms are relevant, or that the task directly references
   - Read the target file before modifying it
   - Do NOT read entire directories or files "just in case" — keep context focused and minimal
   - Call independent tools in parallel when possible (e.g. multiple greps for unrelated symbols)
3. Use the available tools to accomplish the task
4. Report what you did concisely

Strategy: explore structure if unfamiliar → grep to pinpoint → read_file to understand. This keeps context precise and avoids noise.

Be direct and concise in your responses. Focus on solving the problem.

If the context contains any <PENDING> tags, inform the user of the unconfirmed items before responding.

...
`;
```

## 使用场景

1. **用户问"这个项目是做什么的？"**
   - 模型调用 `get_project_structure` 查看整体结构
   - 看到项目有 src/、package.json、README.md
   - 然后读取 README.md 和 package.json 了解详情

2. **用户说"帮我找到处理用户认证的代码"**
   - 模型调用 `get_project_structure` 查看目录
   - 发现 `src/auth/` 目录或看到 `auth.ts` 文件
   - 使用 `read_file` 读取相关文件

3. **用户问"为什么构建失败？"**
   - 模型调用 `get_project_structure` 检查配置文件
   - 看到 tsconfig.json、package.json 等
   - 读取这些文件分析问题

4. **模型看到折叠的目录**
   - 输出显示 `tests/ (15 files)`
   - 如果模型判断需要查看测试文件
   - 调用 `get_project_structure` 增加 `max_depth` 或使用 `glob` 工具查找 `tests/**/*.test.ts`

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
