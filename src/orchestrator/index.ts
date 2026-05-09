import { ModelClient } from "../model/index.js";
import { ToolExecutor } from "../tools/executor.js";
import { toolRegistry } from "../tools/registry.js";
import { ConversationManager } from "../context/index.js";
import { SessionManager } from "../session/index.js";
import { tokenTracker } from "../tokens/index.js";
import { buildSystemMessage } from "../prompts/index.js";
import { createChildLogger } from "../logger/index.js";
import { commandRegistry } from "../commands/index.js";
import type { AppConfig, UIAdapter } from "../types.js";
import type { CommandContext } from "../commands/types.js";

const logger = createChildLogger("orchestrator");

export class Orchestrator {
  private model: ModelClient;
  private context: ConversationManager;
  private sessionManager: SessionManager;
  private executor: ToolExecutor;
  private ui: UIAdapter;
  private config: AppConfig;
  private running = false;

  constructor(config: AppConfig, ui: UIAdapter) {
    this.config = config;
    this.ui = ui;
    this.model = new ModelClient(config);
    
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
      exit: () => { this.running = false; },
    };
  }

  private setupSystemPrompt(): void {
    this.context.addTurn({
      role: "system",
      content: buildSystemMessage(),
      tags: ["system"],
    });
  }

  async run(): Promise<void> {
    // 初始化会话
    await this.sessionManager.init();
    logger.info({ sessionId: this.sessionManager.getSessionId() }, "Session started");

    await this.ui.init();
    this.setupSystemPrompt();
    this.running = true;

    while (this.running) {
      const input = await this.ui.promptInput("> ");
      if (!input.trim()) continue;

      if (input.startsWith("/")) {
        const handled = await commandRegistry.execute(input, this.buildCommandContext());
        if (!handled) {
          this.ui.showAssistantMessage(`Unknown command: ${input}. Type /help for available commands.`);
        }
        continue;
      }

      await this.handleUserInput(input);
    }

    // 保存会话
    await this.sessionManager.saveTurns(this.context.getTurns());
    logger.info({ sessionId: this.sessionManager.getSessionId() }, "Session saved");

    this.ui.dispose();
    logger.info("Session ended");
  }

  private async handleUserInput(input: string): Promise<void> {
    this.context.addTurn({ role: "user", content: input, tags: ["user"] });

    try {
      while (true) {
        const tools = toolRegistry.getAll();
        
        // 使用流式输出
        const { stream, getResponse } = this.model.chatStream(this.context.getTurns(), tools);
        
        // 实时显示流式输出
        let hasContent = false;
        for await (const chunk of stream) {
          if (!hasContent) {
            hasContent = true;
            // 第一个chunk时开始显示
          }
          this.ui.showAssistantChunk(chunk);
        }

        // 流式输出完成后，获取完整响应（包含usage）
        const response = await getResponse();

        // 只有在流式结束后才追踪token
        tokenTracker.track(response.usage);

        if (response.toolCalls.length === 0) {
          this.context.addTurn({ role: "assistant", content: response.content, tags: ["assistant"] });
          
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

        // Execute tools in parallel
        for (const call of response.toolCalls) {
          // 显示工具调用信息（特别是 bash 命令）
          if (call.name === "bash" && call.arguments.command) {
            this.ui.showAssistantMessage(`💻 ${call.arguments.command}`);
          }
          this.ui.showToolStatus(call.name, "running");
        }

        const results = await this.executor.runAll(response.toolCalls);

        for (let i = 0; i < results.length; i++) {
          this.ui.showToolStatus(
            response.toolCalls[i].name,
            results[i].error ? "error" : "done"
          );
          
          // 显示工具执行结果
          if (results[i].error) {
            this.ui.showAssistantMessage(`❌ ${results[i].error}`);
          } else if (results[i].output && results[i].output !== "(no output)") {
            // 对于 bash 命令，显示输出（如果有）
            if (response.toolCalls[i].name === "bash") {
              this.ui.showAssistantMessage(`📤 ${results[i].output}`);
            }
          }
        }

        this.context.addTurn({
          role: "tool",
          content: results.map((r) => r.output || r.error || "").join("\n"),
          toolResults: results,
          tags: ["tool"],
        });

        // Check if compression is needed
        if (this.context.needsCompression()) {
          logger.info("Context compression triggered");
          await this.context.compress();
          logger.info("Context compressed successfully");
        }
      }
    } catch (err) {
      this.ui.showError(err as Error);
      logger.error({ error: (err as Error).message }, "Error in conversation loop");
    }
  }
}
