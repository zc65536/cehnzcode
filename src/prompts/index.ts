export const SYSTEM_PROMPT = `You are a helpful AI coding assistant. You have access to tools that allow you to read files, write files, and execute commands.

When the user asks you to perform a task:
1. Understand what they need
2. Use the available tools to accomplish the task
3. Report what you did concisely

Be direct and concise in your responses. Focus on solving the problem.`;

export const COMPRESSION_PROMPT = `Summarize the following conversation turns concisely, preserving:
- Key decisions made
- Important context and constraints
- Current state of the task
- Any unresolved issues

Keep the summary under 500 tokens. Focus on information needed to continue the conversation.`;

export function buildSystemMessage(customInstructions?: string): string {
  let prompt = SYSTEM_PROMPT;
  if (customInstructions) {
    prompt += `\n\n## User Instructions\n${customInstructions}`;
  }
  return prompt;
}
