import { describe, expect, it, vi } from "vitest";

import { writeTextToClipboard } from "./clipboard";

describe("writeTextToClipboard", () => {
  it("uses the modern Clipboard API when available", async () => {
    const modernWrite = vi.fn().mockResolvedValue(undefined);
    const legacyWrite = vi.fn(() => true);

    await expect(
      writeTextToClipboard("sensitive value", {
        modernWrite,
        legacyWrite,
      }),
    ).resolves.toBe(true);
    expect(modernWrite).toHaveBeenCalledWith("sensitive value");
    expect(legacyWrite).not.toHaveBeenCalled();
  });

  it("falls back when modern clipboard permission is rejected", async () => {
    const modernWrite = vi.fn().mockRejectedValue(new Error("denied"));
    const legacyWrite = vi.fn(() => true);

    await expect(
      writeTextToClipboard("value", { modernWrite, legacyWrite }),
    ).resolves.toBe(true);
    expect(legacyWrite).toHaveBeenCalledWith("value");
  });

  it("reports unavailable and failed clipboard operations without throwing", async () => {
    await expect(writeTextToClipboard("value", undefined)).resolves.toBe(false);
    await expect(
      writeTextToClipboard("value", {
        legacyWrite: () => {
          throw new Error("blocked");
        },
      }),
    ).resolves.toBe(false);
  });
});
