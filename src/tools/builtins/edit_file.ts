import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition } from "../../types.js";

/**
 * Edit 工具：对文件进行精确的字符串替换
 * 
 * 优势：
 * 1. 高效：只需传输要替换的部分，而不是整个文件内容
 * 2. 安全：如果 old_string 不存在或出现多次，操作会失败，避免误改
 * 3. 精确：基于字符串匹配，确保替换的位置完全正确
 * 
 * 使用场景：
 * - 修改大文件中的少量内容
 * - 需要确保替换位置准确的场景
 * - 避免传输大量重复数据
 */
const editFile: ToolDefinition = {
  name: "edit_file",
  description:
    "Edit a file by replacing an exact string match. More efficient than write_file for large files. " +
    "Fails safely if old_string is not found or appears multiple times, preventing accidental edits.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative file path to edit",
      },
      old_string: {
        type: "string",
        description:
          "The exact string to find and replace. Must appear exactly once in the file. " +
          "Include enough context (surrounding lines) to ensure uniqueness.",
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

    // 读取文件内容
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        throw new Error(`File not found: ${filePath}`);
      }
      throw new Error(`Failed to read file: ${error.message}`);
    }

    // 检查 old_string 是否存在
    const firstIndex = content.indexOf(oldString);
    if (firstIndex === -1) {
      throw new Error(
        `old_string not found in file. Make sure the string matches exactly, including whitespace and line breaks.`
      );
    }

    // 检查 old_string 是否唯一（安全机制）
    const lastIndex = content.lastIndexOf(oldString);
    if (firstIndex !== lastIndex) {
      // 计算出现次数
      const occurrences = content.split(oldString).length - 1;
      throw new Error(
        `old_string appears ${occurrences} times in the file. ` +
          `It must appear exactly once to ensure safe replacement. ` +
          `Add more context to old_string to make it unique.`
      );
    }

    // 执行替换
    const newContent = content.replace(oldString, newString);

    // 写回文件
    try {
      await fs.writeFile(filePath, newContent, "utf-8");
    } catch (err) {
      const error = err as Error;
      throw new Error(`Failed to write file: ${error.message}`);
    }

    // 验证写入是否成功：读取文件并检查内容
    let verifiedContent: string;
    try {
      verifiedContent = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      const error = err as Error;
      throw new Error(`File written but verification failed: ${error.message}`);
    }

    // 检查写入的内容是否与预期一致（字节级别比对）
    if (verifiedContent !== newContent) {
      throw new Error(
        `File written but content mismatch detected. ` +
          `Expected ${newContent.length} bytes, got ${verifiedContent.length} bytes.`
      );
    }

    // 计算效率统计
    const oldLines = oldString.split("\n").length;
    const newLines = newString.split("\n").length;
    const totalLines = content.split("\n").length;
    const efficiency = ((1 - (oldLines + newLines) / totalLines) * 100).toFixed(1);

    return (
      `File edited successfully: ${filePath}\n` +
      `Replaced ${oldLines} line(s) with ${newLines} line(s)\n` +
      `Content verified: file matches expected output\n` +
      `Efficiency: transmitted ${oldLines + newLines}/${totalLines} lines (saved ${efficiency}% bandwidth)`
    );
  },
};

export default editFile;
