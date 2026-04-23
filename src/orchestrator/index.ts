import { ModelClient } from "../model/index.js";
import { ToolExecutor } from "../tools/executor.js";
import { toolRegistry } from "../tools/registry.js";
import { ConversationManager } from "../context/index.js";
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
  private executor: ToolExecutor;
  private ui: UIAdapter;
  private config: AppConfig;
  private running = false;

  constructor(config: AppConfig, ui: UIAdapter) {
    this.config = config;
    this.ui = ui;
    this.model = new ModelClient(config);
    this.context = new ConversationManager(config);
    this.executor = new ToolExecutor({
      cwd: process.cwd(),
      config,
      signal: AbortSignal.timeout(config.toolTimeout),
    });

    this.setupSystemPrompt();
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
    await this.ui.init();
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

    this.ui.dispose();
    logger.info("Session ended");
  }

  private async handleUserInput(input: string): Promise<void> {
    this.context.addTurn({ role: "user", content: input, tags: ["user"] });

    try {
      while (true) {
        const tools = toolRegistry.getAll();
        const response = await this.model.chat(this.context.getTurns(), tools);

        if (response.toolCalls.length === 0) {
          this.context.addTurn({ role: "assistant", content: response.content, tags: ["assistant"] });
          this.ui.showAssistantMessage(response.content);

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
          this.ui.showToolStatus(call.name, "running");
        }

        const results = await this.executor.runAll(response.toolCalls);

        for (let i = 0; i < results.length; i++) {
          this.ui.showToolStatus(
            response.toolCalls[i].name,
            results[i].error ? "error" : "done"
          );
        }

        this.context.addTurn({
          role: "tool",
          content: results.map((r) => r.output || r.error || "").join("\n"),
          toolResults: results,
          tags: ["tool"],
        });

        // Check if compression is needed
        if (this.context.needsCompression()) {
          await this.context.compress();
          logger.info("Context compressed");
        }
      }
    } catch (err) {
      this.ui.showError(err as Error);
      logger.error({ error: (err as Error).message }, "Error in conversation loop");
    }
  }
}
