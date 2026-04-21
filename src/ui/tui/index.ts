import * as readline from "node:readline";
import type { UIAdapter, TokenUsage } from "../../types.js";

export class TUIAdapter implements UIAdapter {
  private rl: readline.Interface | null = null;

  async init(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    console.log("\n🤖 cehnzcode v0.1.0 - Mini Claude Code");
    console.log("Type /exit to quit, /help for commands\n");
  }

  async promptInput(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl!.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  async showAssistantStream(stream: AsyncIterable<string>): Promise<void> {
    for await (const chunk of stream) {
      process.stdout.write(chunk);
    }
    process.stdout.write("\n\n");
  }

  showAssistantMessage(content: string): void {
    console.log(`\n${content}\n`);
  }

  showToolStatus(name: string, status: "running" | "done" | "error"): void {
    const icons = { running: "⏳", done: "✅", error: "❌" };
    console.log(`  ${icons[status]} [${name}] ${status}`);
  }

  showError(err: Error): void {
    console.error(`\n❌ Error: ${err.message}\n`);
  }

  showTokenUsage(usage: { turn: TokenUsage; cumulative: TokenUsage }): void {
    console.log(
      `  📊 Tokens - turn: ${usage.turn.total} | total: ${usage.cumulative.total}`
    );
  }

  dispose(): void {
    this.rl?.close();
    this.rl = null;
  }
}
