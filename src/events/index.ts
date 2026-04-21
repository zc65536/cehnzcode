import type { AppEvents } from "../types.js";

type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on<K extends keyof AppEvents>(event: K, handler: EventHandler<AppEvents[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);

    return () => {
      this.handlers.get(event)?.delete(handler as EventHandler);
    };
  }

  async emit<K extends keyof AppEvents>(event: K, data: AppEvents[K]): Promise<void> {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    const promises = [...handlers].map((handler) => handler(data));
    await Promise.allSettled(promises);
  }

  off<K extends keyof AppEvents>(event: K, handler: EventHandler<AppEvents[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();
export type { EventHandler };
