import { describe, expect, it, vi } from "vitest";

import { createRetryableImport } from "./retryable-import";

describe("createRetryableImport", () => {
  it("shares an in-flight and resolved import between intent and render", async () => {
    const importer = vi.fn(async () => ({ Panel: "ready" }));
    const load = createRetryableImport(importer);

    const first = load();
    const second = load();
    expect(first).toBe(second);
    await expect(first).resolves.toEqual({ Panel: "ready" });
    await expect(load()).resolves.toEqual({ Panel: "ready" });
    expect(importer).toHaveBeenCalledOnce();
  });

  it("clears a rejected import so later intent can retry", async () => {
    const importer = vi
      .fn<() => Promise<{ Panel: string }>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ Panel: "ready" });
    const load = createRetryableImport(importer);

    await expect(load()).rejects.toThrow("network");
    await expect(load()).resolves.toEqual({ Panel: "ready" });
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
