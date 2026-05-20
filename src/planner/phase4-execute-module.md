# Phase 4: executeModule 实现

## 目标

实现模块执行逻辑，包括：
1. 依赖图调度（并行执行 ready 的模块）
2. 模块执行（agentic loop，类似 orchestrator）
3. 笔记生成（执行完成后生成 ModuleNote）
4. 进度展示和错误处理

## 依赖

- Phase 1 骨架已完成
- Phase 3 createPlan 已完成
- 参考 `src/orchestrator/index.ts` 的 agentic loop 实现

---

## 核心逻辑

### 执行调度

```
executePlan(plan)
    ↓
构建依赖图
    ↓
循环直到所有模块完成：
    1. 找出所有 ready 的模块（dependsOn 都已 done）
    2. 并行执行这些模块
    3. 每个模块执行完成后 yield ModuleResult
    4. 更新模块状态
    5. 检查是否有新的 ready 模块
    ↓
所有模块完成 → 计划标记为 completed
```

### 模块执行

```
executeModule(module, plan)
    ↓
1. 收集 relatedModules 的笔记作为上下文
    ↓
2. 构造执行提示词
    - 总体目标
    - 完整模块列表
    - 当前模块描述
    - outputContract（必须实现的接口）
    - inputContract（可以使用的接口）
    - 相关模块的笔记
    ↓
3. 进入 agentic loop（类似 orchestrator.handleUserInput）
    - 调用模型（支持工具调用）
    - 执行工具
    - 继续对话
    - 直到无工具调用且 finishReason 为 stop/end_turn
    ↓
4. 生成模块笔记
    - 把完整对话历史传给模型
    - 要求输出 ModuleNote JSON
    ↓
5. 保存笔记到 .cehnzcode/notes/<module-id>.json
    ↓
返回 ModuleResult
```

---

## 实现清单

### 1. 提示词：MODULE_EXECUTION_PROMPT

```typescript
// src/prompts/planner.ts

export function buildModuleExecutionPrompt(
  plan: TaskPlan,
  module: Module,
  relatedNotes: Map<string, ModuleNote>
): string {
  const moduleList = plan.modules
    .map((m, i) => `${i + 1}. ${m.description} [${m.status}]`)
    .join("\n");

  const outputContracts = module.outputContract
    .map(c => `- ${c.name}：${c.description}`)
    .join("\n");

  const inputContracts = module.inputContract
    .map(c => `- ${c.name}（来自 ${c.sourceModule}）：${c.description}`)
    .join("\n");

  const relatedNotesText = Array.from(relatedNotes.entries())
    .map(([moduleId, note]) => {
      const files = note.files.map(f => `  - ${f.path}: ${f.description}`).join("\n");
      const exports = note.exports.map(e => `  - ${e.name}: ${e.description}`).join("\n");
      return `### ${moduleId}\n\n文件：\n${files}\n\n导出：\n${exports}`;
    })
    .join("\n\n");

  return `你正在执行一个任务计划中的一个模块。

## 总体目标

${plan.task}

## 完整模块列表

${moduleList}

## 当前模块（第 ${module.index + 1} 个，共 ${plan.modules.length} 个）

${module.description}

## 你必须实现的对外接口

${outputContracts || "（无）"}

**重要**：以上接口必须全部实现并导出，不可遗漏。

## 你可以使用的外部接口

${inputContracts || "（无）"}

${relatedNotesText ? `## 来自相关模块的信息\n\n${relatedNotesText}` : ""}

## 执行要求

1. **只实现当前模块**，不要修改其他模块负责的文件
2. **必须实现所有 outputContract 声明的接口**，并正确导出
3. **代码风格**：遵循项目规范（如有 CEHNZ.md）
4. **测试**：不需要在本阶段编写测试（测试由验证阶段自动生成）
5. **完成标志**：实现完成后，停止工具调用，我会自动生成模块笔记

开始实现吧！
`;
}
```

### 2. 提示词：NOTE_GENERATION_PROMPT

```typescript
// src/prompts/planner.ts

export function buildNoteGenerationPrompt(module: Module): string {
  return `实现已完成。请根据你的实际实现，输出本模块的笔记。

## 笔记格式

