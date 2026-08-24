const sameOriginFileContent =
  /^\/(?:api\/v1\/)?files\/[^/?#]+\/content(?:\?.*)?$/u;

export function audioCaptionTrackUrl(transcript: string): string {
  const cue = transcript
    .replaceAll("\0", "")
    .replaceAll("-->", "→")
    .trim()
    .slice(0, 4_000);
  const body = `WEBVTT\n\n00:00:00.000 --> 99:59:59.999\n${cue}\n`;
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(body)}`;
}

export function imageAltText(input: {
  fileName: string;
  height?: number;
  width?: number;
}): string {
  if (input.width !== undefined && input.height !== undefined)
    return `${input.fileName}, ${input.width} by ${input.height} pixels`;
  return input.fileName;
}

export function documentPageSelection(input: {
  pageCount?: number;
  selectedPage?: number;
}): { pageCount: number; selectedPage: number } | undefined {
  if (input.pageCount === undefined || input.pageCount < 1) return undefined;
  const selected =
    input.selectedPage === undefined
      ? 1
      : Math.min(input.pageCount, Math.max(1, Math.trunc(input.selectedPage)));
  return { pageCount: input.pageCount, selectedPage: selected };
}

export function safeAttachmentDownloadUrl(
  url: string | undefined,
): string | undefined {
  if (url === undefined || url.length === 0) return undefined;
  if (sameOriginFileContent.test(url)) return url;
  try {
    const parsed = new URL(url, "https://romeo.local");
    if (parsed.origin !== "https://romeo.local") return undefined;
    return sameOriginFileContent.test(`${parsed.pathname}${parsed.search}`)
      ? `${parsed.pathname}${parsed.search}`
      : undefined;
  } catch {
    return undefined;
  }
}

export function isAudioAttachment(mimeType: string): boolean {
  return mimeType.startsWith("audio/");
}

export function isVideoAttachment(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

export function isPdfAttachment(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

export function metadataPageCount(
  metadata: Record<string, unknown>,
): number | undefined {
  const value = metadata.pageCount;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export function metadataTranscript(
  metadata: Record<string, unknown>,
): string | undefined {
  const value = metadata.transcript;
  if (typeof value !== "string") return undefined;
  const transcript = value.trim();
  return transcript.length === 0 ? undefined : transcript.slice(0, 4_000);
}

export type AudioAccessibility =
  | { kind: "speech"; status: "pending" | "failed" | "required" }
  | { kind: "speech"; status: "ready"; transcript: string }
  | { description: string; kind: "non_speech"; status: "ready" };

export function metadataAudioAccessibility(
  metadata: Record<string, unknown>,
): AudioAccessibility {
  const transcript = metadataTranscript(metadata);
  if (transcript !== undefined)
    return { kind: "speech", status: "ready", transcript };
  const description = metadata.audioDescription;
  if (
    metadata.audioKind === "non_speech" &&
    typeof description === "string" &&
    description.trim().length > 0
  ) {
    return {
      description: description.trim().slice(0, 1_000),
      kind: "non_speech",
      status: "ready",
    };
  }
  return {
    kind: "speech",
    status:
      metadata.transcriptStatus === "pending" ||
      metadata.transcriptStatus === "failed"
        ? metadata.transcriptStatus
        : "required",
  };
}

export function metadataDimensions(metadata: Record<string, unknown>): {
  height?: number;
  width?: number;
} {
  const width = metadata.width;
  const height = metadata.height;
  return {
    ...(typeof width === "number" && width > 0 ? { width } : {}),
    ...(typeof height === "number" && height > 0 ? { height } : {}),
  };
}
