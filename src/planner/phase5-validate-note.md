# Phase 5: validateNote 实现

## 目标

实现模块笔记验证和测试生成，确保模块实现符合计划要求。包括：
1. 对比 outputContract vs 模块笔记（模型验证）
2. 静态检查导出是否存在（代码验证）
3. 生成单元测试
4. 运行测试并处理失败
5. 端到端测试

## 依赖

- Phase 1 骨架已完成
- Phase 4 executeModule 已完成

---

## 核心逻辑

### 四步验证流程

```
executeModule 完成后 → 进入 validateNote
    ↓
步骤1：模型对比 outputContract vs 笔记
    - 检查笔记的 exports 是否覆盖所有 outputContract
    - 检查接口描述是否语义一致
    ↓ 不一致 → 模块重试
    ↓ 一致
步骤2：静态检查导出
    - 读取笔记中声明的文件
    - 检查文件中是否实际导出了声明的接口
    ↓ 缺失 → 带具体报错重试模块实现
    ↓ 通过
步骤3：生成单元测试
    - 模型读取笔记 + 代码
    - 生成测试文件到 .cehnzcode/notes/<module-id>.test.ts
    ↓ 生成失败 → 重试测试生成（不重试模块实现）
    ↓ 生成成功
步骤4：运行测试
    - 执行测试文件
    ↓ 失败 → 把测试报错追加到对话历史，继续修复（对话内修复优先）
           → 轮次超限则重开实现（带入失败原因）
    ↓ 通过
步骤5：模块标记 done，测试文件路径写入 module.testPaths
```

### 端到端测试

```
所有模块标记 done 后：
    ↓
收集所有模块的 testPaths
    ↓
统一运行所有测试
    ↓ 通过 → 计划标记 completed
    ↓ 失败 → 定位到具体模块 → 触发该模块完整重试
           → 重试完成后重新运行端到端测试
```

---

## 实现清单

### 1. 提示词：VALIDATE_NOTE_PROMPT

```typescript
// src/prompts/planner.ts

export function buildValidateNotePrompt(module: Module): string {
  return `对比以下两份信息，判断模块笔记是否完整覆盖了声明的对外接口。

## 计划阶段声明的对外接口（outputContract）

\`\`\`json
${JSON.stringify(module.outputContract, null, 2)}
\`\`\`

## 模块执行后写入的笔记（exports）

\`\`\`json
${JSON.stringify(module.note?.exports, null, 2)}
\`\`\`

## 判断标准

outputContract 中每一个接口，都必须在笔记的 exports 中找到对应条目：
- 名称必须完全匹配
- 功能描述语义一致（允许措辞不同，但含义相同）

## 输出格式

**只输出 JSON，不要有其他内容。**

\`\`\`json
{
  "valid": true,
  "missing": [],
  "mismatch": []
}
\`\`\`

如果有问题，返回：

\`\`\`json
{
  "valid": false,
  "missing": ["verifyToken", "UserId"],
  "mismatch": [
    { 
      "name": "generateToken", 
      "issue": "描述不符：声明返回 string，笔记中描述为返回 token 对象" 
    }
  ]
}
\`\`\`
`;
}
```

### 2. 提示词：TEST_GENERATION_PROMPT

```typescript
// src/prompts/planner.ts

export function buildTestGenerationPrompt(module: Module, codeFiles: string[]): string {
  const outputContracts = module.outputContract
    .map(c => `- ${c.name}：${c.description}`)
    .join("\n");

  const filesContent = codeFiles
    .map(file => `### ${file.path}\n\n\`\`\`typescript\n${file.content}\n\`\`\``)
    .join("\n\n");

  return `为以下模块的对外接口生成单元测试。

## 模块对外接口（outputContract）

${outputContracts}

## 模块笔记

\`\`\`json
${JSON.stringify(module.note, null, 2)}
\`\`\`

## 相关代码文件

${filesContent}

## 要求

1. **测试覆盖**：针对每个对外接口至少写一个测试用例
2. **测试文件**：命名为 \`${module.id}.test.ts\`，放在 \`.cehnzcode/notes/\` 目录下
3. **测试范围**：只测试对外接口的行为，不测试内部实现细节
4. **测试框架**：使用项目已有的测试框架（如 vitest, jest 等）
5. **独立性**：测试应该可以独立运行，不依赖外部服务

请生成完整的测试文件内容：
`;
}
```

### 3. 实现 NoteValidator.validateNote

```typescript
// src/planner/validator.ts

import type { ModelClient } from "../model/index.js";
import type { Module, ModuleNote, ValidationResult, ValidationIssue } from "./types.js";
import { buildValidateNotePrompt, buildTestGenerationPrompt } from "../prompts/planner.js";
import { createChildLogger } from "../logger/index.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const logger = createChildLogger("planner:note-validator");

