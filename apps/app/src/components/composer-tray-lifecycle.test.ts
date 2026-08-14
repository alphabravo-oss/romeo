import { describe, expect, it } from "vitest";

import {
  advanceTrayLifecycle,
  fileStatusToTrayLifecycle,
  readyDocuments,
  trayAnnouncement,
  trayBlocksSend,
  trayCanCancel,
  trayCanRetry,
  trayProgressPercent,
} from "./composer-tray-lifecycle";

describe("composer tray lifecycle", () => {
  it("advances upload → scan → ready and maps provider file statuses", () => {
    expect(advanceTrayLifecycle("queued", "upload")).toBe("uploading");
    expect(advanceTrayLifecycle("uploading", "scan")).toBe("scanning");
    expect(advanceTrayLifecycle("scanning", "succeed")).toBe("ready");
    expect(advanceTrayLifecycle("uploading", "cancel")).toBe("cancelled");
    expect(advanceTrayLifecycle("failed", "retry")).toBe("uploading");
    expect(fileStatusToTrayLifecycle("scanning")).toBe("scanning");
    expect(fileStatusToTrayLifecycle("extracting")).toBe("scanning");
    expect(fileStatusToTrayLifecycle("quarantined")).toBe("scanning");
    expect(fileStatusToTrayLifecycle("attached")).toBe("ready");
    expect(fileStatusToTrayLifecycle("failed")).toBe("failed");
    expect(trayProgressPercent("uploading")).toBe(35);
    expect(trayProgressPercent("scanning")).toBe(70);
    expect(trayCanCancel("scanning")).toBe(true);
    expect(trayCanRetry("failed")).toBe(true);
  });

  it("blocks send until ready and only keeps documents with file ids", () => {
    expect(
      trayBlocksSend([{ status: "uploading" }, { status: "ready" }]),
    ).toBe(true);
    expect(trayBlocksSend([{ status: "ready" }])).toBe(false);
    expect(
      readyDocuments([
        { fileId: "file_1", status: "ready" },
        { fileId: "file_2", status: "uploading" },
        { status: "ready" },
      ]),
    ).toEqual([{ fileId: "file_1", status: "ready" }]);
    expect(
      trayAnnouncement({
        fileName: "notes.pdf",
        percent: 70,
        status: "scanning",
      }),
    ).toBe("notes.pdf: scanning 70%");
  });
});