**只输出 JSON，不要有其他内容。**

\`\`\`json
{
  "files": [
    { "path": "src/auth/jwt.ts", "description": "JWT 工具函数" }
  ],
  "exports": [
    { "name": "generateToken", "description": "生成 JWT token" },
    { "name": "verifyToken", "description": "验证 JWT token 并返回 payload" }
  ],
  "envVars": ["JWT_SECRET"],
  "extra": {
    "dependencies": "jsonwebtoken@9.0.0"
  }
}
\`\`\`

## 字段说明

- \`files\`：本模块创建或修改的文件列表（必填）
- \`exports\`：本模块对外暴露的接口列表（必填，应覆盖 outputContract）
- \`envVars\`：本模块依赖的环境变量（可选）
- \`extra\`：其他需要其他模块知道的信息（可选）

请输出笔记：
`;
}
```

### 3. 实现 PlanExecutor.execute

```typescript
// src/planner/executor.ts

import type { ModelClient } from "../model/index.js";
import type { AppConfig, Turn } from "../types.js";
import type { TaskPlan, Module, ModuleResult, ModuleNote } from "./types.js";
import { DependencyGraphImpl } from "./dependency-graph.js";
import { NoteManager } from "./note-manager.js";
import { ToolExecutor } from "../tools/executor.js";
import { toolRegistry } from "../tools/registry.js";
import { buildModuleExecutionPrompt, buildNoteGenerationPrompt } from "../prompts/planner.js";
import { createChildLogger } from "../logger/index.js";
import * as path from "node:path";

const logger = createChildLogger("planner:executor");

export class PlanExecutor {
  private model: ModelClient;
  private config: AppConfig;
  private noteManager: NoteManager;
  private paused = false;
  private cancelled = false;

  constructor(model: ModelClient, config: AppConfig) {
    this.model = model;
    this.config = config;
    
    const notesDir = path.join(
      config.projectRoot || process.cwd(),
      ".cehnzcode",
      "notes"
    );
    this.noteManager = new NoteManager(notesDir);
  }