export class NoteValidator {
  private model: ModelClient;
  private projectRoot: string;

  constructor(model: ModelClient, projectRoot: string) {
    this.model = model;
    this.projectRoot = projectRoot;
  }

  /**
   * 四步验证流程
   */
  async validateNote(module: Module): Promise<ValidationResult> {
    logger.info({ moduleId: module.id }, "Validating note");

    // 步骤1：模型对比 outputContract vs 笔记
    const contractValidation = await this.compareContracts(module);
    if (!contractValidation.valid) {
      return contractValidation;
    }

    // 步骤2：静态检查导出
    const exportValidation = await this.checkExports(module);
    if (!exportValidation.valid) {
      return exportValidation;
    }

    // 步骤3：生成测试
    const testPaths = await this.generateTests(module);
    if (!testPaths || testPaths.length === 0) {
      return {
        valid: false,
        issues: [{
          type: "missing_export",
          description: "测试生成失败",
          modules: [module.index],
        }],
      };
    }

    module.testPaths = testPaths;

    // 步骤4：运行测试
    const testResult = await this.runTests(testPaths);
    if (!testResult.passed) {
      return {
        valid: false,
        issues: [{
          type: "missing_export",
          description: `测试失败：${testResult.error}`,
          modules: [module.index],
        }],
      };
    }

    logger.info({ moduleId: module.id }, "Note validation passed");
    return { valid: true, issues: [] };
  }

  /**
   * 步骤1：模型对比 outputContract vs 笔记
   */
  private async compareContracts(module: Module): Promise<ValidationResult> {
    logger.info({ moduleId: module.id }, "Comparing contracts");

    if (!module.note) {
      return {
        valid: false,
        issues: [{
          type: "missing_export",
          description: "模块笔记不存在",
          modules: [module.index],
        }],
      };
    }

    const prompt = buildValidateNotePrompt(module);
    const response = await this.model.chat([
      { role: "system", content: prompt },
    ], []);

    try {
      const result = JSON.parse(response.content);

      if (!result.valid) {
        const issues: ValidationIssue[] = [];

        if (result.missing && result.missing.length > 0) {
          issues.push({
            type: "missing_export",
            description: `缺少接口：${result.missing.join(", ")}`,
            modules: [module.index],
          });
        }

        if (result.mismatch && result.mismatch.length > 0) {
          for (const mismatch of result.mismatch) {
            issues.push({
              type: "missing_export",
              description: `接口不匹配：${mismatch.name} - ${mismatch.issue}`,
              modules: [module.index],
            });
          }
        }

        return { valid: false, issues };
      }

      return { valid: true, issues: [] };

    } catch (err) {
      logger.error({ content: response.content }, "Failed to parse validation result");
      // 解析失败时假设通过（容错）
      return { valid: true, issues: [] };
    }
  }

