import { eventBus } from "../events/index.js";
import type { AppEvents } from "../types.js";

export type HookTiming = "before" | "after";

interface HookRegistration {
  event: keyof AppEvents;
  handler: (data: unknown) => void | Promise<void>;
  unsubscribe: () => void;
}

class HookRunner {
  private registrations: HookRegistration[] = [];

  register<K extends keyof AppEvents>(
    event: K,
    handler: (data: AppEvents[K]) => void | Promise<void>
  ): void {
    const unsubscribe = eventBus.on(event, handler);
    this.registrations.push({ event, handler: handler as (data: unknown) => void, unsubscribe });
  }

  unregisterAll(): void {
    for (const reg of this.registrations) {
      reg.unsubscribe();
    }
    this.registrations = [];
  }
}

export const hookRunner = new HookRunner();
