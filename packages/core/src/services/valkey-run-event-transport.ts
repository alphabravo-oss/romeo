import {
  GlideClient,
  GlideClientConfiguration,
  type PubSubMsg,
} from "@valkey/valkey-glide";

import { InMemoryRealtimeEventBus } from "./realtime-event-bus";
import type { RunEventNotice, RunEventTransport } from "./run-event-transport";
import {
  ValkeyGlideClient,
  type ValkeyValue,
  valkeyGlideConfiguration,
} from "./valkey-glide-client";

interface ValkeyCommandClient {
  command(args: string[]): Promise<ValkeyValue>;
}

interface CloseableSubscriber {
  close(): void;
}

type SubscriberFactory = (
  pattern: string,
  onMessage: (message: PubSubMsg) => void,
) => Promise<CloseableSubscriber>;

export class ValkeyRunEventTransport implements RunEventTransport {
  private readonly commandClient: ValkeyCommandClient;
  private readonly events = new InMemoryRealtimeEventBus<RunEventNotice>();
  private readonly subscriberFactory: SubscriberFactory;
  private subscriberPromise: Promise<CloseableSubscriber> | undefined;

  constructor(
    private readonly options: {
      keyPrefix: string;
      timeoutMs: number;
      url: string;
      commandClient?: ValkeyCommandClient;
      subscriberFactory?: SubscriberFactory;
    },
  ) {
    this.commandClient =
      options.commandClient ??
      new ValkeyGlideClient({ timeoutMs: options.timeoutMs, url: options.url });
    this.subscriberFactory =
      options.subscriberFactory ??
      ((pattern, onMessage) =>
        GlideClient.createClient({
          ...valkeyGlideConfiguration({
            timeoutMs: options.timeoutMs,
            url: options.url,
          }),
          pubsubSubscriptions: {
            channelsAndPatterns: {
              [GlideClientConfiguration.PubSubChannelModes.Pattern]: new Set([
                pattern,
              ]),
            },
            callback: onMessage,
          },
        }));
  }

  async publish(notice: RunEventNotice): Promise<void> {
    await this.commandClient.command([
      "PUBLISH",
      this.channel(notice.runId),
      JSON.stringify(notice),
    ]);
  }

  async subscribe(
    runId: string,
    handler: (notice: RunEventNotice) => void,
  ): Promise<() => void> {
    const unsubscribe = this.events.subscribe(runId, handler);
    try {
      await this.subscriber();
      return unsubscribe;
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  close(): void {
    const subscriber = this.subscriberPromise;
    this.subscriberPromise = undefined;
    if (subscriber !== undefined) {
      void subscriber.then((client) => client.close()).catch(() => undefined);
    }
    if (this.commandClient instanceof ValkeyGlideClient) {
      this.commandClient.close();
    }
  }

  private subscriber(): Promise<CloseableSubscriber> {
    if (this.subscriberPromise !== undefined) return this.subscriberPromise;
    const pending = this.subscriberFactory(
      `${this.options.keyPrefix}:*`,
      (message) => this.onMessage(message),
    );
    this.subscriberPromise = pending;
    void pending.catch(() => {
      if (this.subscriberPromise === pending)
        this.subscriberPromise = undefined;
    });
    return pending;
  }

  private onMessage(message: PubSubMsg): void {
    const channel = glideString(message.channel);
    const prefix = `${this.options.keyPrefix}:`;
    if (!channel.startsWith(prefix)) return;
    const notice = parseNotice(glideString(message.message));
    if (notice === undefined || notice.runId !== channel.slice(prefix.length))
      return;
    this.events.publish(notice.runId, notice);
  }

  private channel(runId: string): string {
    return `${this.options.keyPrefix}:${runId}`;
  }
}

function parseNotice(value: string): RunEventNotice | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("runId" in parsed) ||
      typeof parsed.runId !== "string" ||
      !("sequence" in parsed) ||
      !Number.isSafeInteger(parsed.sequence) ||
      (parsed.sequence as number) < 1
    ) {
      return undefined;
    }
    return { runId: parsed.runId, sequence: parsed.sequence as number };
  } catch {
    return undefined;
  }
}

function glideString(
  value: PubSubMsg["channel"] | PubSubMsg["message"],
): string {
  return typeof value === "string"
    ? value
    : Buffer.from(value).toString("utf8");
}
