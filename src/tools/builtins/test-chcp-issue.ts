/**
 * 测试 chcp 65001 对中文文件名的影响
 * 
 * 问题：chcp 65001 切换到 UTF-8 后，CMD 对中文文件名的处理可能出现问题
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const execAsync = promisify(exec);

async function testChcpIssue() {
  console.log("=== 测试 chcp 65001 对中文文件名的影响 ===\n");
  
  const testFile = "测试文件.txt";
  
  try {
    // 创建测试文件
    await fs.writeFile(testFile, "测试内容");
    console.log("✓ 测试文件已创建:", testFile);
    
    // 测试1: 不使用 chcp 65001
    console.log("\n--- 测试1: 不使用 chcp 65001 ---");
    try {
      const result1 = await execAsync(`del /F ${testFile}`);
      console.log("✓ 删除成功（不使用chcp）:", result1.stdout || "(no output)");
      
      // 重新创建文件用于下一个测试
      await fs.writeFile(testFile, "测试内容");
    } catch (err: any) {
      console.log("✗ 删除失败（不使用chcp）:", err.message);
    }
    
    // 测试2: 使用 chcp 65001
    console.log("\n--- 测试2: 使用 chcp 65001 ---");
    try {
      const result2 = await execAsync(`chcp 65001>nul && del /F ${testFile}`);
      console.log("✓ 删除成功（使用chcp）:", result2.stdout || "(no output)");
    } catch (err: any) {
      console.log("✗ 删除失败（使用chcp）:", err.message);
      console.log("   stderr:", err.stderr);
    }
    
    // 测试3: 使用 chcp 936 (GBK)
    console.log("\n--- 测试3: 使用 chcp 936 (GBK) ---");
    // 重新创建文件
    await fs.writeFile(testFile, "测试内容");
    try {
      const result3 = await execAsync(`chcp 936>nul && del /F ${testFile}`);
      console.log("✓ 删除成功（使用chcp 936）:", result3.stdout || "(no output)");
    } catch (err: any) {
      console.log("✗ 删除失败（使用chcp 936）:", err.message);
    }
    
    // 测试4: 使用 Node.js fs 直接删除
    console.log("\n--- 测试4: 使用 Node.js fs 直接删除 ---");
    // 重新创建文件
    await fs.writeFile(testFile, "测试内容");
    try {
      await fs.unlink(testFile);
      console.log("✓ 删除成功（使用 fs.unlink）");
    } catch (err: any) {
      console.log("✗ 删除失败（使用 fs.unlink）:", err.message);
    }
    
  } catch (err) {
    console.error("\n✗ 测试过程出错:", err);
  } finally {
    // 清理：确保删除测试文件
    try {
      await fs.unlink(testFile);
      console.log("\n✓ 清理完成");
    } catch {
      console.log("\n✓ 无需清理（文件已删除）");
    }
  }
}

// 运行测试
testChcpIssue();
