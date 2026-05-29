import pino from "pino";
import { getConfig } from "../config/index.js";

let logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!logger) {
    const config = getConfig();
    // 使用同步写入 stderr，避免 Worker 线程（pkg 打包后 Worker 无法加载文件）
    logger = pino(
      { level: config.logLevel },
      pino.destination({ dest: 2, sync: true })
    );
  }
  return logger;
}

export function createChildLogger(name: string): pino.Logger {
  return getLogger().child({ module: name });
}
