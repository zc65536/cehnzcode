import * as readline from "node:readline";
import type { UIAdapter, TokenUsage } from "../../types.js";

export class TUIAdapter implements UIAdapter {
  private rl: readline.Interface | null = null;
  private isStreamingLine = false; // 标记是否正在流式输出

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

  showAssistantChunk(chunk: string): void {
    if (!this.isStreamingLine) {
      // 第一个chunk，不需要换行
      this.isStreamingLine = true;
    }
    process.stdout.write(chunk);
  }

  showAssistantMessage(content: string): void {
    // 如果之前在流式输出，先换行
    if (this.isStreamingLine) {
      process.stdout.write("\n");
      this.isStreamingLine = false;
    }
    console.log(`\n${content}\n`);
  }

  showToolStatus(name: string, status: "running" | "done" | "error"): void {
    // 如果之前在流式输出，先换行
    if (this.isStreamingLine) {
      process.stdout.write("\n");
      this.isStreamingLine = false;
    }
    const icons = { running: "⏳", done: "✅", error: "❌" };
    console.log(`  ${icons[status]} [${name}] ${status}`);
  }

  showError(err: Error): void {
    // 如果之前在流式输出，先换行
    if (this.isStreamingLine) {
      process.stdout.write("\n");
      this.isStreamingLine = false;
    }
    console.error(`\n❌ Error: ${err.message}\n`);
  }

  showTokenUsage(usage: { turn: TokenUsage; cumulative: TokenUsage }): void {
    // 如果之前在流式输出，先换行
    if (this.isStreamingLine) {
      process.stdout.write("\n\n");
      this.isStreamingLine = false;
    }
    console.log(
      `  📊 Tokens - API call: ${usage.turn.total} (context: ${usage.turn.prompt} + response: ${usage.turn.completion}) | session total: ${usage.cumulative.total}`
    );
  }

  dispose(): void {
    this.rl?.close();
    this.rl = null;
  }
}
