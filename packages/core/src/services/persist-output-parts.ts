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
  citation?: { sourceId: string; chunkId?: string };
  artifact?: { artifactId: string; version: string };
}

export interface PersistedOutputPartRef {
  type: "image_ref" | "audio_ref" | "citation_ref" | "artifact_ref";
  fileId?: string;
  artifactId?: string;
  sourceId?: string;
  chunkId?: string;
  version?: string;
}

export interface OutputPartReadyEvent {
  type: typeof OUTPUT_PART_READY_EVENT;
  partRef: PersistedOutputPartRef;
}

export function extractProviderOutputParts(data: unknown): ProviderOutputPart[] {
  if (data === null || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const raw = record.outputParts ?? record.parts;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (item === null || typeof item !== "object") return [];
    const part = item as Record<string, unknown>;
    if (
      part.type !== "image" &&
      part.type !== "audio" &&
      part.type !== "citation" &&
      part.type !== "artifact"
    )
      return [];
    return [
      {
        type: part.type,
        ...(part.bytes instanceof Uint8Array ? { bytes: part.bytes } : {}),
        ...(typeof part.mediaType === "string" ? { mediaType: part.mediaType } : {}),
        ...(part.citation !== null && typeof part.citation === "object"
          ? {
              citation: part.citation as {
                sourceId: string;
                chunkId?: string;
              },
            }
          : {}),
        ...(part.artifact !== null && typeof part.artifact === "object"
          ? {
              artifact: part.artifact as {
                artifactId: string;
                version: string;
              },
            }
          : {}),
      },
    ];
  });
}

export async function persistProviderOutputParts(input: {
  parts: ProviderOutputPart[];
  store: (bytes: Uint8Array, mediaType: string) => Promise<{ fileId: string }>;
  persistPart: (part: PersistedOutputPartRef) => Promise<void>;
  emit: (event: OutputPartReadyEvent) => void;
}): Promise<{
  persisted: PersistedOutputPartRef[];
  emitted: OutputPartReadyEvent[];
}> {
  const persisted: PersistedOutputPartRef[] = [];
  const emitted: OutputPartReadyEvent[] = [];
  for (const part of input.parts) {
    const stored = await persistOne(part, input.store);
    if (stored === undefined) continue;
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
  store: (bytes: Uint8Array, mediaType: string) => Promise<{ fileId: string }>,
): Promise<PersistedOutputPartRef | undefined> {
  if (part.type === "citation") {
    if (part.citation?.sourceId === undefined) return undefined;
    return {
      type: "citation_ref",
      sourceId: part.citation.sourceId,
      ...(part.citation.chunkId === undefined
        ? {}
        : { chunkId: part.citation.chunkId }),
    };
  }
  if (part.type === "artifact") {
    if (part.artifact === undefined) return undefined;
    return {
      type: "artifact_ref",
      artifactId: part.artifact.artifactId,
      version: part.artifact.version,
    };
  }
  if (part.bytes === undefined || part.bytes.byteLength === 0) return undefined;
  const stored = await store(part.bytes, part.mediaType ?? defaultMediaType(part.type));
  return {
    type: part.type === "image" ? "image_ref" : "audio_ref",
    fileId: stored.fileId,
  };
}

function defaultMediaType(type: "image" | "audio"): string {
  return type === "image" ? "image/png" : "audio/mpeg";
}
