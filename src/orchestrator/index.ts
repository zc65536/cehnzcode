import { ModelClient } from "../model/index.js";
import { ToolExecutor } from "../tools/executor.js";
import { toolRegistry } from "../tools/registry.js";
import { ConversationManager } from "../context/index.js";
import { SessionManager } from "../session/index.js";
import { tokenTracker } from "../tokens/index.js";
import { buildSystemMessage } from "../prompts/index.js";
import { skillRegistry } from "../skills/index.js";
import { createChildLogger } from "../logger/index.js";
import { commandRegistry } from "../commands/index.js";
import { TaskPlannerImpl } from "../planner/index.js";
import { hookRunner } from "../hooks/index.js";
import type { AppConfig, UIAdapter, ToolResult } from "../types.js";
import type { CommandContext, SessionMode, SessionModeManager } from "../commands/types.js";

const logger = createChildLogger("orchestrator");

// ============ ModeManager ============

/**
 * 轻量级会话模式管理器
 * 用于在 Orchestrator 内跟踪当前 UI 交互模式（如讨论模式），
 * 并向命令层提供 setMode / getMode / getModeData 接口。
 */
class ModeManager implements SessionModeManager {
  private mode: SessionMode = "normal";
  private data: Record<string, unknown> = {};

  getMode(): SessionMode {
    return this.mode;
  }

  setMode(mode: SessionMode, data: Record<string, unknown> = {}): void {
    this.mode = mode;
    this.data = data;
    logger.debug({ mode }, "Session mode changed");
  }

  getModeData<T = unknown>(key: string): T {
    return this.data[key] as T;
  }
}

// ============ Orchestrator ============

export class Orchestrator {
  private model: ModelClient;
  private context: ConversationManager;
  private sessionManager: SessionManager;
  private executor: ToolExecutor;
  private ui: UIAdapter;
  private config: AppConfig;
  private running = false;
  private modeManager: ModeManager;
  private planner: TaskPlannerImpl;

  constructor(config: AppConfig, ui: UIAdapter) {
    this.config = config;
    this.ui = ui;
    this.model = new ModelClient(config);
    this.modeManager = new ModeManager();
    this.planner = new TaskPlannerImpl(config, this.model);

    // 初始化 SessionManager
    this.sessionManager = new SessionManager(config);

    // 传递 SessionManager 给 ConversationManager
    this.context = new ConversationManager(config, this.sessionManager);

    // 注意：不在这里创建 executor，因为 AbortSignal.timeout() 会立即开始计时
    // 我们需要在每次执行工具时创建新的 signal
    this.executor = new ToolExecutor({
      cwd: process.cwd(),
      config,
      signal: new AbortController().signal, // 使用一个永不中止的 signal 作为默认值
    });
  }

  /** 构造命令执行上下文，供 commandRegistry.execute 使用 */
  private buildCommandContext(): CommandContext {
    return {
      ui: this.ui,
      config: this.config,
      context: this.context,
      planner: this.planner,
      session: this.modeManager,
      exit: () => { this.running = false; },
    };
  }

  private setupSystemPrompt(): void {
    const systemSkillsSnippet = skillRegistry.buildSystemPromptSnippet();
    this.context.addTurn({
      role: "system",
      content: buildSystemMessage(systemSkillsSnippet || undefined),
      tags: ["system"],
    });
  }

  async run(): Promise<void> {
    // 初始化会话
    await this.sessionManager.init();
    logger.info({ sessionId: this.sessionManager.getSessionId() }, "Session started");

    // session:start — 允许插件注入初始上下文或鉴权拦截
    const sessionStartResult = await hookRunner.run("session:start", {
      config: this.config,
      sessionId: this.sessionManager.getSessionId(),
    });
    if (sessionStartResult.cancelled) {
      this.ui.showError(new Error(`Session cancelled: ${sessionStartResult.reason}`));
      return;
    }

    await this.ui.init();
    this.setupSystemPrompt();
    this.running = true;

    while (this.running) {
      const input = await this.ui.promptInput("> ");
      if (!input.trim()) continue;

      // 命令优先：以 "/" 开头的输入永远走命令路径，不受模式影响
      if (input.startsWith("/")) {
        const handled = await commandRegistry.execute(input, this.buildCommandContext());
        if (!handled) {
          this.ui.showAssistantMessage(`Unknown command: ${input}. Type /help for available commands.`);
        }
        continue;
      }

      // 根据当前模式派发普通用户输入
      const mode = this.modeManager.getMode();
      if (mode === "plan-discussion") {
        await this.handlePlanDiscussionInput(input);
        continue;
      }

      await this.handleUserInput(input);
    }

    // 保存会话
    await this.sessionManager.saveTurns(this.context.getTurns());
    logger.info({ sessionId: this.sessionManager.getSessionId() }, "Session saved");

    // session:end — 纯观察，供插件做清理/统计
    await hookRunner.notify("session:end", {
      sessionId: this.sessionManager.getSessionId(),
      totalUsage: tokenTracker.getCumulative(),
      turnCount: tokenTracker.getTurnHistory().length,
    });

    this.ui.dispose();
    logger.info("Session ended");
  }

