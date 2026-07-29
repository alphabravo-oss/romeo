export interface DownloadEnvironment {
  append(anchor: DownloadAnchor): void;
  createAnchor(): DownloadAnchor;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  schedule(task: () => void): void;
}

export interface DownloadAnchor {
  click(): void;
  download: string;
  href: string;
  rel: string;
  remove(): void;
  style: { display: string };
}

export function downloadText(
  value: string,
  filename: string,
  mimeType = "text/plain;charset=utf-8",
  environment = browserDownloadEnvironment(),
): boolean {
  return downloadBlob(
    new Blob([value], { type: mimeType }),
    filename,
    environment,
  );
}

export function downloadBlob(
  blob: Blob,
  filename: string,
  environment = browserDownloadEnvironment(),
): boolean {
  if (environment === undefined) return false;
  const objectUrl = environment.createObjectUrl(blob);
  const anchor = environment.createAnchor();
  anchor.href = objectUrl;
  anchor.download = sanitizeDownloadFilename(filename);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  environment.append(anchor);
  anchor.click();
  anchor.remove();
  environment.schedule(() => environment.revokeObjectUrl(objectUrl));
  return true;
}

export function sanitizeDownloadFilename(value: string): string {
  const basename = value.split(/[\\/]/u).at(-1) ?? "";
  const sanitized = basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f:*?"<>|]+/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/^\.+/u, "")
    .trim()
    .slice(0, 180);
  return /[\p{L}\p{N}]/u.test(sanitized) ? sanitized : "romeo-download";
}

function browserDownloadEnvironment(): DownloadEnvironment | undefined {
  if (
    typeof document === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return undefined;
  }
  return {
    append: (anchor) =>
      document.body.append(anchor as unknown as HTMLAnchorElement),
    createAnchor: () =>
      document.createElement("a") as unknown as DownloadAnchor,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    schedule: (task) => globalThis.setTimeout(task, 0),
  };
}
