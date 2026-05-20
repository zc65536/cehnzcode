import { createChildLogger } from "../logger/index.js";
import type { HookDataMap, HookResult, ListenerDataMap } from "../types.js";

const logger = createChildLogger("hooks");

type AnyInterceptor = (data: unknown) => Promise<HookResult<unknown>>;
type AnyListener = (data: unknown) => void | Promise<void>;

/** run() 的返回：要么拿到（可能被修改过的）数据，要么拿到取消信号 */
export type RunResult<T> =
  | { cancelled: false; data: T }
  | { cancelled: true; reason: string };

class HookRunner {
  // 同一节点可注册多个拦截器，按注册顺序瀑布执行
  private interceptors = new Map<string, AnyInterceptor[]>();
  // 同一节点可注册多个监听，并行触发
  private listeners = new Map<string, AnyListener[]>();

  /** 注册可干预拦截器，返回注销函数 */
  intercept<K extends keyof HookDataMap>(
    event: K,
    handler: (data: HookDataMap[K]) => Promise<HookResult<HookDataMap[K]>>
  ): () => void {
    if (!this.interceptors.has(event)) {
      this.interceptors.set(event, []);
    }
    const list = this.interceptors.get(event)!;
    list.push(handler as AnyInterceptor);
    return () => {
      const idx = list.indexOf(handler as AnyInterceptor);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /** 注册纯观察监听，返回注销函数 */
  listen<K extends keyof ListenerDataMap>(
    event: K,
    handler: (data: ListenerDataMap[K]) => void | Promise<void>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    const list = this.listeners.get(event)!;
    list.push(handler as AnyListener);
    return () => {
      const idx = list.indexOf(handler as AnyListener);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /**
   * 瀑布执行拦截器链：
   * - 每个 handler 拿到上一个 handler 修改后的数据
   * - 任一 handler 返回 cancel → 立即终止，整条链返回 cancelled: true
   * - 全部跑完 → 返回最终数据
   */
  async run<K extends keyof HookDataMap>(
    event: K,
    data: HookDataMap[K]
  ): Promise<RunResult<HookDataMap[K]>> {
    const handlers = this.interceptors.get(event) ?? [];
    let current = data;

    for (const handler of handlers) {
      let result: HookResult<unknown>;
      try {
        result = await handler(current);
      } catch (err) {
        // handler 抛异常等同于 cancel，避免单个 handler 崩溃影响主流程
        const reason = (err as Error).message ?? "Unknown error in hook handler";
        logger.warn({ event, reason }, "Hook handler threw, treating as cancel");
        return { cancelled: true, reason };
      }

      if (result.action === "cancel") {
        logger.debug({ event, reason: result.reason }, "Hook cancelled");
        return { cancelled: true, reason: result.reason };
      }
      if (result.action === "modify") {
        current = result.data as HookDataMap[K];
      }
      // action === "continue"：current 不变，继续下一个 handler
    }

    return { cancelled: false, data: current };
  }

  /** 并行触发所有观察监听，单个 handler 报错只记日志，不影响其他 handler */
  async notify<K extends keyof ListenerDataMap>(
    event: K,
    data: ListenerDataMap[K]
  ): Promise<void> {
    const handlers = this.listeners.get(event) ?? [];
    const results = await Promise.allSettled(handlers.map((h) => h(data)));
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn({ event, error: (result.reason as Error).message }, "Listener threw, ignored");
      }
    }
  }

  /** 注销所有已注册的 handler，供测试和插件卸载使用 */
  unregisterAll(): void {
    this.interceptors.clear();
    this.listeners.clear();
  }
}

export const hookRunner = new HookRunner();
export type { HookRunner };
