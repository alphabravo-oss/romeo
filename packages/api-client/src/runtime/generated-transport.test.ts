import { describe, expect, it, vi } from "vitest";

import { adaptGeneratedFetch } from "./generated-transport";

describe("generated transport", () => {
  it("forwards the effective Request AbortSignal", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      receivedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        receivedSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    const transport = adaptGeneratedFetch(fetchImpl);

    const pending = transport(
      new Request("https://romeo.example/api/v1/models", {
        signal: controller.signal,
      }),
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(receivedSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
