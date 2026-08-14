import type {
  CapabilityFlagId,
  CapabilityFlagSubject,
} from "../features/capability-flags";
import type { MessageKey } from "../lib/i18n";

const flagNameKeys = {
  stream_transport_v2: "capabilityFlagStreamTransport",
  router_query_hydration_v1: "capabilityFlagRouterQueryHydration",
  server_table_v2: "capabilityFlagServerTable",
  virtual_transcript_v1: "capabilityFlagVirtualTranscript",
  provider_capabilities_v2: "capabilityFlagProviderCapabilities",
  reasoning_policy_v1: "capabilityFlagReasoningPolicy",
  content_firewall_v2: "capabilityFlagContentFirewall",
  knowledge_acl_v2: "capabilityFlagKnowledgeAcl",
  multimodal_parts_v2: "capabilityFlagMultimodalParts",
  image_jobs_v2: "capabilityFlagImageJobs",
  realtime_voice_v1: "capabilityFlagRealtimeVoice",
  compute_artifacts_v1: "capabilityFlagComputeArtifacts",
  compare_consensus_v1: "capabilityFlagCompareConsensus",
  trust_plane_v1: "capabilityFlagTrustPlane",
} satisfies Record<CapabilityFlagId, MessageKey>;

export type CapabilityFlagAllowlistError = "duplicate" | "invalid" | "too_many";

export type CapabilityFlagAllowlistResult =
  | { ok: true; subjects: CapabilityFlagSubject[] }
  | { ok: false; error: CapabilityFlagAllowlistError };

export function capabilityFlagNameKey(flagId: CapabilityFlagId): MessageKey {
  return flagNameKeys[flagId];
}

export function parseCapabilityFlagAllowlist(
  value: string,
): CapabilityFlagAllowlistResult {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length > 100) return { ok: false, error: "too_many" };

  const seen = new Set<string>();
  const subjects: CapabilityFlagSubject[] = [];
  for (const line of lines) {
    const separator = line.indexOf(":");
    const subjectType = line.slice(0, separator);
    const subjectId = line.slice(separator + 1).trim();
    if (
      separator < 1 ||
      (subjectType !== "user" && subjectType !== "service_account") ||
      subjectId.length === 0 ||
      subjectId.length > 300 ||
      /[\u0000-\u001f\u007f]/u.test(subjectId)
    )
      return { ok: false, error: "invalid" };
    const key = `${subjectType}\u001f${subjectId}`;
    if (seen.has(key)) return { ok: false, error: "duplicate" };
    seen.add(key);
    subjects.push({ subjectId, subjectType });
  }
  return { ok: true, subjects };
}

export function formatCapabilityFlagAllowlist(
  subjects: CapabilityFlagSubject[],
): string {
  return subjects
    .map((subject) => `${subject.subjectType}:${subject.subjectId}`)
    .join("\n");
}
