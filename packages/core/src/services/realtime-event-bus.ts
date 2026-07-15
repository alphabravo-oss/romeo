export type RealtimeEventHandler<T> = (event: T) => void;

export class InMemoryRealtimeEventBus<T> {
  private readonly subscribers = new Map<
    string,
    Set<RealtimeEventHandler<T>>
  >();

  subscribe(channel: string, handler: RealtimeEventHandler<T>): () => void {
    const existing = this.subscribers.get(channel) ?? new Set();
    existing.add(handler);
    this.subscribers.set(channel, existing);

    return () => {
      const handlers = this.subscribers.get(channel);
      if (handlers === undefined) return;
      handlers.delete(handler);
      if (handlers.size === 0) this.subscribers.delete(channel);
    };
  }

  publish(channel: string, event: T): void {
    const handlers = this.subscribers.get(channel);
    if (handlers === undefined) return;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch {
        // Subscriber failures must not fail the mutation that produced the event.
      }
    }
  }
}
