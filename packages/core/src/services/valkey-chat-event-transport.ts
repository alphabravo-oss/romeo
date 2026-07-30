import { ChatEventSchema } from "@romeo/contracts";
import {
  GlideClient,
  GlideClientConfiguration,
  type PubSubMsg,
} from "@valkey/valkey-glide";

import { InMemoryRealtimeEventBus } from "./realtime-event-bus";
import {
  type ChatChangedEvent,
  type ChatEventTransport,
} from "./chat-event-transport";
import {
  ValkeyGlideClient,
  type ValkeyValue,
  valkeyGlideConfiguration,
} from "./valkey-glide-client";

const persistAndPublishScript = `
redis.call("RPUSH", KEYS[1], ARGV[1])
redis.call("LTRIM", KEYS[1], -tonumber(ARGV[2]), -1)
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[3]))
return redis.call("PUBLISH", KEYS[2], ARGV[1])
`;

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

export class ValkeyChatEventTransport implements ChatEventTransport {
  private readonly commandClient: ValkeyCommandClient;
  private readonly events = new InMemoryRealtimeEventBus<ChatChangedEvent>();
  private readonly subscriberFactory: SubscriberFactory;
  private subscriberPromise: Promise<CloseableSubscriber> | undefined;

  constructor(
    private readonly options: {
      historyTtlSeconds?: number;
      keyPrefix: string;
      maxHistory?: number;
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

  async publish(channel: string, event: ChatChangedEvent): Promise<void> {
    const payload = JSON.stringify(event);
    await this.commandClient.command([
      "EVAL",
      persistAndPublishScript,
      "2",
      this.historyKey(channel),
      this.pubSubChannel(channel),
      payload,
      String(this.options.maxHistory ?? 1_000),
      String(this.options.historyTtlSeconds ?? 86_400),
    ]);
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
    try {
      await this.subscriber();
      if (options.afterEventId !== undefined) {
        const history = await this.commandClient.command([
          "LRANGE",
          this.historyKey(channel),
          "0",
          "-1",
        ]);
        const events = parseHistory(history);
        const index = events.findIndex(
          (event) => event.id === options.afterEventId,
        );
        for (const event of events.slice(index < 0 ? 0 : index + 1)) {
          deliver(event);
        }
      }
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
      `${this.options.keyPrefix}:pub:*`,
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
    const prefix = `${this.options.keyPrefix}:pub:`;
    const channel = glideString(message.channel);
    if (!channel.startsWith(prefix)) return;
    const event = parseChangedEvent(glideString(message.message));
    if (event === undefined) return;
    this.events.publish(channel.slice(prefix.length), event);
  }

  private historyKey(channel: string): string {
    return `${this.options.keyPrefix}:history:${channel}`;
  }

  private pubSubChannel(channel: string): string {
    return `${this.options.keyPrefix}:pub:${channel}`;
  }
}

function parseHistory(value: ValkeyValue): ChatChangedEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const event = parseChangedEvent(item);
    return event === undefined ? [] : [event];
  });
}

function parseChangedEvent(value: string): ChatChangedEvent | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    const result = ChatEventSchema.safeParse(parsed);
    if (!result.success || result.data.type !== "changed") return undefined;
    return result.data;
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
