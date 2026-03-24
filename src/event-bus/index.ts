import { getSubsystemLogger } from "../logger/logger.js";

type Handler<T = unknown> = (payload: T) => void | Promise<void>;
type Unsubscribe = () => void;

export const TOPPIC_HEART_BEAT = "heartbeat";
export const TOPIC_TOOL_BEFORE_BUILD = "tool:before-build";

const logger = getSubsystemLogger("event-bus");

class EventBus {
  private readonly listeners = new Map<string, Set<Handler>>();

  on<T = unknown>(topic: string, handler: Handler<T>): Unsubscribe {
    if (!topic || typeof topic !== "string") {
      throw new Error("topic must be a non-empty string");
    }
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
    }
    set.add(handler as Handler);
    return () => set?.delete(handler as Handler);
  }

  once<T = unknown>(topic: string, handler: Handler<T>): Unsubscribe {
    const wrapper: Handler<T> = async (payload) => {
      unsubscribe();
      await handler(payload);
    };
    const unsubscribe = this.on(topic, wrapper);
    return unsubscribe;
  }

  async emit<T = unknown>(topic: string, payload: T): Promise<void> {
    const handlers = this.listeners.get(topic);
    if (!handlers || handlers.size === 0) return;
    for (const fn of handlers) {
      try {
        // 顺序等待，避免 handler 间竞态；后续如需并行可调整
        // eslint-disable-next-line no-await-in-loop
        await fn(payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("[event-bus] handler error topic=%s msg=%s", topic, msg);
      }
    }
  }

  emitSync<T = unknown>(topic: string, payload: T): void {
    const handlers = this.listeners.get(topic);
    if (!handlers || handlers.size === 0) return;
    for (const fn of handlers) {
      try {
        const maybePromise = fn(payload);
        if (maybePromise && typeof (maybePromise as Promise<void>).then === "function") {
          logger.warn("[event-bus] emitSync got async handler topic=%s", topic);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("[event-bus] handler error topic=%s msg=%s", topic, msg);
      }
    }
  }

  clear(topic?: string): void {
    if (topic) {
      this.listeners.delete(topic);
    } else {
      this.listeners.clear();
    }
  }
}

// 单例实例
const bus = new EventBus();

export function getEventBus(): EventBus {
  return bus;
}

export type { Handler, Unsubscribe };
