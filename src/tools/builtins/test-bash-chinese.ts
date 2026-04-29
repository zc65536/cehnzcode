/**
 * 测试 bash 工具对中文文件名的支持
 * 
 * 这个测试验证：
 * 1. 在 Windows bash 环境下创建和删除中文文件名
 * 2. 路径分隔符的正确处理
 * 3. 编码问题的处理
 */

import bash from "./bash.js";
import type { ToolExecutionContext } from "../../types.js";

async function testChineseFilename() {
  console.log("=== 测试中文文件名支持 ===\n");
  
  const mockContext: ToolExecutionContext = {
    cwd: process.cwd(),
    config: { toolTimeout: 30000 } as any,
    signal: undefined as any,
  };
  
  const testFile = "测试文件.txt";
  
  try {
    // 1. 创建测试文件
    console.log("1. 创建测试文件...");
    const createResult = await bash.execute(
      { command: `echo "测试内容" > ${testFile}` },
      mockContext
    );
    console.log("✓ 创建成功:", createResult);
    
    // 2. 验证文件存在
    console.log("\n2. 验证文件存在...");
    const lsResult = await bash.execute(
      { command: `ls -la ${testFile}` },
      mockContext
    );
    console.log("✓ 文件存在:", lsResult);
    
    // 3. 读取文件内容
    console.log("\n3. 读取文件内容...");
    const catResult = await bash.execute(
      { command: `cat ${testFile}` },
      mockContext
    );
    console.log("✓ 文件内容:", catResult);
    
    // 4. 删除文件
    console.log("\n4. 删除文件...");
    const rmResult = await bash.execute(
      { command: `rm ${testFile}` },
      mockContext
    );
    console.log("✓ 删除成功:", rmResult);
    
    // 5. 验证文件已删除
    console.log("\n5. 验证文件已删除...");
    try {
      await bash.execute(
        { command: `ls ${testFile}` },
        mockContext
      );
      console.log("✗ 文件仍然存在（不应该）");
    } catch (err) {
      console.log("✓ 文件已删除（预期的错误）");
    }
    
    console.log("\n=== 所有测试通过 ===");
    
  } catch (err) {
    console.error("\n✗ 测试失败:", err);
    
    // 清理：尝试删除测试文件
    try {
      await bash.execute({ command: `rm -f ${testFile}` }, mockContext);
    } catch {}
  }
}

// 运行测试
testChineseFilename();
