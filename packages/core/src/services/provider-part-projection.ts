export const PROJECTABLE_PART_TYPES = [
  "text",
  "image_ref",
  "audio_ref",
  "document_ref",
  "video_ref",
] as const;
export type ProjectablePartType = (typeof PROJECTABLE_PART_TYPES)[number];

export type PartProjectionFallback = "ocr" | "stt" | "keyframes";

export function projectProviderParts(input: {
  parts: Array<{ type: ProjectablePartType; bytes?: number }>;
  supported: ReadonlySet<ProjectablePartType>;
  fallbacks: Partial<Record<ProjectablePartType, PartProjectionFallback>>;
}):
  | {
      outcome: "projected";
      accepted: ProjectablePartType[];
      transformed: Array<{
        type: ProjectablePartType;
        fallback: PartProjectionFallback;
      }>;
    }
  | { outcome: "denied"; code: "unsupported_part"; type: ProjectablePartType } {
  const accepted: ProjectablePartType[] = [];
  const transformed: Array<{
    type: ProjectablePartType;
    fallback: PartProjectionFallback;
  }> = [];
  for (const part of input.parts) {
    if (input.supported.has(part.type)) {
      accepted.push(part.type);
      continue;
    }
    const fallback = input.fallbacks[part.type];
    if (fallback === undefined)
      return { outcome: "denied", code: "unsupported_part", type: part.type };
    transformed.push({ type: part.type, fallback });
  }
  return { outcome: "projected", accepted, transformed };
}

export function authorizeMediaQuota(input: {
  counts: number;
  bytes: number;
  pixels?: number;
  durationSeconds?: number;
  pages?: number;
  limits: {
    maxCounts: number;
    maxBytes: number;
    maxPixels?: number;
    maxDurationSeconds?: number;
    maxPages?: number;
  };
}):
  | { outcome: "accepted" }
  | {
      outcome: "denied";
      code: "media_quota_exceeded";
      dimension: "counts" | "bytes" | "pixels" | "duration" | "pages";
    } {
  if (input.counts > input.limits.maxCounts)
    return { outcome: "denied", code: "media_quota_exceeded", dimension: "counts" };
  if (input.bytes > input.limits.maxBytes)
    return { outcome: "denied", code: "media_quota_exceeded", dimension: "bytes" };
  if (
    input.limits.maxPixels !== undefined &&
    (input.pixels ?? 0) > input.limits.maxPixels
  )
    return { outcome: "denied", code: "media_quota_exceeded", dimension: "pixels" };
  if (
    input.limits.maxDurationSeconds !== undefined &&
    (input.durationSeconds ?? 0) > input.limits.maxDurationSeconds
  )
    return {
      outcome: "denied",
      code: "media_quota_exceeded",
      dimension: "duration",
    };
  if (
    input.limits.maxPages !== undefined &&
    (input.pages ?? 0) > input.limits.maxPages
  )
    return { outcome: "denied", code: "media_quota_exceeded", dimension: "pages" };
  return { outcome: "accepted" };
}

export function issueFilePartAccess(input: {
  authorized: boolean;
  revoked: boolean;
  ttlSeconds: number;
  maxTtlSeconds?: number;
}):
  | {
      outcome: "accepted";
      ttlSeconds: number;
      contentDisposition: "attachment";
    }
  | {
      outcome: "denied";
      code: "file_part_access_denied" | "file_part_revoked";
    } {
  if (input.revoked) return { outcome: "denied", code: "file_part_revoked" };
  if (!input.authorized)
    return { outcome: "denied", code: "file_part_access_denied" };
  const maxTtl = input.maxTtlSeconds ?? 300;
  return {
    outcome: "accepted",
    ttlSeconds: Math.min(Math.max(input.ttlSeconds, 1), maxTtl),
    contentDisposition: "attachment",
  };
}
