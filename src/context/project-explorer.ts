import * as fs from "fs/promises";
import * as path from "path";
import { minimatch } from "minimatch";
import {
  ProjectExplorer as IProjectExplorer,
  ProjectStructure,
  FileNode,
  FileMetadata,
  ExploreOptions,
  ProjectSummary,
} from "./types.js";

// 默认排除规则
const DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".cache",
  ".vscode",
  ".idea",
  "*.log",
  ".DS_Store",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

interface CacheEntry {
  structure: ProjectStructure;
  timestamp: number;
}

/**
 * ProjectExplorer 实现
 * 提供项目结构扫描、文件查找、元数据获取等功能
 */
export class ProjectExplorer implements IProjectExplorer {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 分钟

  constructor(private rootPath: string) {}

  /**
   * 获取项目结构树
   */
  async getStructure(options?: ExploreOptions): Promise<ProjectStructure> {
    const opts = this.normalizeOptions(options);
    const cacheKey = this.getCacheKey(opts);

    // 检查缓存
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.structure;
    }

    // 扫描项目结构
    const tree = await this.scanDirectory(this.rootPath, "", 0, opts);
    const summary = this.calculateSummary(tree);

    const structure: ProjectStructure = {
      root: this.rootPath,
      tree,
      summary,
      timestamp: Date.now(),
    };

    // 更新缓存
    this.cache.set(cacheKey, {
      structure,
      timestamp: Date.now(),
    });

