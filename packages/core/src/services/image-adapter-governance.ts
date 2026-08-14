export type ImageAdapterKind = "openai_compatible" | "comfyui";

export function authorizeImageAdapter(input: {
  kind: ImageAdapterKind;
  egressAllowed: boolean;
  workflowAllowlisted: boolean;
}):
  | { outcome: "accepted"; kind: ImageAdapterKind }
  | { outcome: "denied"; code: "capability_platform_disabled" | "compute_egress_denied" } {
  if (!input.egressAllowed)
    return { outcome: "denied", code: "compute_egress_denied" };
  if (input.kind === "comfyui" && !input.workflowAllowlisted)
    return { outcome: "denied", code: "capability_platform_disabled" };
  return { outcome: "accepted", kind: input.kind };
}

export function authorizeImageProcessing(input: {
  pixels: number;
  frames: number;
  memoryBytes: number;
  metadataStripped: boolean;
  malwareClean: boolean;
  watermarkRequired: boolean;
  watermarkApplied: boolean;
}):
  | { outcome: "accepted" }
  | { outcome: "denied"; code: "file_image_dimensions_exceeded" | "file_malware_detected" } {
  if (input.pixels > 100_000_000 || input.frames > 1 || input.memoryBytes > 256_000_000)
    return { outcome: "denied", code: "file_image_dimensions_exceeded" };
  if (!input.malwareClean)
    return { outcome: "denied", code: "file_malware_detected" };
  if (input.watermarkRequired && !input.watermarkApplied)
    return { outcome: "denied", code: "file_image_dimensions_exceeded" };
  void input.metadataStripped;
  return { outcome: "accepted" };
}

export function describeAccessibleImageEdit(input: {
  hasPointer: boolean;
  maskUploaded: boolean;
  crop: boolean;
  rotateDegrees: number;
}): {
  keyboardMaskPath: boolean;
  nonDestructive: true;
  rotateDegrees: number;
  crop: boolean;
} {
  return {
    keyboardMaskPath: !input.hasPointer || input.maskUploaded,
    nonDestructive: true,
    rotateDegrees: ((input.rotateDegrees % 360) + 360) % 360,
    crop: input.crop,
  };
}

export function projectImageJobToChatPart(input: {
  fileId: string;
  prompt: string;
  modelId: string;
  seed?: number;
  costMicroUsd: number;
  bytesInline?: boolean;
}):
  | {
      outcome: "accepted";
      part: {
        type: "image_ref";
        fileId: string;
        altText: string;
        provenance: { modelId: string; seed?: number; costMicroUsd: number };
      };
    }
  | { outcome: "denied"; code: "file_not_ready" } {
  if (input.bytesInline === true || input.fileId.length === 0)
    return { outcome: "denied", code: "file_not_ready" };
  return {
    outcome: "accepted",
    part: {
      type: "image_ref",
      fileId: input.fileId,
      altText: input.prompt.slice(0, 300),
      provenance: {
        modelId: input.modelId,
        costMicroUsd: Math.max(0, input.costMicroUsd),
        ...(input.seed === undefined ? {} : { seed: input.seed }),
      },
    },
  };
}

export function authorizeImageArtifactGovernance(input: {
  legalHold: boolean;
  retentionAllowsDelete: boolean;
  dlpBlocked: boolean;
  accessAuthorized: boolean;
}):
  | { outcome: "accepted"; shred: boolean }
  | { outcome: "denied"; code: "chat_delete_legal_hold" | "content_policy_blocked" | "file_part_access_denied" } {
  if (input.legalHold)
    return { outcome: "denied", code: "chat_delete_legal_hold" };
  if (input.dlpBlocked)
    return { outcome: "denied", code: "content_policy_blocked" };
  if (!input.accessAuthorized)
    return { outcome: "denied", code: "file_part_access_denied" };
  return { outcome: "accepted", shred: input.retentionAllowsDelete };
}
