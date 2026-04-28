import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition } from "../../types.js";

/**
 * Write 工具：写入完整文件内容
 * 
 * 特点：
 * 1. 创建新文件或完全覆盖现有文件
 * 2. 自动创建父目录
 * 3. 写入后验证文件是否存在
 * 4. 返回详细的写入信息
 * 
 * 使用场景：
 * - 创建新文件
 * - 完全重写文件内容
 * - 小文件的修改
 */
const writeFile: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file. Creates the file and parent directories if they don't exist.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative file path to write" },
      content: { type: "string", description: "Content to write to the file" },
    },
    required: ["path", "content"],
  },
  async execute(args, ctx) {
    const filePath = path.resolve(ctx.cwd, args.path as string);
    const content = args.content as string;

    // 创建父目录
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    } catch (err) {
      const error = err as Error;
      throw new Error(`Failed to create directory: ${error.message}`);
    }

    // 写入文件
    try {
      await fs.writeFile(filePath, content, "utf-8");
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

    // 检查写入的内容是否与预期一致
    if (verifiedContent !== content) {
      throw new Error(
        `File written but content mismatch detected. ` +
          `Expected ${content.length} bytes, got ${verifiedContent.length} bytes.`
      );
    }

    // 计算统计信息
    const lines = content.split("\n").length;
    const bytes = Buffer.byteLength(content, "utf-8");
    const sizeKB = (bytes / 1024).toFixed(2);

    return (
      `File written successfully: ${filePath}\n` +
      `Content verified: ${lines} line(s), ${bytes} bytes (${sizeKB} KB)\n` +
      `Write operation completed and validated.`
    );
  },
};

export default writeFile;
