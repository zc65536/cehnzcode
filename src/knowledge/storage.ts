import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { KnowledgeStore, KnowledgeRecord, KnowledgeScope } from "./types.js";

const STORE_VERSION = "1.0";

/** 返回系统级存储路径：~/.cehnzcode/knowledge/errors.json */
export function getSystemStorePath(): string {
  return path.join(os.homedir(), ".cehnzcode", "knowledge", "errors.json");
}

/** 返回项目级存储路径：<cwd>/.cehnzcode/knowledge/errors.json */
export function getProjectStorePath(cwd: string): string {
  return path.join(cwd, ".cehnzcode", "knowledge", "errors.json");
}

/** 读取存储文件，文件不存在时返回空 store */
export async function readStore(filePath: string): Promise<KnowledgeStore> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as Partial<KnowledgeStore>;
    return {
      version: data.version ?? STORE_VERSION,
      errors: Array.isArray(data.errors) ? data.errors : [],
    };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      return { version: STORE_VERSION, errors: [] };
    }
    throw err;
  }
}

/** 将 store 写入文件，自动创建父目录 */
export async function writeStore(filePath: string, store: KnowledgeStore): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
}

/** 追加一条记录到指定 scope 的存储文件 */
export async function appendRecord(
  record: KnowledgeRecord,
  scope: KnowledgeScope,
  cwd: string
): Promise<void> {
  const filePath = scope === "system" ? getSystemStorePath() : getProjectStorePath(cwd);
  const store = await readStore(filePath);
  store.errors.push(record);
  await writeStore(filePath, store);
}

/** 生成唯一 ID：err_<时间戳后6位>_<随机4位> */
export function generateId(): string {
  const ts = Date.now().toString().slice(-6);
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `err_${ts}_${rand}`;
}
