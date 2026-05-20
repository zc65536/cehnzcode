// src/commands/builtins/plan.ts

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CommandDefinition, CommandContext } from "../types.js";
import type { TaskPlan, PlanInput, PlanDiscussionSession } from "../../planner/types.js";
import { ToolExecutor } from "../../tools/executor.js";
import { toolRegistry } from "../../tools/registry.js";
import { createChildLogger } from "../../logger/index.js";

const logger = createChildLogger("commands:plan");

/** 从项目根目录读取 .cehnzcode/CEHNZ.md，不存在时返回 undefined */
async function loadProjectInstructions(ctx: CommandContext): Promise<string | undefined> {
  const projectRoot = process.cwd();
  const cehnzPath = path.join(projectRoot, ".cehnzcode", "CEHNZ.md");

  try {
    const content = await fs.readFile(cehnzPath, "utf-8");
    logger.info({ path: cehnzPath }, "Loaded project instructions");
    return content;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      logger.debug("No project CEHNZ.md found");
      return undefined;
    }
    throw err;
  }
}

// ============ /plan 主命令（含所有子命令） ============

export const planCommand: CommandDefinition = {
  name: "plan",
  description: "创建并执行模块化任务计划 (子命令: confirm / list / resume / show / cancel)",
  async execute(args, ctx) {
    const [subcommand, ...rest] = args.trim().split(/\s+/);

    switch (subcommand) {
      case "confirm":
        await handleConfirm(ctx);
        break;

      case "list":
        await handleList(ctx);
        break;

      case "resume":
        await handleResume(rest.join(" ").trim(), ctx);
        break;

      case "show":
        ctx.ui.showAssistantMessage("计划详情功能尚未实现");
        break;

      case "cancel":
        await handleCancel(ctx);
        break;

      case "":
      case undefined:
        // 无参数 → 讨论模式
        await handleDiscussionMode(ctx);
        break;

      default:
        // 有内容的参数 → 直接模式（把完整 args 作为任务描述）
        logger.info({ taskLength: args.length }, "Entering direct mode");
        await runPlan({ task: args.trim(), discussionHistory: [] }, ctx);
        break;
    }
  },
};

// ============ 子命令处理函数 ============

/** /plan（无参数）→ 进入讨论模式 */
async function handleDiscussionMode(ctx: CommandContext): Promise<void> {
  if (!ctx.planner) {
    ctx.ui.showAssistantMessage("错误：Planner 未初始化，请检查配置。");
    return;
  }

  logger.info("Entering discussion mode");

  const projectInstructions = await loadProjectInstructions(ctx);
  const discussion = ctx.planner.createDiscussionSession({
    projectRoot: process.cwd(),
    projectInstructions,
  });

  ctx.session.setMode("plan-discussion", { discussion });
  ctx.ui.showAssistantMessage(
    "已进入 plan 讨论模式。请描述你想完成的任务，我会帮你澄清需求和模块边界。\n" +
    "（讨论结束后会自动生成计划，或输入 /plan confirm 强制结束讨论，/plan cancel 退出讨论）"
  );
}

/** /plan confirm → 强制结束讨论，触发计划生成 */
async function handleConfirm(ctx: CommandContext): Promise<void> {
  if (ctx.session.getMode() !== "plan-discussion") {
    ctx.ui.showAssistantMessage("当前不在 plan 讨论模式，请先输入 /plan 开始讨论。");
    return;
  }

  logger.info("Forcing discussion end via /plan confirm");

  const discussion = ctx.session.getModeData<PlanDiscussionSession>("discussion");
  ctx.session.setMode("normal");

  await runPlan({ task: null, discussionHistory: discussion.getHistory() }, ctx);
}

/** /plan cancel → 退出讨论模式（或取消正在执行的计划） */
async function handleCancel(ctx: CommandContext): Promise<void> {
  if (ctx.session.getMode() === "plan-discussion") {
    ctx.session.setMode("normal");
    ctx.ui.showAssistantMessage("已退出 plan 讨论模式。");
    logger.info("Discussion mode cancelled");
    return;
  }
  if (ctx.planner) {
    ctx.planner.cancel();
    ctx.ui.showAssistantMessage("已发送取消信号，正在等待当前模块完成...");
  } else {
    ctx.ui.showAssistantMessage("当前没有正在执行的计划。");
  }
}

// ============ 讨论模式输入处理 ============

/**
 * 讨论模式下的用户输入处理函数
 * 由 Orchestrator 在检测到 "plan-discussion" 模式后调用
 */
