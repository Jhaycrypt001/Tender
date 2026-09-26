import type { Redis } from "ioredis";
import { channelFor, type InvoiceEventWire } from "./events.js";

type Listener = (event: InvoiceEventWire) => void;

/**
 * Fans invoice events from Redis out to SSE connections in this process.
 *
 * One Redis subscriber connection serves every open stream: channels are
 * subscribed when the first viewer of an invoice connects and dropped when the
 * last one leaves. The poller can run in another process; Redis carries the
 * event between them.
 */
export class InvoiceStream {
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly subscriber: Redis) {
    subscriber.on("message", (channel: string, message: string) => {
      const set = this.listeners.get(channel);
      if (!set) return;
      let event: InvoiceEventWire;
      try {
        event = JSON.parse(message) as InvoiceEventWire;
      } catch {
        return;
      }
      for (const listener of set) listener(event);
    });
  }

  /** Subscribes to one invoice. Resolves once Redis confirms, so no event is missed after it. */
  async subscribe(token: string, listener: Listener): Promise<() => Promise<void>> {
    const channel = channelFor(token);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      await this.subscriber.subscribe(channel);
    }
    set.add(listener);

    return async () => {
      const current = this.listeners.get(channel);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(channel);
        await this.subscriber.unsubscribe(channel).catch(() => {});
      }
    };
  }

  /** Open channels, for tests and metrics. */
  get size(): number {
    return this.listeners.size;
  }
}