  /**
   * 步骤2：静态检查导出
   */
  private async checkExports(module: Module): Promise<ValidationResult> {
    logger.info({ moduleId: module.id }, "Checking exports");

    if (!module.note) {
      return { valid: true, issues: [] };
    }

    const issues: ValidationIssue[] = [];

    // 检查每个声明的导出是否在文件中实际存在
    for (const exp of module.note.exports) {
      const found = await this.findExportInFiles(exp.name, module.note.files);
      
      if (!found) {
        issues.push({
          type: "missing_export",
          description: `接口 '${exp.name}' 在代码文件中未找到导出`,
          modules: [module.index],
        });
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * 在文件中查找导出
   */
  private async findExportInFiles(exportName: string, files: Array<{ path: string }>): Promise<boolean> {
    for (const file of files) {
      const filePath = path.join(this.projectRoot, file.path);
      
      try {
        const content = await fs.readFile(filePath, "utf-8");
        
        // 简单的正则匹配（可以改进为 AST 解析）
        const exportPatterns = [
          new RegExp(`export\\s+(const|let|var|function|class|interface|type|enum)\\s+${exportName}\\b`),
          new RegExp(`export\\s+{[^}]*\\b${exportName}\\b[^}]*}`),
          new RegExp(`export\\s+default\\s+${exportName}\\b`),
        ];

        for (const pattern of exportPatterns) {
          if (pattern.test(content)) {
            return true;
          }
        }
      } catch (err) {
        logger.warn({ filePath, error: (err as Error).message }, "Failed to read file");
      }
    }

    return false;
  }

  /**
   * 步骤3：生成测试
   */
  async generateTests(module: Module): Promise<string[]> {
    logger.info({ moduleId: module.id }, "Generating tests");

    if (!module.note) {
      return [];
    }

    // 读取代码文件内容
    const codeFiles = await this.readCodeFiles(module.note.files);

    // 构造提示词
    const prompt = buildTestGenerationPrompt(module, codeFiles);

    // 调用模型生成测试
    const response = await this.model.chat([
      { role: "system", content: prompt },
    ], []);

    // 提取测试文件内容
    const testContent = this.extractCodeBlock(response.content);

    // 保存测试文件
    const testPath = path.join(this.projectRoot, ".cehnzcode", "notes", `${module.id}.test.ts`);
    await fs.mkdir(path.dirname(testPath), { recursive: true });
    await fs.writeFile(testPath, testContent, "utf-8");

    logger.info({ moduleId: module.id, testPath }, "Test generated");

    return [testPath];
  }

  /**
   * 步骤4：运行测试
   */
  async runTests(testPaths: string[]): Promise<{ passed: boolean; error?: string }> {
    logger.info({ count: testPaths.length }, "Running tests");

    try {
      // 检测项目使用的测试框架
      const testCommand = await this.detectTestCommand();

      // 运行测试
      const testFiles = testPaths.map(p => path.relative(this.projectRoot, p)).join(" ");
      const { stdout, stderr } = await execAsync(`${testCommand} ${testFiles}`, {
        cwd: this.projectRoot,
      });

      logger.info({ stdout, stderr }, "Tests passed");
      return { passed: true };

    } catch (err: any) {
      const error = err as { stdout?: string; stderr?: string; message: string };
      logger.error({ error: error.message, stdout: error.stdout, stderr: error.stderr }, "Tests failed");
      
      return {
        passed: false,
        error: error.stderr || error.stdout || error.message,
      };
    }
  }

  /**
   * 读取代码文件内容
   */
  private async readCodeFiles(files: Array<{ path: string; description: string }>): Promise<Array<{ path: string; content: string }>> {
    const result = [];

    for (const file of files) {
      const filePath = path.join(this.projectRoot, file.path);
      
      try {
        const content = await fs.readFile(filePath, "utf-8");
        result.push({ path: file.path, content });
      } catch (err) {
        logger.warn({ filePath, error: (err as Error).message }, "Failed to read file");
      }
    }

    return result;
  }

  /**
   * 提取代码块
   */
  private extractCodeBlock(content: string): string {
    const match = content.match(/```(?:typescript|ts)?\s*([\s\S]*?)\s*```/);
    return match ? match[1] : content;
  }

  /**
   * 检测测试命令
   */
  private async detectTestCommand(): Promise<string> {
    const packageJsonPath = path.join(this.projectRoot, "package.json");
    
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
      
      // 检查 scripts.test
      if (packageJson.scripts?.test) {
        return "npm test --";
      }

      // 检查依赖
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      if (deps.vitest) {
        return "npx vitest run";
      }
      
      if (deps.jest) {
        return "npx jest";
      }

      // 默认
      return "npm test --";

    } catch (err) {
      logger.warn("Failed to detect test command, using default");
      return "npm test --";
    }
  }
}
```

### 4. 集成到 PlanExecutor

```typescript
// src/planner/executor.ts

import { NoteValidator } from "./validator.js";

export class PlanExecutor {
  private model: ModelClient;
  private config: AppConfig;
  private noteManager: NoteManager;
  private noteValidator: NoteValidator;
  // ...

  constructor(model: ModelClient, config: AppConfig) {
    this.model = model;
    this.config = config;
    
    const projectRoot = config.projectRoot || process.cwd();
    const notesDir = path.join(projectRoot, ".cehnzcode", "notes");
    
    this.noteManager = new NoteManager(notesDir);
    this.noteValidator = new NoteValidator(model, projectRoot);
  }

  private async executeModule(module: Module, plan: TaskPlan): Promise<ModuleResult> {
    const startTime = Date.now();
    logger.info({ moduleId: module.id }, "Executing module");

    module.status = "running";
    module.startedAt = startTime;

    try {
      // 1-5: 原有逻辑（收集笔记、执行、生成笔记、保存笔记）
      // ...

      // 6. 验证笔记
      const validation = await this.noteValidator.validateNote(module);
      
      if (!validation.valid) {
        // 验证失败 → 触发重试
        logger.warn({ moduleId: module.id, issues: validation.issues }, "Note validation failed");
        
        if (module.retryConfig && module.retryConfig.currentRetry < module.retryConfig.maxRetries) {
          module.retryConfig.currentRetry++;
          logger.info({ moduleId: module.id, retry: module.retryConfig.currentRetry }, "Retrying module");
          
          // 重置状态并重试
          module.status = "pending";
          return await this.executeModule(module, plan);
        } else {
          throw new Error(`笔记验证失败：${validation.issues.map(i => i.description).join("; ")}`);
        }
      }

      // 7. 更新模块状态
      module.status = "done";
      module.completedAt = Date.now();

      const duration = Date.now() - startTime;
      logger.info({ moduleId: module.id, duration }, "Module completed");

      return {
        moduleId: module.id,
        status: "done",
        note: module.note,
        duration,
      };

    } catch (err) {
      // 错误处理...
    }
  }
}
```

### 5. 端到端测试

```typescript
// src/planner/executor.ts

export class PlanExecutor {
  // ...

  async *execute(plan: TaskPlan): AsyncGenerator<ModuleResult> {
    // ... 原有的模块执行循环

    // 所有模块完成后，运行端到端测试
    logger.info({ planId: plan.id }, "Running end-to-end tests");

    const allTestPaths = plan.modules
      .filter(m => m.testPaths && m.testPaths.length > 0)
      .flatMap(m => m.testPaths!);

    if (allTestPaths.length > 0) {
      const testResult = await this.noteValidator.runTests(allTestPaths);

      if (!testResult.passed) {
        logger.error({ error: testResult.error }, "End-to-end tests failed");
        
        // TODO: 定位失败的模块并重试
        throw new Error(`端到端测试失败：${testResult.error}`);
      }

      logger.info("End-to-end tests passed");
    }
  }
}
```

---

## 测试

```typescript
// src/planner/test/test-note-validator.ts

import { describe, it, expect, vi } from "vitest";
import { NoteValidator } from "../validator.js";
import type { Module } from "../types.js";

describe("NoteValidator", () => {
  it("should validate note contracts", async () => {
    const module: Module = {
      id: "module_001",
      index: 0,
      description: "测试模块",
      dependsOn: [],
      relatedModules: [],
      inputContract: [],
      outputContract: [
        { name: "func1", description: "功能1" },
      ],
      note: {
        files: [],
        exports: [
          { name: "func1", description: "功能1" },
        ],
      },
      status: "running",
    };

    const mockModel = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({ valid: true, missing: [], mismatch: [] }),
      }),
    };

    const validator = new NoteValidator(mockModel as any, "/test");
    const result = await validator["compareContracts"](module);

    expect(result.valid).toBe(true);
  });