  async *execute(plan: TaskPlan): AsyncGenerator<ModuleResult> {
    logger.info({ planId: plan.id, moduleCount: plan.modules.length }, "Starting execution");

    // 构建依赖图
    const graph = new DependencyGraphImpl();
    for (const module of plan.modules) {
      graph.addModule(module);
    }

    // 执行循环
    while (this.hasUnfinishedModules(plan)) {
      // 检查暂停/取消
      if (this.cancelled) {
        logger.info("Execution cancelled");
        break;
      }

      if (this.paused) {
        await this.sleep(100);
        continue;
      }

      // 找出所有 ready 的模块
      const readyModules = this.getReadyModules(plan);

      if (readyModules.length === 0) {
        if (this.hasRunningModules(plan)) {
          // 有模块正在执行，等待
          await this.sleep(100);
          continue;
        } else {
          // 没有 ready 的模块，也没有正在执行的模块 → 死锁
          throw new Error("计划执行死锁：存在未完成的模块但无法继续");
        }
      }

      // 并行执行 ready 的模块
      logger.info({ count: readyModules.length }, "Executing ready modules");
      
      const results = await Promise.allSettled(
        readyModules.map(module => this.executeModule(module, plan))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const module = readyModules[i];

        if (result.status === "fulfilled") {
          yield result.value;
        } else {
          // 执行失败
          const error = result.reason as Error;
          logger.error({ moduleId: module.id, error: error.message }, "Module execution failed");
          
          yield {
            moduleId: module.id,
            status: "failed",
            error: error.message,
            duration: 0,
          };
        }
      }
    }

    logger.info({ planId: plan.id }, "Execution completed");
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  cancel(): void {
    this.cancelled = true;
  }

  private async executeModule(module: Module, plan: TaskPlan): Promise<ModuleResult> {
    const startTime = Date.now();
    logger.info({ moduleId: module.id }, "Executing module");

    module.status = "running";
    module.startedAt = startTime;

    try {
      // 1. 收集相关模块的笔记
      const relatedNotes = await this.noteManager.loadNotes(module.relatedModules);

      // 2. 构造执行提示词
      const systemPrompt = buildModuleExecutionPrompt(plan, module, relatedNotes);

      // 3. 进入 agentic loop
      const conversationHistory: Turn[] = [
        { role: "system", content: systemPrompt, tags: ["system"] },
      ];

      await this.agenticLoop(conversationHistory);

      // 4. 生成模块笔记
      const note = await this.generateNote(module, conversationHistory);

      // 5. 保存笔记
      await this.noteManager.saveNote(module, note);

      // 6. 更新模块状态
      module.status = "done";
      module.completedAt = Date.now();
      module.note = note;
      module.notePath = path.join(".cehnzcode", "notes", `${module.id}.json`);

      const duration = Date.now() - startTime;
      logger.info({ moduleId: module.id, duration }, "Module completed");

      return {
        moduleId: module.id,
        status: "done",
        note,
        duration,
      };

    } catch (err) {
      const error = err as Error;
      logger.error({ moduleId: module.id, error: error.message }, "Module execution failed");

      module.status = "failed";
      module.error = error.message;
      module.completedAt = Date.now();

      return {
        moduleId: module.id,
        status: "failed",
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Agentic loop（类似 orchestrator.handleUserInput）
   */
  private async agenticLoop(history: Turn[]): Promise<void> {
    const executor = new ToolExecutor({
      cwd: this.config.projectRoot || process.cwd(),
      config: this.config,
      signal: new AbortController().signal,
    });

    while (true) {
      const tools = toolRegistry.getAll();
      const response = await this.model.chat(history, tools);

      // 无工具调用 → 结束
      if (response.toolCalls.length === 0) {
        history.push({
          role: "assistant",
          content: response.content,
          tags: ["assistant"],
        });
        break;
      }

      // 有工具调用 → 执行工具
      history.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        tags: ["assistant", "tool-use"],
      });

      const results = await executor.runAll(response.toolCalls);

      history.push({
        role: "tool",
        content: results.map(r => r.output || r.error || "").join("\n"),
        toolResults: results,
        tags: ["tool"],
      });
    }
  }

  /**
   * 生成模块笔记
   */
  private async generateNote(module: Module, history: Turn[]): Promise<ModuleNote> {
    logger.info({ moduleId: module.id }, "Generating note");

    const prompt = buildNoteGenerationPrompt(module);

    // 追加笔记生成请求到对话历史
    const noteHistory = [
      ...history,
      { role: "user", content: prompt, tags: ["user"] },
    ];

    const response = await this.model.chat(noteHistory, []);

    // 解析 JSON
    const noteData = this.parseJSON(response.content);

    return noteData as ModuleNote;
  }

  private parseJSON(content: string): any {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1] : content;

    try {
      return JSON.parse(jsonText);
    } catch (err) {
      logger.error({ content }, "Failed to parse JSON");
      throw new Error(`模型返回的笔记不是有效的 JSON：${(err as Error).message}`);
    }
  }

  private hasUnfinishedModules(plan: TaskPlan): boolean {
    return plan.modules.some(m => m.status !== "done" && m.status !== "failed" && m.status !== "skipped");
  }

  private hasRunningModules(plan: TaskPlan): boolean {
    return plan.modules.some(m => m.status === "running");
  }

  private getReadyModules(plan: TaskPlan): Module[] {
    return plan.modules.filter(module => {
      if (module.status !== "pending") {
        return false;
      }

      // 检查所有依赖是否都已完成
      return module.dependsOn.every(depId => {
        const dep = plan.modules.find(m => m.id === depId);
        return dep?.status === "done";
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 4. 实现 NoteManager

```typescript
// src/planner/note-manager.ts

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Module, ModuleNote } from "./types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:note-manager");

export class NoteManager {
  private notesDir: string;

  constructor(notesDir: string) {
    this.notesDir = notesDir;
  }

  async saveNote(module: Module, note: ModuleNote): Promise<void> {
    logger.info({ moduleId: module.id }, "Saving note");

    await fs.mkdir(this.notesDir, { recursive: true });

    // 保存 JSON 格式（程序使用）
    const jsonPath = path.join(this.notesDir, `${module.id}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(note, null, 2), "utf-8");

    // 保存 Markdown 格式（人工阅读）
    const mdPath = path.join(this.notesDir, `${module.id}.md`);
    const markdown = this.noteToMarkdown(module, note);
    await fs.writeFile(mdPath, markdown, "utf-8");

    logger.info({ moduleId: module.id, jsonPath, mdPath }, "Note saved");
  }

  async loadNote(moduleId: string): Promise<ModuleNote | null> {
    logger.info({ moduleId }, "Loading note");

    const jsonPath = path.join(this.notesDir, `${moduleId}.json`);

    try {
      const data = await fs.readFile(jsonPath, "utf-8");
      return JSON.parse(data) as ModuleNote;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async loadNotes(moduleIds: string[]): Promise<Map<string, ModuleNote>> {
    logger.info({ count: moduleIds.length }, "Loading multiple notes");

    const notes = new Map<string, ModuleNote>();

    for (const moduleId of moduleIds) {
      const note = await this.loadNote(moduleId);
      if (note) {
        notes.set(moduleId, note);
      }
    }

    return notes;
  }

  private noteToMarkdown(module: Module, note: ModuleNote): string {
    let md = `# ${module.id}\n\n`;
    md += `## 描述\n\n${module.description}\n\n`;

    md += `## 文件\n\n`;
    for (const file of note.files) {
      md += `- \`${file.path}\`: ${file.description}\n`;
    }

    md += `\n## 导出接口\n\n`;
    for (const exp of note.exports) {
      md += `- \`${exp.name}\`: ${exp.description}\n`;
    }

    if (note.envVars && note.envVars.length > 0) {
      md += `\n## 环境变量\n\n`;
      for (const envVar of note.envVars) {
        md += `- \`${envVar}\`\n`;
      }
    }

    if (note.extra && Object.keys(note.extra).length > 0) {
      md += `\n## 其他信息\n\n`;
      for (const [key, value] of Object.entries(note.extra)) {
        md += `- **${key}**: ${value}\n`;
      }
    }

    return md;
  }
}
```

### 5. 完善 /plan 命令的执行部分

```typescript
// src/commands/builtins/plan.ts

async function runPlan(input: PlanInput, ctx: CommandContext): Promise<void> {
  if (!ctx.planner) {
    ctx.ui.showError(new Error("Planner not initialized"));
    return;
  }

  try {
    // 1. 生成并验证计划
    ctx.ui.showStatus("正在分析任务并创建计划...");
    
    const projectInstructions = await loadProjectInstructions(ctx);
    const plan = await ctx.planner.createPlan(input, {
      projectRoot: ctx.config.projectRoot,
      projectInstructions,
    });

    // 2. 展示计划
    showPlan(plan, ctx);

    // 3. 等待用户确认
    const confirm = await ctx.ui.confirm("是否开始执行此计划？(y/n)");
    if (!confirm) {
      const planPath = `.cehnzcode/plans/${plan.id}.json`;
      await ctx.planner.savePlan(plan, planPath);
      ctx.ui.showMessage(`计划已保存到 ${planPath}`);
      ctx.ui.showMessage("使用 /plan resume 继续执行");
      return;
    }

    // 4. 执行计划
    ctx.ui.showMessage("\n开始执行计划...\n");

    for await (const result of ctx.planner.executePlan(plan)) {
      showModuleResult(result, ctx);
    }

    ctx.ui.showMessage("\n✅ 计划执行完成！\n");

  } catch (err) {
    ctx.ui.showError(err as Error);
  }
}

function showPlan(plan: TaskPlan, ctx: CommandContext): void {
  ctx.ui.showMessage("\n📋 任务计划\n");
  ctx.ui.showMessage(`任务: ${plan.task}`);
  ctx.ui.showMessage(`预估耗时: ${plan.metadata.estimatedDuration || "未知"} 分钟 | 复杂度: ${plan.metadata.complexity}\n`);
  ctx.ui.showMessage("模块列表:");
  
  for (const module of plan.modules) {
    const deps = module.dependsOn.length > 0 ? ` | 依赖: ${module.dependsOn.join(", ")}` : "";
    const outputs = module.outputContract.map(c => c.name).join(", ");
    ctx.ui.showMessage(`  ${module.index + 1}. ⏸ ${module.description}`);
    if (outputs) {
      ctx.ui.showMessage(`     对外接口: ${outputs}`);
    }
    if (deps) {
      ctx.ui.showMessage(`     ${deps}`);
    }
  }

  ctx.ui.showMessage("\n请确认模块划分、依赖关系和接口定义是否合理。");
}

function showModuleResult(result: ModuleResult, ctx: CommandContext): void {
  if (result.status === "done") {
    ctx.ui.showMessage(`✓ 模块 ${result.moduleId}: 完成 (${(result.duration / 1000).toFixed(1)}s)`);
    if (result.note) {
      const files = result.note.files.map(f => f.path).join(", ");
      ctx.ui.showMessage(`  文件: ${files}`);
    }
  } else if (result.status === "failed") {
    ctx.ui.showMessage(`✗ 模块 ${result.moduleId}: 失败`);
    ctx.ui.showMessage(`  错误: ${result.error}`);
  }
}
```

---

## 测试

```typescript
// src/planner/test/test-executor.ts

import { describe, it, expect, vi } from "vitest";
import { PlanExecutor } from "../executor.js";
import type { TaskPlan, Module } from "../types.js";

describe("PlanExecutor", () => {
  it("should execute modules in dependency order", async () => {
    const plan: TaskPlan = {
      id: "test",
      task: "测试任务",
      description: "测试",
      modules: [
        {
          id: "module_001",
          index: 0,
          description: "模块1",
          dependsOn: [],
          relatedModules: [],
          inputContract: [],
          outputContract: [{ name: "func1", description: "功能1" }],
          status: "pending",
        },
        {
          id: "module_002",
          index: 1,
          description: "模块2",
          dependsOn: ["module_001"],
          relatedModules: [],
          inputContract: [{ name: "func1", description: "功能1", sourceModule: "module_001" }],
          outputContract: [],
          status: "pending",
        },
      ],
      status: "running",
      createdAt: Date.now(),
      metadata: { complexity: "simple", tags: [] },
    };

    const mockModel = {
      chat: vi.fn()
        .mockResolvedValueOnce({ content: "完成", toolCalls: [] })
        .mockResolvedValueOnce({ content: JSON.stringify({ files: [], exports: [] }) })
        .mockResolvedValueOnce({ content: "完成", toolCalls: [] })
        .mockResolvedValueOnce({ content: JSON.stringify({ files: [], exports: [] }) }),
    };

    const executor = new PlanExecutor(mockModel as any, {} as any);

    const results: any[] = [];
    for await (const result of executor.execute(plan)) {
      results.push(result);
    }

    expect(results).toHaveLength(2);
    expect(results[0].moduleId).toBe("module_001");
    expect(results[1].moduleId).toBe("module_002");
  });
});
```

---

## 验收标准

Phase 4 完成后应该满足：

1. ✅ 依赖图正确调度模块执行顺序
2. ✅ ready 的模块可以并行执行
3. ✅ 模块执行使用 agentic loop（支持工具调用）
4. ✅ 执行完成后自动生成模块笔记
5. ✅ 笔记保存为 JSON 和 Markdown 两种格式
6. ✅ 相关模块的笔记正确传递给执行模块
7. ✅ 执行进度实时展示
8. ✅ 错误处理和模块失败标记
9. ✅ 暂停/恢复/取消功能正常工作
10. ✅ 测试覆盖调度、执行、笔记生成等核心逻辑

---

## 注意事项

1. **并行执行**：
   - 使用 `Promise.allSettled` 确保一个模块失败不影响其他模块
   - 正确处理并发写入（不同模块写不同文件）

2. **Agentic loop**：
   - 复用 orchestrator 的逻辑
   - 支持所有工具（bash, read_file, write_file 等）
   - 终止条件：无工具调用且 finishReason 为 stop

3. **笔记生成**：
   - 笔记必须覆盖 outputContract
   - JSON 解析失败时给出清晰错误
   - Markdown 格式便于人工阅读

4. **错误处理**：
   - 模块失败时标记 failed，不阻塞其他模块
   - 依赖失败模块的模块自动跳过
   - 提供重试机制（Phase 5）
