import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition } from "../types.js";

/**
 * 压缩专用工具集
 * 
 * 这些工具只在压缩过程中使用，用于读写 RAG 文件
 * 为了安全性，限制只能操作 session 目录下的文件
 */

/**
 * 读取文件工具（压缩专用）
 * 主要用于读取 RAG 文件
 */
export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file. Use this to read the RAG file to check existing entries.",
  parameters: {
    type: "object",
    properties: {
      path: { 
        type: "string", 
        description: "File path to read (typically the RAG file path provided in the prompt)" 
      },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    const filePath = path.resolve(ctx.cwd, args.path as string);
    
    // 安全检查：只允许读取 session 目录下的文件
    const sessionDir = path.resolve(ctx.cwd, ctx.config.sessionDir);
    if (!filePath.startsWith(sessionDir)) {
      throw new Error("Access denied: can only read files in session directory");
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      return content;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return "File does not exist yet. You can create it using write_file.";
      }
      throw new Error(`Failed to read file: ${error.message}`);
    }
  },
};

/**
 * 写入文件工具（压缩专用）
 * 用于创建或完全覆盖 RAG 文件
 */
export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file. Creates the file if it doesn't exist. Use this to create or completely replace the RAG file.",
  parameters: {
    type: "object",
    properties: {
      path: { 
        type: "string", 
        description: "File path to write (typically the RAG file path)" 
      },
      content: { 
        type: "string", 
        description: "Content to write (should be valid JSON for RAG files)" 
      },
    },
    required: ["path", "content"],
  },
  async execute(args, ctx) {
    const filePath = path.resolve(ctx.cwd, args.path as string);
    const content = args.content as string;

    // 安全检查：只允许写入 session 目录下的文件
    const sessionDir = path.resolve(ctx.cwd, ctx.config.sessionDir);
    if (!filePath.startsWith(sessionDir)) {
      throw new Error("Access denied: can only write files in session directory");
    }

    // 创建父目录
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // 如果是 JSON 文件，验证格式
    if (filePath.endsWith(".json")) {
      try {
        JSON.parse(content);
      } catch {
        throw new Error("Invalid JSON format. Please provide valid JSON content.");
      }
    }

    // 写入文件
    await fs.writeFile(filePath, content, "utf-8");

    // 验证写入
    const verifiedContent = await fs.readFile(filePath, "utf-8");
    if (verifiedContent !== content) {
      throw new Error("File written but verification failed");
    }

    const bytes = Buffer.byteLength(content, "utf-8");
    return `File written successfully: ${filePath}\nSize: ${bytes} bytes`;
  },
};

/**
 * 编辑文件工具（压缩专用）
 * 用于更新 RAG 文件中的部分内容
 */
export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description: "Edit a file by replacing an exact string match. Use this to update specific entries in the RAG file without rewriting the entire file.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path to edit",
      },
      old_string: {
        type: "string",
        description: "The exact string to find and replace. Must appear exactly once in the file.",
      },
      new_string: {
        type: "string",
        description: "The new string to replace old_string with",
      },
    },
    required: ["path", "old_string", "new_string"],
  },
  async execute(args, ctx) {
    const filePath = path.resolve(ctx.cwd, args.path as string);
    const oldString = args.old_string as string;
    const newString = args.new_string as string;

    // 安全检查：只允许编辑 session 目录下的文件
    const sessionDir = path.resolve(ctx.cwd, ctx.config.sessionDir);
    if (!filePath.startsWith(sessionDir)) {
      throw new Error("Access denied: can only edit files in session directory");
    }

    // 读取文件
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        throw new Error("File not found. Use write_file to create it first.");
      }
      throw new Error(`Failed to read file: ${error.message}`);
    }

    // 检查 old_string 是否存在
    const firstIndex = content.indexOf(oldString);
    if (firstIndex === -1) {
      throw new Error("old_string not found in file. Make sure it matches exactly.");
    }

    // 检查 old_string 是否唯一
    const lastIndex = content.lastIndexOf(oldString);
    if (firstIndex !== lastIndex) {
      const occurrences = content.split(oldString).length - 1;
      throw new Error(
        `old_string appears ${occurrences} times in the file. ` +
        `It must appear exactly once. Add more context to make it unique.`
      );
    }

    // 执行替换
    const newContent = content.replace(oldString, newString);

    // 如果是 JSON 文件，验证格式
    if (filePath.endsWith(".json")) {
      try {
        JSON.parse(newContent);
      } catch {
        throw new Error("Edit would result in invalid JSON. Please check your replacement.");
      }
    }

    // 写回文件
    await fs.writeFile(filePath, newContent, "utf-8");

    // 验证写入
    const verifiedContent = await fs.readFile(filePath, "utf-8");
    if (verifiedContent !== newContent) {
      throw new Error("File written but verification failed");
    }

    return `File edited successfully: ${filePath}\nReplacement completed and verified.`;
  },
};

/**
 * 创建压缩专用工具集
 */
export function createCompressionTools(): ToolDefinition[] {
  return [readFileTool, writeFileTool, editFileTool];
}
