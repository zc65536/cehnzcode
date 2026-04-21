import { configSchema } from "./schema.js";
import type { AppConfig } from "../types.js";

function loadEnv(): Record<string, string | undefined> {
  return {
    apiKey: process.env.API_KEY,
    apiBaseUrl: process.env.API_BASE_URL,
    model: process.env.MODEL,
    maxTokens: process.env.MAX_TOKENS,
    contextLimit: process.env.CONTEXT_LIMIT,
    compressKeepTurns: process.env.COMPRESS_KEEP_TURNS,
    toolTimeout: process.env.TOOL_TIMEOUT,
    logLevel: process.env.LOG_LEVEL,
    sessionDir: process.env.SESSION_DIR,
    pluginDirs: process.env.PLUGIN_DIRS,
  } as Record<string, string | undefined>;
}

function parseNumeric(raw: Record<string, string | undefined>): Record<string, unknown> {
  const numericKeys = ["maxTokens", "contextLimit", "compressKeepTurns", "toolTimeout"];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (numericKeys.includes(key)) {
      result[key] = parseInt(value, 10);
    } else if (key === "pluginDirs") {
      result[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const envRaw = loadEnv();
  const envParsed = parseNumeric(envRaw);
  const merged = { ...envParsed, ...overrides };
  const validated = configSchema.parse(merged);
  return validated as AppConfig;
}

let currentConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig;
}

export function setConfig(config: AppConfig): void {
  currentConfig = config;
}
