import { ProjectExplorer, formatStructureAsText } from "./project-explorer.js";

/**
 * 测试 ProjectExplorer 功能
 */
async function testProjectExplorer() {
  console.log("=== Testing ProjectExplorer ===\n");

  const projectRoot = process.cwd();
  const explorer = new ProjectExplorer(projectRoot);

  // 测试 1: 获取基本项目结构
  console.log("Test 1: Get basic project structure (depth=2)");
  const start1 = Date.now();
  const structure1 = await explorer.getStructure({ maxDepth: 1,collapseThreshold:21 });
  const time1 = Date.now() - start1;
  console.log(`Files: ${structure1.summary.totalFiles}`);
  console.log(`Directories: ${structure1.summary.totalDirectories}`);
  console.log(`Time: ${time1}ms\n`);

  // 测试 2: 格式化输出
  console.log("Test 2: Format structure as text");
  const formatted = formatStructureAsText(structure1);
  console.log(formatted);
  console.log();

  // 测试 3: 缓存性能
  console.log("Test 3: Cache performance");
  const start2 = Date.now();
  await explorer.getStructure({ maxDepth: 2 });
  const time2 = Date.now() - start2;
  console.log(`Cached read time: ${time2}ms (should be much faster)\n`);

  // 测试 4: 查找文件
  console.log("Test 4: Find TypeScript files");
  const tsFiles = await explorer.findFiles("**/*.ts");
  console.log(`Found ${tsFiles.length} TypeScript files`);
  console.log(`Examples: ${tsFiles.slice(0, 5).join(", ")}\n`);

  // 测试 5: 获取文件元数据
  console.log("Test 5: Get file metadata");
  if (tsFiles.length > 0) {
    const metadata = await explorer.getFileMetadata(tsFiles[0]);
    console.log(`File: ${tsFiles[0]}`);
    console.log(`Size: ${metadata.size} bytes`);
    console.log(`Modified: ${new Date(metadata.modified).toISOString()}`);
    console.log(`Extension: ${metadata.extension}\n`);
  }

  // 测试 6: 包含隐藏文件
  console.log("Test 6: Include hidden files");
  const structure2 = await explorer.getStructure({
    maxDepth: 1,
    includeHidden: true,
  });
  console.log(`Files (with hidden): ${structure2.summary.totalFiles}\n`);

  // 测试 7: 更深的递归
  console.log("Test 7: Deeper recursion (depth=4)");
  const start3 = Date.now();
  const structure3 = await explorer.getStructure({ maxDepth: 4 });
  const time3 = Date.now() - start3;
  console.log(`Files: ${structure3.summary.totalFiles}`);
  console.log(`Directories: ${structure3.summary.totalDirectories}`);
  console.log(`Time: ${time3}ms\n`);

  // 测试 8: 清除缓存
  console.log("Test 8: Clear cache and re-scan");
  explorer.clearCache();
  const start4 = Date.now();
  await explorer.getStructure({ maxDepth: 2 });
  const time4 = Date.now() - start4;
  console.log(`Time after cache clear: ${time4}ms\n`);

  console.log("=== All tests completed ===");
}

// 运行测试
testProjectExplorer().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
