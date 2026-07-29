import { describe, expect, it, vi } from "vitest";

import {
  downloadText,
  sanitizeDownloadFilename,
  type DownloadAnchor,
  type DownloadEnvironment,
} from "./download";

describe("browser downloads", () => {
  it("sanitizes paths, controls, reserved characters, and empty names", () => {
    expect(sanitizeDownloadFilename("../../a:b?.csv")).toBe("a-b-.csv");
    expect(sanitizeDownloadFilename(" \u0000 ")).toBe("romeo-download");
  });

  it("appends, clicks, removes, and revokes on a later task", () => {
    const click = vi.fn();
    const remove = vi.fn();
    const revokeObjectUrl = vi.fn();
    const scheduled: Array<() => void> = [];
    const anchor: DownloadAnchor = {
      click,
      download: "",
      href: "",
      rel: "",
      remove,
      style: { display: "" },
    };
    const environment: DownloadEnvironment = {
      append: vi.fn(),
      createAnchor: () => anchor,
      createObjectUrl: () => "blob:download",
      revokeObjectUrl,
      schedule: (task) => scheduled.push(task),
    };

    expect(
      downloadText("hello", "../report.csv", "text/csv", environment),
    ).toBe(true);
    expect(anchor.download).toBe("report.csv");
    expect(anchor.href).toBe("blob:download");
    expect(anchor.rel).toBe("noopener");
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    scheduled[0]?.();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:download");
  });
});
