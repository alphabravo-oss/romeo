import { client } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export function subscribeToChatEvents(
  workspaceId: string,
  onChange: () => void,
): () => void {
  configureBrowserApiClients();
  const source = new EventSource(
    client.buildUrl({
      url: "/workspaces/{workspaceId}/chat-events",
      path: { workspaceId },
    }),
  );
  source.addEventListener("chats:changed", onChange);
  return () => {
    source.removeEventListener("chats:changed", onChange);
    source.close();
  };
}