export async function handlePlanDiscussionInput(userInput: string, ctx: CommandContext): Promise<void> {
  const discussion = ctx.session.getModeData<PlanDiscussionSession>("discussion");
  const projectInstructions = await loadProjectInstructions(ctx);

  const executor = new ToolExecutor({
    cwd: process.cwd(),
    config: ctx.config,
    signal: new AbortController().signal,
  });

  const { readyToPlan } = await discussion.send(
    userInput,
    { projectRoot: process.cwd(), projectInstructions },
    {
      onChunk: (chunk) => ctx.ui.showAssistantChunk(chunk),
      tools: toolRegistry.getAll(),
      executor,
    }
  );

  if (readyToPlan) {
    logger.info("Discussion completed — model signalled READY_TO_PLAN");
    ctx.ui.showAssistantMessage("\n讨论结束，正在基于讨论内容生成计划...\n");
    ctx.session.setMode("normal");
    await runPlan({ task: null, discussionHistory: discussion.getHistory() }, ctx);
  }
}

// ============ 计划生成与展示 ============

/** 触发计划生成流程：生成计划 → 展示 → 用户确认 → 保存或执行 */
async function runPlan(input: PlanInput, ctx: CommandContext): Promise<void> {
  if (!ctx.planner) {
    ctx.ui.showAssistantMessage("错误：Planner 未初始化，请检查配置。");
    return;
  }

  try {
    // 1. 生成并验证计划
    ctx.ui.showAssistantMessage("正在分析任务并创建计划，请稍候...");

    const projectInstructions = await loadProjectInstructions(ctx);
    const plan = await ctx.planner.createPlan(input, {
      projectRoot: process.cwd(),
      projectInstructions,
    });

    // 2. 展示计划
    displayPlan(plan, ctx);

    // 3. 等待用户确认
    const answer = await ctx.ui.promptInput("是否开始执行此计划？(y/n): ");
    const confirmed = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";

    if (!confirmed) {
      const planPath = path.join(process.cwd(), ".cehnzcode", "plans", `${plan.id}.json`);
      await ctx.planner.savePlan(plan, planPath);
      ctx.ui.showAssistantMessage(`计划已保存到 ${planPath}\n使用 /plan resume ${plan.id} 继续执行`);
      return;
    }

    // 4. 执行计划
    ctx.ui.showAssistantMessage("\n开始执行计划...\n");
    logger.info({ planId: plan.id }, "Starting plan execution");

    let doneCount = 0;
    const total = plan.modules.length;

    for await (const result of ctx.planner.executePlan(plan)) {
      if (result.moduleId === "e2e") {
        // 端到端测试结果
        if (result.status === "failed") {
          ctx.ui.showAssistantMessage(`\n⚠️  端到端测试失败：${result.error}`);
        } else {
          ctx.ui.showAssistantMessage("\n✅ 端到端测试通过");
        }
        continue;
      }

      if (result.status === "done") {
        doneCount++;
        const files = result.note?.files.map(f => f.path).join(", ") || "（无文件）";
        ctx.ui.showAssistantMessage(
          `✓ [${doneCount}/${total}] ${result.moduleId}（${(result.duration / 1000).toFixed(1)}s）\n  文件: ${files}`
        );
      } else if (result.status === "failed") {
        ctx.ui.showAssistantMessage(
          `✗ ${result.moduleId} 执行失败\n  错误: ${result.error}`
        );
      }
    }

    const finalDone = plan.modules.filter(m => m.status === "done").length;
    const finalFailed = plan.modules.filter(m => m.status === "failed").length;
    const finalSkipped = plan.modules.filter(m => m.status === "skipped").length;

    ctx.ui.showAssistantMessage(
      `\n计划执行完成：${finalDone} 成功，${finalFailed} 失败，${finalSkipped} 跳过`
    );

  } catch (err) {
    ctx.ui.showError(err as Error);
  }
}

/** /plan list → 列出 .cehnzcode/plans/ 下所有已保存的计划 */
async function handleList(ctx: CommandContext): Promise<void> {
  const plansDir = path.join(process.cwd(), ".cehnzcode", "plans");

  try {
    const files = await fs.readdir(plansDir);
    const planFiles = files.filter(f => f.endsWith(".json") && f !== "active.json");

    if (planFiles.length === 0) {
      ctx.ui.showAssistantMessage("暂无保存的计划。使用 /plan <任务描述> 创建新计划。");
      return;
    }

    const lines = ["已保存的计划：\n"];
    for (const file of planFiles.sort()) {
      const filePath = path.join(plansDir, file);
      try {
        const data = await fs.readFile(filePath, "utf-8");
        const plan = JSON.parse(data) as TaskPlan;
        const date = new Date(plan.createdAt).toLocaleString();
        lines.push(`  ${plan.id}  [${plan.status}]  ${date}`);
        lines.push(`    任务: ${plan.task.slice(0, 60)}${plan.task.length > 60 ? "..." : ""}`);
        lines.push(`    模块: ${plan.modules.length} 个`);
      } catch {
        lines.push(`  ${file}  (无法读取)`);
      }
    }

    ctx.ui.showAssistantMessage(lines.join("\n"));
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      ctx.ui.showAssistantMessage("暂无保存的计划。使用 /plan <任务描述> 创建新计划。");
    } else {
      ctx.ui.showError(error as Error);
    }
  }
}