  it("should detect missing exports", async () => {
    const module: Module = {
      id: "module_001",
      index: 0,
      description: "测试模块",
      dependsOn: [],
      relatedModules: [],
      inputContract: [],
      outputContract: [
        { name: "func1", description: "功能1" },
        { name: "func2", description: "功能2" },
      ],
      note: {
        files: [],
        exports: [
          { name: "func1", description: "功能1" },
        ],
      },
      status: "running",
    };

    const mockModel = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          valid: false,
          missing: ["func2"],
          mismatch: [],
        }),
      }),
    };

    const validator = new NoteValidator(mockModel as any, "/test");
    const result = await validator["compareContracts"](module);

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].description).toContain("func2");
  });
});
```

---

## 验收标准

Phase 5 完成后应该满足：

1. ✅ 模型正确对比 outputContract vs 笔记
2. ✅ 静态检查正确检测导出是否存在
3. ✅ 测试生成覆盖所有对外接口
4. ✅ 测试文件保存到正确位置
5. ✅ 测试运行并正确报告结果
6. ✅ 验证失败时触发模块重试
7. ✅ 重试次数限制正常工作
8. ✅ 端到端测试在所有模块完成后运行
9. ✅ 测试失败时给出清晰的错误信息
10. ✅ 测试覆盖验证、生成、运行等核心逻辑

---

## 注意事项

1. **验证策略**：
   - 模型验证 + 静态检查双重保障
   - 模型验证更智能（语义理解）
   - 静态检查更精确（实际存在性）

2. **测试生成**：
   - 测试应该独立可运行
   - 不依赖外部服务
   - 覆盖所有对外接口

3. **重试机制**：
   - 对话内修复优先（追加错误信息到历史）
   - 重试次数超限后重开实现
   - 重开时带入失败原因

4. **错误处理**：
   - 测试失败时给出具体的失败信息
   - 端到端测试失败时定位到具体模块
   - 提供人工介入的机会

5. **性能优化**：
   - 测试生成可以并行
   - 测试运行可以批量
   - 静态检查可以缓存结果

---

## 后续优化

1. **AST 解析**：使用 TypeScript Compiler API 精确检查导出
2. **测试覆盖率**：统计测试覆盖率并报告
3. **增量测试**：只运行受影响的测试
4. **测试快照**：支持快照测试
5. **Mock 生成**：自动生成依赖的 mock