    return structure;
  }

  /**
   * 查找匹配的文件
   */
  async findFiles(pattern: string): Promise<string[]> {
    const structure = await this.getStructure({ maxDepth: 10 });
    const files: string[] = [];

    const traverse = (node: FileNode) => {
      if (node.type === "file" && minimatch(node.path, pattern)) {
        files.push(node.path);
      }
      if (node.children) {
        node.children.forEach(traverse);
      }
    };

    traverse(structure.tree);
    return files;
  }

  /**
   * 获取文件元数据
   */
  async getFileMetadata(filePath: string): Promise<FileMetadata> {
    const fullPath = path.join(this.rootPath, filePath);
    const stats = await fs.stat(fullPath);
    const ext = path.extname(filePath);

    return {
      size: stats.size,
      modified: stats.mtimeMs,
      extension: ext || undefined,
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 扫描目录
   */
  private async scanDirectory(
    fullPath: string,
    relativePath: string,
    depth: number,
    options: Required<ExploreOptions>
  ): Promise<FileNode> {
    const name = path.basename(fullPath) || path.basename(this.rootPath);
    const node: FileNode = {
      name,
      path: relativePath,
      type: "directory",
      depth,
      children: [],
    };

    // 检查是否应该排除（但不排除根目录）
    if (relativePath && this.shouldExclude(relativePath, options)) {
      return node;
    }

    // 达到最大深度（深度从 0 开始，所以用 > 而不是 >=）
    if (depth > options.maxDepth) {
      return node;
    }

    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      // 并行处理所有条目
      const childPromises = entries.map(async (entry) => {
        const childPath = path.join(fullPath, entry.name);
        const childRelativePath = relativePath
          ? path.join(relativePath, entry.name)
          : entry.name;

        // 检查是否应该排除
        if (this.shouldExclude(childRelativePath, options)) {
          return null;
        }

        // 隐藏文件处理
        if (!options.includeHidden && entry.name.startsWith(".")) {
          return null;
        }

        if (entry.isDirectory()) {
          return this.scanDirectory(
            childPath,
            childRelativePath,
            depth + 1,
            options
          );
        } else if (entry.isFile()) {
          const stats = await fs.stat(childPath);
          const ext = path.extname(entry.name);

          const fileNode: FileNode = {
            name: entry.name,
            path: childRelativePath,
            type: "file",
            depth: depth + 1,
            metadata: {
              size: stats.size,
              modified: stats.mtimeMs,
              extension: ext || undefined,
            },
          };

          return fileNode;
        }

        return null;
      });

      const children = (await Promise.all(childPromises)).filter(
        (child): child is FileNode => child !== null
      );

      // 排序：目录在前，文件在后，同类按名称排序
      children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      node.children = children;

      // 检查是否应该折叠（文件数过多），但不折叠根目录
      // 只标记为折叠，不删除 children，这样 findFiles 等功能仍然可以遍历
      if (depth > 0 && this.shouldCollapseByCount(node, options)) {
        node.collapsed = true;
      }
    } catch (error) {
      // 无法读取目录（权限问题等），返回空目录节点
      console.error(`无法读取目录 ${fullPath}:`, error);
    }

    return node;
  }

  /**
   * 检查是否应该排除
   */
  private shouldExclude(
    relativePath: string,
    options: Required<ExploreOptions>
  ): boolean {
    const allPatterns = [
      ...DEFAULT_EXCLUDE_PATTERNS,
      ...options.excludePatterns,
    ];

    return allPatterns.some((pattern) => {
      // 支持简单的目录名匹配和 glob 模式
      const pathParts = relativePath.split(path.sep);
      return (
        pathParts.some((part) => minimatch(part, pattern)) ||
        minimatch(relativePath, pattern)
      );
    });
  }

  /**
   * 检查是否应该因为文件数过多而折叠
   * 只统计当前目录下的直接子项数量，不递归统计子目录中的文件
   */
  private shouldCollapseByCount(
    node: FileNode,
    options: Required<ExploreOptions>
  ): boolean {
    if (!node.children || options.collapseThreshold === 0) {
      return false;
    }

    // 只统计直接子项的数量
    const directChildCount = node.children.length;
    return directChildCount > options.collapseThreshold;
  }

  /**
   * 统计文件数量
   */
  private countFiles(nodes: FileNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.type === "file") {
        count++;
      } else if (node.children) {
        count += this.countFiles(node.children);
      }
    }
    return count;
  }

  /**
   * 计算项目摘要
   */
  private calculateSummary(tree: FileNode): ProjectSummary {
    let totalFiles = 0;
    let totalDirectories = 0;

    const traverse = (node: FileNode) => {
      if (node.type === "file") {
        totalFiles++;
      } else {
        totalDirectories++;
        if (node.children) {
          node.children.forEach(traverse);
        }
      }
    };

    traverse(tree);

    return {
      totalFiles,
      totalDirectories: totalDirectories - 1, // 减去根目录
    };
  }

  /**
   * 标准化选项
   */
  private normalizeOptions(options?: ExploreOptions): Required<ExploreOptions> {
    return {
      maxDepth: options?.maxDepth ?? 3,
      includeHidden: options?.includeHidden ?? false,
      excludePatterns: options?.excludePatterns ?? [],
      collapseThreshold: options?.collapseThreshold ?? 10,
    };
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(options: Required<ExploreOptions>): string {
    return JSON.stringify(options);
  }
}

/**
 * 格式化项目结构为文本
 */
export function formatStructureAsText(structure: ProjectStructure): string {
  const lines: string[] = [];

  // 添加摘要
  lines.push(
    `${structure.summary.totalFiles} files, ${structure.summary.totalDirectories} directories\n`
  );

  // 递归格式化树
  const formatNode = (node: FileNode, indent: string = "") => {
    if (node.path === "") {
      // 根节点，不显示名称
      if (node.children) {
        node.children.forEach((child) => formatNode(child, indent));
      }
      return;
    }

    if (node.type === "directory") {
      if (node.collapsed && node.children) {
        // 被折叠的目录，显示直接子项数量
        const childCount = node.children.length;
        lines.push(`${indent}${node.name}/  (${childCount} items)`);
      } else if (node.children && node.children.length > 0) {
        // 正常目录，有子项
        lines.push(`${indent}${node.name}/`);
        node.children.forEach((child) => formatNode(child, indent + "  "));
      } else if (!node.children || node.children.length === 0) {
        // 空目录（可能是达到深度限制，或真的为空，或被排除）
        // 只显示目录名，不加任何标记
        lines.push(`${indent}${node.name}/`);
      }
    } else {
      // 文件
      lines.push(`${indent}${node.name}`);
    }
  };

  formatNode(structure.tree);

  return lines.join("\n");
}
