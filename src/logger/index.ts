import pino from "pino";
import { getConfig } from "../config/index.js";

let logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!logger) {
    const config = getConfig();
    logger = pino({
      level: config.logLevel,
      transport: {
        target: "pino/file",
        options: { destination: 2 }, // stderr
      },
    });
  }
  return logger;
}

export function createChildLogger(name: string): pino.Logger {
  return getLogger().child({ module: name });
}
