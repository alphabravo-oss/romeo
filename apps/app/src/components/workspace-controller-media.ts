export function safeAttachmentFileName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/u).pop()?.trim() ?? "";
  const normalized = leaf
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 160);
  return normalized.length === 0 ? "image" : normalized;
}

export function clientMessageId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  return typeof randomUUID === "function"
    ? randomUUID.call(globalThis.crypto)
    : `client_msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read audio."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
  return dataUrl.split(",", 2)[1] ?? "";
}

export function audioExtension(contentType: string): string {
  const normalized = contentType.split(";", 1)[0]?.toLowerCase() ?? "";
  if (normalized === "audio/mp4") return "m4a";
  if (normalized === "audio/ogg") return "ogg";
  if (normalized === "audio/wav") return "wav";
  return "webm";
}
