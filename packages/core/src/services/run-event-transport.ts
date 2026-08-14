import { InMemoryRealtimeEventBus } from "./realtime-event-bus";

export interface RunEventNotice {
  runId: string;
  sequence: number;
}

export interface RunEventTransport {
  publish(notice: RunEventNotice): Promise<void>;
  subscribe(
    runId: string,
    handler: (notice: RunEventNotice) => void,
  ): Promise<() => void>;
  close?(): void;
}

export class InMemoryRunEventTransport implements RunEventTransport {
  private readonly events = new InMemoryRealtimeEventBus<RunEventNotice>();

  async publish(notice: RunEventNotice): Promise<void> {
    this.events.publish(notice.runId, notice);
  }

  async subscribe(
    runId: string,
    handler: (notice: RunEventNotice) => void,
  ): Promise<() => void> {
    return this.events.subscribe(runId, handler);
  }
}
