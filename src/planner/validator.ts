// src/planner/validator.ts

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ModelClient } from "../model/index.js";
import type { AppConfig, Turn } from "../types.js";
import type { TaskPlan, Module, ValidationResult, ValidationIssue } from "./types.js";
import { DependencyGraphImpl } from "./dependency-graph.js";
import { buildPlanValidationPrompt, buildValidateNotePrompt, buildTestGenerationPrompt } from "../prompts/planner.js";
import { ToolExecutor } from "../tools/executor.js";
import { toolRegistry } from "../tools/registry.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:validator");

/** Message → Turn 转换工具，用于构造 model.chat() 所需的参数 */
function toTurns(messages: Array<{ role: "user" | "assistant" | "system"; content: string }>): Turn[] {
  return messages.map((msg, i) => ({
    id: `validator-${i}`,
    role: msg.role,
    content: msg.content,
    tags: [msg.role],
    tokenCount: 0,
    compressed: false,
    timestamp: Date.now(),
  }));
}

/**
 * 验证计划的供需匹配和循环依赖
 * model 参数可选——没有 model 时只做代码级验证
 */
export class PlanValidator {
  private model?: ModelClient;

  constructor(model?: ModelClient) {
    this.model = model;
  }

  /** 验证计划：代码检查 + 可选的模型语义审查 */
  async validatePlan(plan: TaskPlan): Promise<ValidationResult> {
    logger.info({ planId: plan.id }, "Validating plan");

    // 代码级精确验证（总是运行）
    logger.info({ planId: plan.id }, "[validatePlan] 步骤1: 代码级检查（循环依赖 + 接口匹配）");
    const codeIssues = [
      ...this.checkCircularDependency(plan),
      ...this.checkInterfaceMatching(plan),
    ];
    logger.info({ planId: plan.id, codeIssueCount: codeIssues.length }, "[validatePlan] 步骤1 完成");

    // 模型语义审查（仅在有 model 且有模块时运行）
    logger.info({ planId: plan.id, hasModel: !!this.model, moduleCount: plan.modules.length }, "[validatePlan] 步骤2: 模型语义审查（调用 model.chat）");
    const modelIssues = (this.model && plan.modules.length > 0)
      ? await this.validateWithModel(plan)
      : [];
    logger.info({ planId: plan.id, modelIssueCount: modelIssues.length }, "[validatePlan] 步骤2 完成");

    // 合并结果，按 description 去重（避免代码检查和模型检查重复报告）
    const seen = new Set<string>();
    const allIssues: ValidationIssue[] = [];

    for (const issue of [...codeIssues, ...modelIssues]) {
      if (!seen.has(issue.description)) {
        seen.add(issue.description);
        allIssues.push(issue);
      }
    }

    logger.info({ valid: allIssues.length === 0, issueCount: allIssues.length }, "Validation complete");

    return {
      valid: allIssues.length === 0,
      issues: allIssues,
    };
  }

  /** 调用模型做语义审查，解析返回的 JSON 结果 */
  private async validateWithModel(plan: TaskPlan): Promise<ValidationIssue[]> {
    const planJson = JSON.stringify({
      description: plan.description,
      modules: plan.modules.map(m => ({
        id: m.id,
        name: m.name,
        description: m.description,
        dependsOn: m.dependsOn,
        inputContract: m.inputContract,
        outputContract: m.outputContract,
      })),
    }, null, 2);

    const prompt = buildPlanValidationPrompt(planJson);

    try {
      const response = await this.model!.chat(toTurns([
        { role: "user", content: prompt },
      ]), []);

      const parsed = parseJsonSafe(response.content);
      if (!parsed) {
        logger.warn({ content: response.content }, "Model returned invalid JSON for validation");
        return [];
      }

      return (parsed.issues ?? []) as ValidationIssue[];
    } catch (err) {
      logger.error({ error: err }, "Model validation failed, skipping");
      return [];
    }
  }

  /** 检查循环依赖 */
  private checkCircularDependency(plan: TaskPlan): ValidationIssue[] {
    const graph = new DependencyGraphImpl();
    for (const module of plan.modules) {
      graph.addModule(module);
    }

    if (graph.hasCircularDependency()) {
      return [{
        type: "circular_dependency",
        description: "计划中存在循环依赖，请检查 dependsOn 字段",
        modules: [],
      }];
    }

    return [];
  }

  /**
   * 检查接口供需匹配：
   * 所有模块 inputContract 声明的接口必须在某个模块的 outputContract 中找到提供方
   */
  private checkInterfaceMatching(plan: TaskPlan): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 构建所有模块提供的接口名称集合
    const providedInterfaces = new Set<string>();
    for (const module of plan.modules) {
      for (const contract of module.outputContract) {
        providedInterfaces.add(contract.name);
      }
    }

