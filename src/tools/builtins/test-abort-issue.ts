/**
 * 测试 "The operation was aborted" 错误
 * 
 * 这个错误通常由以下原因引起：
 * 1. AbortSignal 被触发
 * 2. 超时
 * 3. 进程被外部中止
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const execAsync = promisify(exec);

async function testAbortIssue() {
  console.log("=== 测试 'The operation was aborted' 错误 ===\n");
  
  const testFile = "西游记.txt";
  
  try {
    // 创建测试文件
    await fs.writeFile(testFile, "测试内容");
    console.log("✓ 测试文件已创建:", testFile);
    
    // 测试1: 正常执行（模拟工具的执行方式）
    console.log("\n--- 测试1: 模拟工具执行方式 ---");
    try {
      const command = `chcp 65001>nul && del /F ${testFile}`;
      console.log("执行命令:", command);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout: 30000,
        signal: undefined, // 模拟没有 signal
      });
      
      console.log("✓ 执行成功");
      console.log("  stdout:", stdout || "(empty)");
      console.log("  stderr:", stderr || "(empty)");
    } catch (err: any) {
      console.log("✗ 执行失败:", err.message);
      console.log("  code:", err.code);
      console.log("  signal:", err.signal);
      console.log("  stdout:", err.stdout);
      console.log("  stderr:", err.stderr);
    }
    
    // 测试2: 使用 AbortController
    console.log("\n--- 测试2: 使用 AbortController（立即中止）---");
    await fs.writeFile(testFile, "测试内容");
    
    try {
      const controller = new AbortController();
      const command = `chcp 65001>nul && del /F ${testFile}`;
      
      // 立即中止
      controller.abort();
      
      await execAsync(command, {
        cwd: process.cwd(),
        timeout: 30000,
        signal: controller.signal,
      });
      
      console.log("✓ 执行成功（不应该到这里）");
    } catch (err: any) {
      console.log("✗ 执行失败（预期）:", err.message);
      console.log("  code:", err.code);
      console.log("  signal:", err.signal);
    }
    
    // 测试3: 使用 AbortController（延迟中止）
    console.log("\n--- 测试3: 使用 AbortController（延迟中止）---");
    await fs.writeFile(testFile, "测试内容");
    
    try {
      const controller = new AbortController();
      const command = `chcp 65001>nul && del /F ${testFile}`;
      
      // 100ms 后中止
      setTimeout(() => controller.abort(), 100);
      
      await execAsync(command, {
        cwd: process.cwd(),
        timeout: 30000,
        signal: controller.signal,
      });
      
      console.log("✓ 执行成功");
    } catch (err: any) {
      console.log("✗ 执行失败:", err.message);
      console.log("  code:", err.code);
      console.log("  signal:", err.signal);
    }
    
    // 测试4: 检查 signal 的类型
    console.log("\n--- 测试4: 检查不同的 signal 值 ---");
    await fs.writeFile(testFile, "测试内容");
    
    const testSignals = [
      { name: "undefined", value: undefined },
      { name: "null", value: null },
      { name: "valid AbortSignal", value: new AbortController().signal },
    ];
    
    for (const { name, value } of testSignals) {
      console.log(`\n  测试 signal = ${name}`);
      try {
        await fs.writeFile(testFile, "测试内容"); // 确保文件存在
        
        const command = `chcp 65001>nul && del /F ${testFile}`;
        await execAsync(command, {
          cwd: process.cwd(),
          timeout: 30000,
          signal: value as any,
        });
        
        console.log(`    ✓ 成功`);
      } catch (err: any) {
        console.log(`    ✗ 失败: ${err.message}`);
      }
    }
    
  } catch (err) {
    console.error("\n✗ 测试过程出错:", err);
  } finally {
    // 清理
    try {
      await fs.unlink(testFile);
      console.log("\n✓ 清理完成");
    } catch {
      console.log("\n✓ 无需清理（文件已删除）");
    }
  }
}

// 运行测试
testAbortIssue();
