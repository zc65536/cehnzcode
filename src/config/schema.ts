import { z } from "zod";

export const configSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  apiBaseUrl: z.string().url().default("https://api.openai.com/v1"),
  model: z.string().default("gpt-4o"),
  maxTokens: z.number().int().positive().default(4096),
  contextLimit: z.number().int().positive().default(100000),
  compressKeepTurns: z.number().int().positive().default(3),
  toolTimeout: z.number().int().positive().default(30000),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  sessionDir: z.string().default("./.sessions"),
  pluginDirs: z.array(z.string()).default([]),
});

export type ConfigSchema = z.infer<typeof configSchema>;