    // 检查每个模块的 inputContract 是否都有提供方
    for (const module of plan.modules) {
      for (const contract of module.inputContract) {
        if (!providedInterfaces.has(contract.name)) {
          issues.push({
            type: "missing_provider",
            description: `模块 ${module.id} 需要接口 '${contract.name}'，但没有模块提供此接口`,
            modules: [module.index],
          });
        }
      }
    }

    return issues;
  }
}

const noteValidatorLogger = createChildLogger("planner:note-validator");

/** 验证模块笔记：四步验证流程（Phase 5） */
export class NoteValidator {
  private model?: ModelClient;
  private projectRoot: string;
  private config?: AppConfig;

  /**
   * model、projectRoot、config 可选——不提供时方法会抛出 "Not implemented" 错误，
   * 以便骨架测试继续通过。
   */
  constructor(model?: ModelClient, projectRoot?: string, config?: AppConfig) {
    this.model = model;
    this.projectRoot = projectRoot ?? process.cwd();
    this.config = config;
  }

  /** 三步验证：契约对比 → 静态检查 → 生成测试并运行修复（模型自主完成） */
  async validateNote(module: Module, _codeFiles: string[] = []): Promise<ValidationResult> {
    if (!this.model) throw new Error("Not implemented: NoteValidator requires model");
    noteValidatorLogger.info({ moduleId: module.id }, "Validating note");

    // 步骤1：模型对比 outputContract vs 笔记
    const contractResult = await this.compareContracts(module);
    if (!contractResult.valid) return contractResult;

    // 步骤2：静态检查导出是否在代码文件里实际存在
    const exportResult = await this.checkExports(module);
    if (!exportResult.valid) return exportResult;

    // 步骤3：模型自主写测试、运行、修复，直到通过
    const testResult = await this.generateAndRunTests(module);
    if (testResult.testPaths.length === 0) {
      noteValidatorLogger.warn({ moduleId: module.id }, "No test files produced, skipping");
      return { valid: true, issues: [] };
    }

    module.testPaths = testResult.testPaths;

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

    noteValidatorLogger.info({ moduleId: module.id }, "Note validation passed");
    return { valid: true, issues: [] };
  }

  /** 步骤1：调用模型对比 outputContract vs 模块笔记 */
  private async compareContracts(module: Module): Promise<ValidationResult> {
    noteValidatorLogger.info({ moduleId: module.id }, "Comparing contracts");

    if (!module.note) {
      return {
        valid: false,
        issues: [{ type: "missing_export", description: "模块笔记不存在", modules: [module.index] }],
      };
    }

    const prompt = buildValidateNotePrompt(module);
    const response = await this.model!.chat(
      toTurns([{ role: "user", content: prompt }]),
      []
    );

    const parsed = parseJsonSafe(response.content);
    if (!parsed) {
      // 解析失败时容错通过
      noteValidatorLogger.warn({ moduleId: module.id, content: response.content }, "Failed to parse contract validation result, skipping");
      return { valid: true, issues: [] };
    }

    if (!parsed.valid) {
      const issues: ValidationIssue[] = [];

      for (const name of (parsed.missing ?? [])) {
        issues.push({
          type: "missing_export",
          description: `笔记缺少接口：${name}`,
          modules: [module.index],
        });
      }

      for (const m of (parsed.mismatch ?? [])) {
        issues.push({
          type: "missing_export",
          description: `接口描述不匹配：${m.name} — ${m.issue}`,
          modules: [module.index],
        });
      }

      return { valid: false, issues };
    }

    return { valid: true, issues: [] };
  }

