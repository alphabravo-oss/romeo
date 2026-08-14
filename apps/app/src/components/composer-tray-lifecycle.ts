export const TRAY_LIFECYCLES = [
  "queued",
  "uploading",
  "scanning",
  "ready",
  "failed",
  "cancelled",
] as const;
export type TrayLifecycle = (typeof TRAY_LIFECYCLES)[number];

export type TrayLifecycleEvent =
  | "queue"
  | "upload"
  | "scan"
  | "succeed"
  | "fail"
  | "cancel"
  | "retry";

const transitions: Record<TrayLifecycle, Partial<Record<TrayLifecycleEvent, TrayLifecycle>>> =
  {
    queued: { upload: "uploading", cancel: "cancelled" },
    uploading: { scan: "scanning", succeed: "ready", fail: "failed", cancel: "cancelled" },
    scanning: { succeed: "ready", fail: "failed", cancel: "cancelled" },
    ready: { retry: "uploading" },
    failed: { retry: "uploading", cancel: "cancelled" },
    cancelled: { retry: "uploading" },
  };

export function advanceTrayLifecycle(
  current: TrayLifecycle,
  event: TrayLifecycleEvent,
): TrayLifecycle {
  return transitions[current][event] ?? current;
}

export function fileStatusToTrayLifecycle(status: string): TrayLifecycle {
  if (status === "uploading") return "uploading";
  if (
    status === "scanning" ||
    status === "extracting" ||
    status === "transcoding" ||
    status === "quarantined"
  )
    return "scanning";
  if (status === "failed" || status === "deleted") return "failed";
  if (
    status === "ready" ||
    status === "available" ||
    status === "attached" ||
    status === "retained"
  )
    return "ready";
  return "queued";
}

export function trayProgressPercent(status: TrayLifecycle): number {
  if (status === "queued") return 0;
  if (status === "uploading") return 35;
  if (status === "scanning") return 70;
  if (status === "cancelled") return 0;
  return 100;
}

export function trayIsBusy(status: TrayLifecycle): boolean {
  return status === "queued" || status === "uploading" || status === "scanning";
}

export function trayCanRetry(status: TrayLifecycle): boolean {
  return status === "failed" || status === "cancelled";
}

export function trayCanCancel(status: TrayLifecycle): boolean {
  return trayIsBusy(status);
}

export function trayIsSendReady(status: TrayLifecycle): boolean {
  return status === "ready";
}

export function trayBlocksSend(
  attachments: ReadonlyArray<{ status?: TrayLifecycle }>,
): boolean {
  return attachments.some(
    (attachment) =>
      attachment.status !== undefined && !trayIsSendReady(attachment.status),
  );
}

export function readyImages<T extends { status?: TrayLifecycle }>(
  attachments: readonly T[],
): T[] {
  return attachments.filter((attachment) =>
    trayIsSendReady(attachment.status ?? "ready"),
  );
}

export function readyDocuments<T extends { fileId?: string; status?: TrayLifecycle }>(
  attachments: readonly T[],
): Array<T & { fileId: string }> {
  return attachments.filter(
    (attachment): attachment is T & { fileId: string } =>
      trayIsSendReady(attachment.status ?? "ready") &&
      attachment.fileId !== undefined &&
      attachment.fileId.length > 0,
  );
}

export function trayAnnouncement(input: {
  fileName: string;
  percent: number;
  status: TrayLifecycle;
}): string {
  return `${input.fileName}: ${input.status} ${input.percent}%`;
}
