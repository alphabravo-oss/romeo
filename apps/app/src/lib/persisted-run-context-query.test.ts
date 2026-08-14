import { describe, expect, it } from "vitest";
import { createGeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";

import { persistedRunContextQueryOptions } from "./persisted-run-context-query";

describe("persisted run context query options", () => {
  it("owns the exact generated key, cancellation signal, and browser cache policy", async () => {
    let signal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const client = createGeneratedQueryClient({
      baseUrl: "https://romeo.test",
      fetchImpl: (_input, init) => {
        signal = init?.signal ?? undefined;
        markStarted();
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });
    const options = persistedRunContextQueryOptions(
      "chat_context",
      "run_context",
      client,
    );
    expect(options.enabled).toBe(true);
    expect(options.queryKey[0]).toMatchObject({
      _id: "runsInspectPersistedContext",
      path: { chatId: "chat_context" },
      query: { runId: "run_context" },
    });
    expect(options.meta).toMatchObject({ ssr: false });
    const controller = new AbortController();
    const pending = options.queryFn?.({
      queryKey: options.queryKey,
      signal: controller.signal,
      meta: options.meta,
    } as never);
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(signal?.aborted).toBe(true);
  });

  it("is disabled without a persisted chat and does not share keys across runs", () => {
    const disabled = persistedRunContextQueryOptions(undefined);
    const latest = persistedRunContextQueryOptions("chat_context");
    const explicit = persistedRunContextQueryOptions(
      "chat_context",
      "run_context",
    );
    expect(disabled.enabled).toBe(false);
    expect(latest.queryKey).not.toEqual(explicit.queryKey);
  });
});
