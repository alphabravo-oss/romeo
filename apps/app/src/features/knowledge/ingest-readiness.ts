import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export type KnowledgeIngestBlockReason =
  | "embedding_unset"
  | "tiers_disabled"
  | "vector_unconfigured";

export interface KnowledgeIngestReadiness {
  ready: boolean;
  reason?: KnowledgeIngestBlockReason;
}

export async function getKnowledgeIngestReadiness(): Promise<KnowledgeIngestReadiness> {
  configureBrowserApiClients();
  const headers = new Headers({
    "x-request-id": crypto.randomUUID(),
  });
  const response = await fetch("/api/v1/knowledge/ingest-readiness", {
    credentials: "same-origin",
    headers,
  });
  const payload = (await response.json().catch(() => undefined)) as
    | { data?: KnowledgeIngestReadiness; error?: { message?: string } }
    | undefined;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? response.statusText);
  }
  if (payload?.data === undefined) {
    throw new Error("The knowledge ingest readiness response was empty.");
  }
  return payload.data;
}
