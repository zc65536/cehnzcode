import * as fs from "node:fs/promises";
import * as path from "node:path";
import editFile from "./edit_file.js";
import type { ToolContext } from "../../types.js";

console.log("=== Testing edit_file Tool ===\n");

// 创建测试上下文
const ctx: ToolContext = {
  cwd: process.cwd(),
  config: {} as any,
  signal: new AbortController().signal,
};

// 创建测试文件
const testFilePath = path.join(process.cwd(), "test-edit-demo.txt");
const originalContent = `Line 1: This is the first line
Line 2: This is the second line
Line 3: This is the third line
Line 4: This is the fourth line
Line 5: This is the fifth line`;

async function runTests() {
  try {
    // 准备测试文件
    await fs.writeFile(testFilePath, originalContent, "utf-8");
    console.log("✓ Test file created\n");

    // 测试 1: 成功替换单行
    console.log("Test 1: Replace a single line");
    const result1 = await editFile.execute(
      {
        path: testFilePath,
        old_string: "Line 3: This is the third line",
        new_string: "Line 3: This line has been edited!",
      },
      ctx
    );
    console.log(result1);
    const content1 = await fs.readFile(testFilePath, "utf-8");
    console.log("✓ Content updated correctly\n");

    // 测试 2: 替换多行（包含上下文）
    console.log("Test 2: Replace multiple lines with context");
    const result2 = await editFile.execute(
      {
        path: testFilePath,
        old_string: `Line 1: This is the first line
Line 2: This is the second line`,
        new_string: `Line 1: First line updated
Line 2: Second line updated`,
      },
      ctx
    );
    console.log(result2);
    console.log("✓ Multi-line replacement successful\n");

    // 测试 3: old_string 不存在（应该失败）
    console.log("Test 3: old_string not found (should fail)");
    try {
      await editFile.execute(
        {
          path: testFilePath,
          old_string: "This string does not exist",
          new_string: "New content",
        },
        ctx
      );
      console.error("✗ Should have thrown error\n");
    } catch (err) {
      console.log("✓ Caught expected error:", (err as Error).message, "\n");
    }

    // 测试 4: old_string 出现多次（应该失败）
    console.log("Test 4: old_string appears multiple times (should fail)");
    await fs.writeFile(
      testFilePath,
      `Line A
Line B
Line A
Line C`,
      "utf-8"
    );
    try {
      await editFile.execute(
        {
          path: testFilePath,
          old_string: "Line A",
          new_string: "Line X",
        },
        ctx
      );
      console.error("✗ Should have thrown error\n");
    } catch (err) {
      console.log("✓ Caught expected error:", (err as Error).message, "\n");
    }

    // 测试 5: 文件不存在（应该失败）
    console.log("Test 5: File does not exist (should fail)");
    try {
      await editFile.execute(
        {
          path: "nonexistent-file.txt",
          old_string: "test",
          new_string: "new",
        },
        ctx
      );
      console.error("✗ Should have thrown error\n");
    } catch (err) {
      console.log("✓ Caught expected error:", (err as Error).message, "\n");
    }

    // 清理测试文件
    await fs.unlink(testFilePath);
    console.log("✓ Test file cleaned up");

    console.log("\n=== All tests completed successfully ===");
  } catch (err) {
    console.error("Test failed:", err);
    // 清理
    try {
      await fs.unlink(testFilePath);
    } catch {}
    process.exit(1);
  }
}

runTests();