  /** 讨论模式下的输入处理，委托给 plan 命令模块 */
  private async handlePlanDiscussionInput(input: string): Promise<void> {
    try {
      const { handlePlanDiscussionInput } = await import("../commands/builtins/plan.js");
      await handlePlanDiscussionInput(input, this.buildCommandContext());
    } catch (err) {
      this.ui.showError(err as Error);
      logger.error({ error: (err as Error).message }, "Error in plan discussion");
    }
  }

  private async handleUserInput(rawInput: string): Promise<void> {
    // turn:before — 允许插件预处理/校验用户输入，或直接取消本轮
    const turnBeforeResult = await hookRunner.run("turn:before", { input: rawInput });
    if (turnBeforeResult.cancelled) {
      this.ui.showAssistantMessage(`[Blocked] ${turnBeforeResult.reason}`);
      return;
    }
    const input = turnBeforeResult.data.input;

    this.context.addTurn({ role: "user", content: input, tags: ["user"] });

    let finalResponse = "";
    let toolCallCount = 0;

    try {
      while (true) {
        const tools = toolRegistry.getAll();

        // model:before — 允许插件修改消息列表或工具列表
        const modelBeforeResult = await hookRunner.run("model:before", {
          messages: this.context.getTurns(),
          tools,
        });
        if (modelBeforeResult.cancelled) {
          this.ui.showAssistantMessage(`[Blocked] ${modelBeforeResult.reason}`);
          break;
        }
        const { messages: finalMessages, tools: finalTools } = modelBeforeResult.data;

        // 使用流式输出
        const { stream, getResponse } = this.model.chatStream(finalMessages, finalTools);

        // 实时显示流式输出
        for await (const chunk of stream) {
          this.ui.showAssistantChunk(chunk);
        }

        // 流式输出完成后，获取完整响应（包含usage）
        let response = await getResponse();

        // model:after — 允许插件修改模型输出内容
        const modelAfterResult = await hookRunner.run("model:after", { response });
        if (!modelAfterResult.cancelled) {
          response = modelAfterResult.data.response;
        }

        // 只有在流式结束后才追踪token
        tokenTracker.track(response.usage);

        if (response.toolCalls.length === 0) {
          this.context.addTurn({ role: "assistant", content: response.content, tags: ["assistant"] });
          finalResponse = response.content;

          // 显示token使用情况
          const lastTurn = tokenTracker.getLastTurn();
          if (lastTurn) {
            this.ui.showTokenUsage({ turn: lastTurn, cumulative: tokenTracker.getCumulative() });
          }
          break;
        }

        // Assistant turn with tool calls
        this.context.addTurn({
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
          tags: ["assistant", "tool-use"],
        });

        // 逐个过 tool:before hook，再执行，再过 tool:after hook
        const results: ToolResult[] = [];
        for (const call of response.toolCalls) {
          // tool:before — 可修改参数或取消
          const beforeResult = await hookRunner.run("tool:before", { call });
          if (beforeResult.cancelled) {
            results.push({ callId: call.id, output: "", error: `Cancelled: ${beforeResult.reason}` });
            this.ui.showToolStatus(call.name, "error");
            continue;
          }
          const finalCall = beforeResult.data.call;

          if (finalCall.name === "bash" && finalCall.arguments.command) {
            this.ui.showAssistantMessage(`💻 ${finalCall.arguments.command}`);
          }
          this.ui.showToolStatus(finalCall.name, "running");

          const rawResult = await this.executor.run(finalCall);

          // tool:after — 可修改工具输出（不支持 cancel）
          const afterResult = await hookRunner.run("tool:after", { call: finalCall, result: rawResult });
          const finalResult = afterResult.cancelled ? rawResult : afterResult.data.result;

          this.ui.showToolStatus(finalCall.name, finalResult.error ? "error" : "done");
          if (finalResult.error) {
            this.ui.showAssistantMessage(`❌ ${finalResult.error}`);
          } else if (finalResult.output && finalResult.output !== "(no output)") {
            if (finalCall.name === "bash") {
              this.ui.showAssistantMessage(`📤 ${finalResult.output}`);
            }
          }

          results.push(finalResult);
        }
        toolCallCount += results.length;

        this.context.addTurn({
          role: "tool",
          content: results.map((r) => r.output || r.error || "").join("\n"),
          toolResults: results,
          tags: ["tool"],
        });

        // Check if compression is needed
        if (this.context.needsCompression()) {
          logger.info("Context compression triggered");
          const compressionResult = await this.context.compress();
          logger.info("Context compressed successfully");
          // context:compress — 纯观察，通知插件压缩已发生
          if (compressionResult) {
            await hookRunner.notify("context:compress", {
              removedCount: compressionResult.removedCount,
              summary: compressionResult.summary,
            });
          }
        }
      }
    } catch (err) {
      this.ui.showError(err as Error);
      logger.error({ error: (err as Error).message }, "Error in conversation loop");
    }

    // turn:after — 纯观察，本轮全部完成后触发
    const lastTurn = tokenTracker.getLastTurn();
    await hookRunner.notify("turn:after", {
      input,
      finalResponse,
      toolCallCount,
      usage: lastTurn ?? { prompt: 0, completion: 0, total: 0 },
    });
  }
}
