import { client } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export type ChatEventStreamStatus = "connected" | "connecting" | "degraded";
export interface ChatChangedEvent {
  action: string;
  chatId: string;
  createdAt: string;
  id: string;
  type: "changed";
  workspaceId: string;
}

interface ChatEventSource {
  addEventListener(type: string, listener: EventListener): void;
  close(): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export type ChatEventSourceFactory = (url: string) => ChatEventSource;

export function subscribeToChatEvents(
  workspaceId: string,
  onChange: (event?: ChatChangedEvent) => void,
  options: {
    createEventSource?: ChatEventSourceFactory;
    onStatus?: (status: ChatEventStreamStatus) => void;
  } = {},
): () => void {
  configureBrowserApiClients();
  options.onStatus?.("connecting");
  const createEventSource =
    options.createEventSource ??
    ((url: string) => new EventSource(url) as ChatEventSource);
  const source = createEventSource(
    client.buildUrl({
      url: "/workspaces/{workspaceId}/chat-events",
      path: { workspaceId },
    }),
  );
  const onChanged: EventListener = (event) => {
    const parsed = parseChangedEvent(event);
    onChange(parsed);
  };
  const onConnected: EventListener = () => onChange();
  const onOpen: EventListener = () => {
    options.onStatus?.("connected");
    // A mutation can land after the initial list fetch but before the stream
    // is established. Reconcile when the browser confirms the connection so
    // that startup window cannot leave the sidebar stale.
    onChange();
  };
  const onError: EventListener = () => options.onStatus?.("degraded");
  source.addEventListener("chats:changed", onChanged);
  source.addEventListener("chats:connected", onConnected);
  source.addEventListener("open", onOpen);
  source.addEventListener("error", onError);
  return () => {
    source.removeEventListener("chats:changed", onChanged);
    source.removeEventListener("chats:connected", onConnected);
    source.removeEventListener("open", onOpen);
    source.removeEventListener("error", onError);
    source.close();
  };
}

function parseChangedEvent(event: Event): ChatChangedEvent | undefined {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(event.data);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.type !== "changed" ||
      typeof candidate.id !== "string" ||
      typeof candidate.action !== "string" ||
      typeof candidate.chatId !== "string" ||
      typeof candidate.workspaceId !== "string" ||
      typeof candidate.createdAt !== "string"
    ) {
      return undefined;
    }
    return candidate as unknown as ChatChangedEvent;
  } catch {
    return undefined;
  }
}
