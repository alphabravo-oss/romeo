export const OUTPUT_PART_READY_EVENT = "output.part.ready" as const;

export type ProviderOutputPartType =
  | "image"
  | "audio"
  | "citation"
  | "artifact";

export interface ProviderOutputPart {
  type: ProviderOutputPartType;
  bytes?: Uint8Array;
  mediaType?: string;
  durationMs?: number;
  citation?: { sourceId: string; chunkId?: string };
  artifact?: { artifactId: string; version: string };
}

export interface PersistedOutputPartRef {
  type: "image_ref" | "audio_ref" | "citation_ref" | "artifact_ref";
  fileId?: string;
  mediaType?: string;
  durationMs?: number;
  artifactId?: string;
  sourceId?: string;
  documentId?: string;
  chunkId?: string;
  title?: string;
  version?: string;
}

export interface OutputPartReadyEvent {
  type: typeof OUTPUT_PART_READY_EVENT;
  partRef: PersistedOutputPartRef;
}

export class ProviderOutputPartError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ProviderOutputPartError";
    this.code = code;
  }
}

const MAX_PARTS = 16;
const MAX_IMAGE_BYTES = 20_000_000;
const MAX_AUDIO_BYTES = 50_000_000;
const MAX_TOTAL_BYTES = 50_000_000;
const MAX_AUDIO_DURATION_MS = 14_400_000;
const imageMediaTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const audioMediaTypes = new Set([
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);

export function extractProviderOutputParts(
  data: unknown,
): ProviderOutputPart[] {
  if (data === null || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const raw = record.outputParts ?? record.parts;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_PARTS)
    throw new ProviderOutputPartError("provider_output_parts_invalid");
  const parts = raw.map(parsePart);
  const totalBytes = parts.reduce(
    (total, part) => total + (part.bytes?.byteLength ?? 0),
    0,
  );
  if (totalBytes > MAX_TOTAL_BYTES)
    throw new ProviderOutputPartError("provider_output_parts_too_large");
  return parts;
}

export async function persistProviderOutputParts(input: {
  parts: ProviderOutputPart[];
  store: (
    part: Required<Pick<ProviderOutputPart, "bytes" | "mediaType" | "type">> &
      Pick<ProviderOutputPart, "durationMs">,
  ) => Promise<{ fileId: string }>;
  persistPart: (part: PersistedOutputPartRef) => Promise<void>;
  authorizeCitation?: (citation: {
    sourceId: string;
    chunkId?: string;
  }) => Promise<{ documentId: string; title: string } | undefined>;
  authorizeArtifact?: (artifact: {
    artifactId: string;
    version: string;
  }) => Promise<boolean>;
  emit: (event: OutputPartReadyEvent) => void;
}): Promise<{
  persisted: PersistedOutputPartRef[];
  emitted: OutputPartReadyEvent[];
}> {
  const persisted: PersistedOutputPartRef[] = [];
  const emitted: OutputPartReadyEvent[] = [];
  for (const part of input.parts) {
    const stored = await persistOne(part, input);
    await input.persistPart(stored);
    persisted.push(stored);
    const event: OutputPartReadyEvent = {
      type: OUTPUT_PART_READY_EVENT,
      partRef: stored,
    };
    input.emit(event);
    emitted.push(event);
  }
  return { persisted, emitted };
}

async function persistOne(
  part: ProviderOutputPart,
  input: Parameters<typeof persistProviderOutputParts>[0],
): Promise<PersistedOutputPartRef> {
  if (part.type === "citation") {
    if (part.citation === undefined || input.authorizeCitation === undefined)
      throw new ProviderOutputPartError(
        "provider_output_citation_unauthorized",
      );
    const authorized = await input.authorizeCitation(part.citation);
    if (authorized === undefined)
      throw new ProviderOutputPartError(
        "provider_output_citation_unauthorized",
      );
    return {
      type: "citation_ref",
      sourceId: part.citation.sourceId,
      documentId: authorized.documentId,
      title: authorized.title,
      ...(part.citation.chunkId === undefined
        ? {}
        : { chunkId: part.citation.chunkId }),
    };
  }
  if (part.type === "artifact") {
    if (
      part.artifact === undefined ||
      input.authorizeArtifact === undefined ||
      !(await input.authorizeArtifact(part.artifact))
    )
      throw new ProviderOutputPartError(
        "provider_output_artifact_unauthorized",
      );
    return {
      type: "artifact_ref",
      artifactId: part.artifact.artifactId,
      version: part.artifact.version,
    };
  }
  if (part.bytes === undefined || part.mediaType === undefined)
    throw new ProviderOutputPartError("provider_output_part_invalid");
  const stored = await input.store({
    bytes: part.bytes,
    mediaType: part.mediaType,
    type: part.type,
    ...(part.durationMs === undefined ? {} : { durationMs: part.durationMs }),
  });
  return {
    type: part.type === "image" ? "image_ref" : "audio_ref",
    fileId: stored.fileId,
    mediaType: part.mediaType,
    ...(part.durationMs === undefined ? {} : { durationMs: part.durationMs }),
  };
}

function parsePart(value: unknown): ProviderOutputPart {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ProviderOutputPartError("provider_output_part_invalid");
  const part = value as Record<string, unknown>;
  if (part.type === "image" || part.type === "audio")
    return parseBinaryPart(part, part.type);
  if (part.type === "citation") {
    const citation = strictRecord(part.citation);
    if (
      citation === undefined ||
      typeof citation.sourceId !== "string" ||
      citation.sourceId.length === 0 ||
      citation.sourceId.length > 300 ||
      (citation.chunkId !== undefined &&
        (typeof citation.chunkId !== "string" ||
          citation.chunkId.length === 0 ||
          citation.chunkId.length > 300))
    )
      throw new ProviderOutputPartError("provider_output_citation_invalid");
    return {
      type: "citation",
      citation: {
        sourceId: citation.sourceId,
        ...(typeof citation.chunkId === "string"
          ? { chunkId: citation.chunkId }
          : {}),
      },
    };
  }
  if (part.type === "artifact") {
    const artifact = strictRecord(part.artifact);
    if (
      artifact === undefined ||
      typeof artifact.artifactId !== "string" ||
      artifact.artifactId.length === 0 ||
      artifact.artifactId.length > 300 ||
      typeof artifact.version !== "string" ||
      artifact.version.length === 0 ||
      artifact.version.length > 100
    )
      throw new ProviderOutputPartError("provider_output_artifact_invalid");
    return {
      type: "artifact",
      artifact: {
        artifactId: artifact.artifactId,
        version: artifact.version,
      },
    };
  }
  throw new ProviderOutputPartError("provider_output_part_type_unsupported");
}

function parseBinaryPart(
  part: Record<string, unknown>,
  type: "audio" | "image",
): ProviderOutputPart {
  const bytes = part.bytes;
  const mediaType =
    typeof part.mediaType === "string"
      ? part.mediaType.trim().toLowerCase()
      : defaultMediaType(type);
  const allowed = type === "image" ? imageMediaTypes : audioMediaTypes;
  const maxBytes = type === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > maxBytes ||
    !allowed.has(mediaType)
  )
    throw new ProviderOutputPartError("provider_output_part_invalid");
  if (
    type === "audio" &&
    (typeof part.durationMs !== "number" ||
      !Number.isSafeInteger(part.durationMs) ||
      part.durationMs <= 0 ||
      part.durationMs > MAX_AUDIO_DURATION_MS)
  )
    throw new ProviderOutputPartError("provider_output_audio_duration_invalid");
  return {
    type,
    bytes,
    mediaType,
    ...(type === "audio" ? { durationMs: part.durationMs as number } : {}),
  };
}

function strictRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function defaultMediaType(type: "image" | "audio"): string {
  return type === "image" ? "image/png" : "audio/mpeg";
}
