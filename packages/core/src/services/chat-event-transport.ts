import type { ChatEvent } from "@romeo/contracts";

import { InMemoryRealtimeEventBus } from "./realtime-event-bus";

export type ChatChangedEvent = Extract<ChatEvent, { type: "changed" }>;

export interface ChatEventTransport {
  publish(channel: string, event: ChatChangedEvent): Promise<void>;
  subscribe(
    channel: string,
    handler: (event: ChatChangedEvent) => void,
    options?: { afterEventId?: string },
  ): Promise<() => void>;
}

/**
 * Development and test transport with bounded replay semantics matching the
 * distributed transport. Production deployments should use Valkey.
 */
export class InMemoryChatEventTransport implements ChatEventTransport {
  private readonly events = new InMemoryRealtimeEventBus<ChatChangedEvent>();
  private readonly history = new Map<string, ChatChangedEvent[]>();

  constructor(private readonly maxHistory = 1_000) {}

  async publish(channel: string, event: ChatChangedEvent): Promise<void> {
    const history = this.history.get(channel) ?? [];
    history.push(event);
    if (history.length > this.maxHistory) {
      history.splice(0, history.length - this.maxHistory);
    }
    this.history.set(channel, history);
    this.events.publish(channel, event);
  }

  async subscribe(
    channel: string,
    handler: (event: ChatChangedEvent) => void,
    options: { afterEventId?: string } = {},
  ): Promise<() => void> {
    const delivered = new Set<string>();
    const deliver = (event: ChatChangedEvent) => {
      if (delivered.has(event.id)) return;
      delivered.add(event.id);
      handler(event);
    };
    const unsubscribe = this.events.subscribe(channel, deliver);
    if (options.afterEventId !== undefined) {
      const history = this.history.get(channel) ?? [];
      const index = history.findIndex(
        (event) => event.id === options.afterEventId,
      );
      for (const event of history.slice(index < 0 ? 0 : index + 1)) {
        deliver(event);
      }
    }
    return unsubscribe;
  }
}
