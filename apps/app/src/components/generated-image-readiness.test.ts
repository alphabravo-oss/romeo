import { describe, expect, it, vi } from "vitest";

import type { FileObject } from "../features/files";
import { waitForGeneratedImageReady } from "./useWorkspaceAttachments";

function file(status: string): FileObject {
  return { id: "file_generated", status } as FileObject;
}

describe("generated image file readiness", () => {
  it("waits for the governed lifecycle before exposing file content", async () => {
    const read = vi
      .fn<(fileId: string) => Promise<FileObject>>()
      .mockResolvedValueOnce(file("quarantined"))
      .mockResolvedValueOnce(file("scanning"))
      .mockResolvedValueOnce(file("ready"));
    const delay = vi.fn(() => Promise.resolve());

    await expect(
      waitForGeneratedImageReady("file_generated", { delay, read }),
    ).resolves.toEqual(file("ready"));
    expect(read).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("fails closed when scanning rejects the generated artifact", async () => {
    await expect(
      waitForGeneratedImageReady("file_generated", {
        read: () => Promise.resolve(file("failed")),
      }),
    ).rejects.toThrow("did not pass");
  });

  it("bounds lifecycle polling", async () => {
    const read = vi.fn(() => Promise.resolve(file("scanning")));

    await expect(
      waitForGeneratedImageReady("file_generated", {
        delay: () => Promise.resolve(),
        maxAttempts: 2,
        read,
      }),
    ).rejects.toThrow("did not become ready");
    expect(read).toHaveBeenCalledTimes(2);
  });
});