/** /plan resume <plan-id> → 加载已保存计划并继续执行 */
async function handleResume(planId: string, ctx: CommandContext): Promise<void> {
  if (!planId) {
    ctx.ui.showAssistantMessage("用法：/plan resume <plan-id>  （使用 /plan list 查看可用计划）");
    return;
  }

  if (!ctx.planner) {
    ctx.ui.showAssistantMessage("错误：Planner 未初始化，请检查配置。");
    return;
  }

  const planPath = path.join(process.cwd(), ".cehnzcode", "plans", `${planId}.json`);

  try {
    const plan = await ctx.planner.loadPlan(planPath);

    // 将 running 状态重置为 pending（上次执行中断）
    for (const module of plan.modules) {
      if (module.status === "running") {
        module.status = "pending";
      }
    }

    ctx.ui.showAssistantMessage(`已加载计划：${plan.id}`);
    displayPlan(plan, ctx);

    const answer = await ctx.ui.promptInput("是否继续执行此计划？(y/n): ");
    const confirmed = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";

    if (!confirmed) {
      ctx.ui.showAssistantMessage("已取消。计划未执行。");
      return;
    }

    ctx.ui.showAssistantMessage("\n继续执行计划...\n");

    let doneCount = 0;
    const total = plan.modules.filter(m => m.status !== "done").length;

    for await (const result of ctx.planner.executePlan(plan)) {
      if (result.moduleId === "e2e") {
        if (result.status === "failed") {
          ctx.ui.showAssistantMessage(`\n⚠️  端到端测试失败：${result.error}`);
        } else {
          ctx.ui.showAssistantMessage("\n✅ 端到端测试通过");
        }
        continue;
      }

      if (result.status === "done") {
        doneCount++;
        ctx.ui.showAssistantMessage(
          `✓ [${doneCount}/${total}] ${result.moduleId}（${(result.duration / 1000).toFixed(1)}s）`
        );
      } else if (result.status === "failed") {
        ctx.ui.showAssistantMessage(`✗ ${result.moduleId} 执行失败：${result.error}`);
      }
    }

    const finalDone = plan.modules.filter(m => m.status === "done").length;
    const finalFailed = plan.modules.filter(m => m.status === "failed").length;
    ctx.ui.showAssistantMessage(
      `\n计划执行完成：${finalDone} 成功，${finalFailed} 失败`
    );

  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      ctx.ui.showAssistantMessage(`未找到计划文件：${planPath}\n使用 /plan list 查看可用计划。`);
    } else {
      ctx.ui.showError(error as Error);
    }
  }
}

/** 将计划以可读格式展示给用户 */
function displayPlan(plan: TaskPlan, ctx: CommandContext): void {
  const complexityMap = { simple: "简单", medium: "中等", complex: "复杂" };
  const complexity = complexityMap[plan.metadata.complexity] ?? plan.metadata.complexity;
  const duration = plan.metadata.estimatedDuration ? `${plan.metadata.estimatedDuration} 分钟` : "未知";

  const lines: string[] = [
    "",
    "📋 任务计划",
    "",
    `任务: ${plan.task}`,
    `预估耗时: ${duration} | 复杂度: ${complexity}`,
    `模块数量: ${plan.modules.length}`,
    "",
    "模块列表:",
  ];

  for (const module of plan.modules) {
    const deps = module.dependsOn.length > 0
      ? ` | 依赖: ${module.dependsOn.join(", ")}`
      : "";
    const outputs = module.outputContract.map(c => c.name).join(", ");

    lines.push(`  ${module.index + 1}. ⏸ ${module.description}`);

    if (outputs) {
      lines.push(`     对外接口: ${outputs}`);
    }

    if (module.inputContract.length > 0) {
      const inputs = module.inputContract.map(c => c.name).join(", ");
      lines.push(`     依赖接口: ${inputs}`);
    }

    if (deps) {
      lines.push(`     ${deps}`);
    }
  }

  lines.push("");
  lines.push("请确认模块划分、依赖关系和接口定义是否合理。");

  ctx.ui.showAssistantMessage(lines.join("\n"));
}
