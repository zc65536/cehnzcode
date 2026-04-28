import * as fs from "node:fs/promises";
import * as path from "node:path";
import writeFile from "./write_file.js";
import editFile from "./edit_file.js";
import type { ToolContext } from "../../types.js";

console.log("=== Testing Write and Edit Verification ===\n");

const ctx: ToolContext = {
  cwd: process.cwd(),
  config: {} as any,
  signal: new AbortController().signal,
};

const testFilePath = path.join(process.cwd(), "test-verification.txt");

async function runTests() {
  try {
    // 测试 1: write_file 成功写入并验证
    console.log("Test 1: write_file with verification");
    const content1 = "Line 1\nLine 2\nLine 3\n";
    const result1 = await writeFile.execute(
      {
        path: testFilePath,
        content: content1,
      },
      ctx
    );
    console.log(result1);
    console.log("✓ Write verified successfully\n");

    // 测试 2: edit_file 成功编辑并验证
    console.log("Test 2: edit_file with verification");
    const result2 = await editFile.execute(
      {
        path: testFilePath,
        old_string: "Line 2",
        new_string: "Line 2 Modified",
      },
      ctx
    );
    console.log(result2);
    console.log("✓ Edit verified successfully\n");

    // 测试 3: write_file 到不存在的目录（应该自动创建）
    console.log("Test 3: write_file to non-existent directory");
    const deepPath = path.join(process.cwd(), "test-dir", "subdir", "file.txt");
    const result3 = await writeFile.execute(
      {
        path: deepPath,
        content: "Test content in deep directory",
      },
      ctx
    );
    console.log(result3);
    console.log("✓ Directory created and file written\n");

    // 测试 4: 写入大文件并验证
    console.log("Test 4: write_file with large content");
    const largeContent = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`).join("\n");
    const result4 = await writeFile.execute(
      {
        path: testFilePath,
        content: largeContent,
      },
      ctx
    );
    console.log(result4);
    console.log("✓ Large file written and verified\n");

    // 测试 5: edit_file 验证替换确实生效
    console.log("Test 5: edit_file verification of replacement");
    const result5 = await editFile.execute(
      {
        path: testFilePath,
        old_string: "Line 500",
        new_string: "Line 500 EDITED",
      },
      ctx
    );
    console.log(result5);
    console.log("✓ Replacement verified\n");

    // 清理测试文件
    await fs.unlink(testFilePath);
    await fs.rm(path.join(process.cwd(), "test-dir"), { recursive: true, force: true });
    console.log("✓ Test files cleaned up");

    console.log("\n=== All verification tests passed ===");
  } catch (err) {
    console.error("Test failed:", err);
    // 清理
    try {
      await fs.unlink(testFilePath);
      await fs.rm(path.join(process.cwd(), "test-dir"), { recursive: true, force: true });
    } catch {}
    process.exit(1);
  }
}

runTests();
