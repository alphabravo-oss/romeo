import {
  capabilityIds,
  type CapabilityId,
} from "./capability-definition-registry";

export type CapabilityConsumerKind =
  | "http"
  | "compatibility_http"
  | "service"
  | "worker"
  | "preview";

export interface CapabilityConsumerRegistration {
  capabilityId: CapabilityId;
  consumers: Array<{
    id: string;
    kind: CapabilityConsumerKind;
    enforcementPoint: string;
  }>;
  owner: string;
}

const registrations = {
  image_generation: {
    owner: "ai-runtime",
    consumers: [
      {
        id: "POST /api/v1/images/generations",
        kind: "http",
        enforcementPoint: "ImageGenerationService.generate",
      },
    ],
  },
  reasoning_policy: {
    owner: "ai-runtime",
    consumers: [
      {
        id: "native run start and continuation",
        kind: "service",
        enforcementPoint: "resolveReasoningPolicy",
      },
      {
        id: "OpenAI-compatible chat completions",
        kind: "compatibility_http",
        enforcementPoint: "OpenAiChatCompletionsService",
      },
    ],
  },
  voice_processing: {
    owner: "ai-runtime",
    consumers: [
      {
        id: "voice catalog, transcription, and synthesis",
        kind: "service",
        enforcementPoint: "authorizeVoiceProcessing",
      },
    ],
  },
  web_retrieval: {
    owner: "ai-runtime",
    consumers: [
      {
        id: "web search and governed URL retrieval",
        kind: "service",
        enforcementPoint: "authorizeWebRetrieval",
      },
    ],
  },
  content_firewall: {
    owner: "security",
    consumers: [
      {
        id: "native and compatibility inference output",
        kind: "service",
        enforcementPoint: "RunOutputPolicyGate",
      },
      {
        id: "POST /api/v1/admin/content-policy/output-buffer/evaluate",
        kind: "preview",
        enforcementPoint: "authorizeGenericCapability",
      },
    ],
  },
  knowledge_acl: {
    owner: "knowledge",
    consumers: [
      {
        id: "POST /api/v1/knowledge/acl/prefilter",
        kind: "preview",
        enforcementPoint: "authorizeGenericCapability",
      },
      {
        id: "POST /api/v1/knowledge/acl/freshness",
        kind: "preview",
        enforcementPoint: "authorizeGenericCapability",
      },
    ],
  },
  realtime_voice: {
    owner: "ai-runtime",
    consumers: [
      {
        id: "POST /api/v1/realtime/sessions",
        kind: "http",
        enforcementPoint: "CapabilityService.resolve",
      },
      {
        id: "POST /api/v1/realtime/adapters/preview",
        kind: "preview",
        enforcementPoint: "authorizeGenericCapability",
      },
    ],
  },
  image_editing: {
    owner: "ai-runtime",
    consumers: [
      {
        id: "POST /api/v1/images/jobs",
        kind: "http",
        enforcementPoint: "CapabilityService.resolve",
      },
    ],
  },
  secure_compute: {
    owner: "compute",
    consumers: [
      {
        id: "POST /api/v1/compute/jobs",
        kind: "http",
        enforcementPoint: "CapabilityService.resolve",
      },
    ],
  },
  multi_model_compare: {
    owner: "ai-runtime",
    consumers: [
      {
        id: "POST /api/v1/run-groups",
        kind: "http",
        enforcementPoint: "CapabilityService.resolve",
      },
      {
        id: "POST /api/v1/run-groups/synthesis/preview",
        kind: "preview",
        enforcementPoint: "authorizeGenericCapability",
      },
    ],
  },
  tenant_encryption: {
    owner: "security",
    consumers: [
      {
        id: "POST /api/v1/admin/trust/crypto/shred",
        kind: "preview",
        enforcementPoint: "authorizeGenericCapability",
      },
    ],
  },
  data_export: {
    owner: "governance",
    consumers: [
      {
        id: "governance export preview, execute, package, and CSV surfaces",
        kind: "service",
        enforcementPoint: "authorizeDataExport",
      },
    ],
  },
} as const satisfies Record<
  CapabilityId,
  Omit<CapabilityConsumerRegistration, "capabilityId">
>;

export function listCapabilityConsumerRegistrations(): CapabilityConsumerRegistration[] {
  return capabilityIds.map((capabilityId) => {
    const registration = registrations[capabilityId];
    return {
      capabilityId,
      owner: registration.owner,
      consumers: registration.consumers.map((consumer) => ({ ...consumer })),
    };
  });
}