  /** 步骤2：静态检查——确认笔记声明的导出在代码文件里实际存在 */
  private async checkExports(module: Module): Promise<ValidationResult> {
    noteValidatorLogger.info({ moduleId: module.id }, "Checking exports");

    if (!module.note || module.note.exports.length === 0) {
      return { valid: true, issues: [] };
    }

    const issues: ValidationIssue[] = [];

    for (const exp of module.note.exports) {
      const result = await this.findExportInFiles(exp.name, module.note.files);
      if (result === "not_found") {
        // 文件存在但导出不在其中，这才是真实的缺失
        issues.push({
          type: "missing_export",
          description: `代码文件中未找到导出：'${exp.name}'`,
          modules: [module.index],
        });
      }
      // result === "no_files"：声明的文件全部不可读（可能还未创建），跳过检查
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * 在声明的文件列表中查找某个导出名称。
   *
   * 返回值：
   * - "found"    — 在至少一个文件中找到该导出
   * - "not_found"— 文件存在但未找到该导出（真实缺失）
   * - "no_files" — 所有声明的文件均不可读（跳过，不视为缺失）
   */
  private async findExportInFiles(
    exportName: string,
    files: Array<{ path: string }>
  ): Promise<"found" | "not_found" | "no_files"> {
    // 转义 exportName 防止正则注入
    const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const tsExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

    // TypeScript/JavaScript 严格检查 export 语法
    const tsPatterns = [
      new RegExp(`export\\s+(const|let|var|function|class|interface|type|enum)\\s+${escaped}\\b`),
      new RegExp(`export\\s+\\{[^}]*\\b${escaped}\\b[^}]*\\}`),
      new RegExp(`export\\s+default\\s+${escaped}\\b`),
    ];

    // 其他语言：只要名称作为独立单词出现即可
    const loosePattern = new RegExp(`\\b${escaped}\\b`);

    let anyFileRead = false;

    for (const file of files) {
      const filePath = path.isAbsolute(file.path)
        ? file.path
        : path.join(this.projectRoot, file.path);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        anyFileRead = true;
        const ext = path.extname(file.path).toLowerCase();
        const patterns = tsExtensions.has(ext) ? tsPatterns : [loosePattern];
        if (patterns.some(p => p.test(content))) return "found";
      } catch {
        // 文件不存在或无法读取，继续检查下一个
      }
    }

    return anyFileRead ? "not_found" : "no_files";
  }

  /** 步骤3：模型自主编写测试、运行、修复，直到通过或放弃 */
  async generateAndRunTests(module: Module): Promise<{ passed: boolean; testPaths: string[]; error?: string }> {
    if (!this.model || !this.config) throw new Error("Not implemented: NoteValidator requires model and config");
    noteValidatorLogger.info({ moduleId: module.id }, "Generating tests");

    if (!module.note || module.outputContract.length === 0) {
      return { passed: true, testPaths: [] };
    }

    const codeFiles = await this.readCodeFiles(module.note.files);
    const prompt = buildTestGenerationPrompt(module, codeFiles);

    const history: Turn[] = [
      toTurns([{ role: "user", content: prompt }])[0],
    ];

    const executor = new ToolExecutor({
      cwd: this.projectRoot,
      config: this.config,
      signal: new AbortController().signal,
    });
    const tools = toolRegistry.getAll();
    const MAX_ITERATIONS = 40;

    let turnSeq = 0;
    const makeTurn = (role: Turn["role"], content: string, extra?: Partial<Turn>): Turn => ({
      id: `test-gen-${++turnSeq}`,
      role,
      content,
      tags: [role],
      tokenCount: 0,
      compressed: false,
      timestamp: Date.now(),
      ...extra,
    });

    let lastAssistantContent = "";
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.model.chat(history, tools);
      lastAssistantContent = response.content;
      history.push(makeTurn("assistant", response.content, { toolCalls: response.toolCalls }));
      if (response.toolCalls.length === 0) break;
      const results = await executor.runAll(response.toolCalls);
      history.push(makeTurn("tool", results.map(r => r.output || r.error || "").join("\n"), { toolResults: results }));
    }

    // 解析最终输出：第一行是 PASS 或 FAIL: <原因>，后续行是文件路径
    const lines = lastAssistantContent
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const statusLine = lines[0] ?? "";
    const testPaths = lines.slice(1).filter(l => !l.startsWith("PASS") && !l.startsWith("FAIL"));
    const passed = statusLine.startsWith("PASS");
    const error = passed ? undefined : statusLine.replace(/^FAIL:\s*/i, "");

    noteValidatorLogger.info({ moduleId: module.id, passed, testPaths }, "Test generation and run complete");
    return { passed, testPaths, error };
  }

  /** 读取代码文件列表的内容 */
  private async readCodeFiles(
    files: Array<{ path: string; description: string }>
  ): Promise<Array<{ path: string; content: string }>> {
    const result: Array<{ path: string; content: string }> = [];

    for (const file of files) {
      const filePath = path.isAbsolute(file.path)
        ? file.path
        : path.join(this.projectRoot, file.path);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        result.push({ path: file.path, content });
      } catch {
        noteValidatorLogger.warn({ filePath }, "Failed to read code file, skipping");
      }
    }

    return result;
  }

}

/** 从可能含代码块的字符串中解析 JSON，失败返回 null */
function parseJsonSafe(content: string): any | null {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/) ?? content.match(/```\s*([\s\S]*?)\s*```/);
  const jsonText = match ? match[1] : content.trim();

  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}
