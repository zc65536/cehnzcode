export interface CompressionResult {
  summary: string;
  removedCount: number;
  success: boolean;
  error?: string;
  ragEntriesAdded?: number;
}

export interface CompressionMetadata {
  count: number;
  lastCompressedAt: number;
  lastRatio: number;
  totalRemoved: number;
}

export interface RAGEntry {
  type: "code" | "data" | "error" | "decision";
  content: string;
  file?: string;
  tags?: string[];
  timestamp: number;
  confidence: "high" | "medium" | "stale";
}

export interface RAGFile {
  entries: Record<string, RAGEntry>;
  metadata: {
    createdAt: number;
    lastUpdatedAt: number;
    sessionId: string;
  };
}

// Project Explorer types
export interface ProjectExplorer {
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

export interface ExploreOptions {
  maxDepth?: number;           // 最大递归深度，默认 3
  includeHidden?: boolean;     // 是否包含隐藏文件，默认 false
  excludePatterns?: string[];  // 额外的排除模式
  collapseThreshold?: number;  // 目录内直接子项数超过此值时折叠，默认 10
}

export interface ProjectStructure {
  root: string;                // 项目根目录
  tree: FileNode;              // 文件树
  summary: ProjectSummary;     // 项目摘要
  timestamp: number;           // 扫描时间戳
}

export interface FileNode {
  name: string;
  path: string;                // 相对于项目根目录的路径
  type: "file" | "directory";
  depth: number;               // 当前深度
  children?: FileNode[];       // 目录才有
  metadata?: FileMetadata;     // 可选的元数据
  collapsed?: boolean;         // 是否应该折叠显示
}

export interface FileMetadata {
  size: number;                // 字节数
  modified: number;            // 修改时间戳
  extension?: string;          // 文件扩展名
  language?: string;           // 编程语言（根据扩展名推断）
}

export interface ProjectSummary {
  totalFiles: number;
  totalDirectories: number;
}
