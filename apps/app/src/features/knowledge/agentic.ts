import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export interface AgenticRagSettings {
  enabled: boolean;
  userMode: "optional" | "required";
}

export async function getAgenticRagSettings(): Promise<AgenticRagSettings> {
  configureBrowserApiClients();
  const headers = new Headers({
    "x-request-id": crypto.randomUUID(),
  });
  const response = await fetch("/api/v1/knowledge/agentic", {
    credentials: "same-origin",
    headers,
  });
  const payload = (await response.json().catch(() => undefined)) as
    | { data?: AgenticRagSettings; error?: { message?: string } }
    | undefined;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? response.statusText);
  }
  if (payload?.data === undefined) {
    throw new Error("The agentic RAG settings response was empty.");
  }
  return payload.data;
}
