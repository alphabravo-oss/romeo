import { client } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export type ChatEventStreamStatus = "connected" | "connecting" | "degraded";

interface ChatEventSource {
  addEventListener(type: string, listener: EventListener): void;
  close(): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export type ChatEventSourceFactory = (url: string) => ChatEventSource;

export function subscribeToChatEvents(
  workspaceId: string,
  onChange: () => void,
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
  const onChanged: EventListener = () => onChange();
  const onOpen: EventListener = () => options.onStatus?.("connected");
  const onError: EventListener = () => options.onStatus?.("degraded");
  source.addEventListener("chats:changed", onChanged);
  source.addEventListener("open", onOpen);
  source.addEventListener("error", onError);
  return () => {
    source.removeEventListener("chats:changed", onChanged);
    source.removeEventListener("open", onOpen);
    source.removeEventListener("error", onError);
    source.close();
  };
}
