import { createGeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import { isCancelledError } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { modelsQueryOptions } from "./api-query-options";
import { createRomeoQueryClient } from "./query-client";

describe("generated query cancellation", () => {
  it("aborts fetch without retrying or committing a response", async () => {
    let requestSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      requestSignal = init?.signal ?? undefined;
      markStarted();
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    const apiClient = createGeneratedQueryClient({
      baseUrl: "https://romeo.example",
      fetchImpl,
    });
    const queryClient = createRomeoQueryClient();
    const options = modelsQueryOptions(apiClient);

    const pending = queryClient.fetchQuery(options);
    await started;
    await queryClient.cancelQueries({ queryKey: options.queryKey });

    const cancellation = await pending.then(
      () => false,
      (error: unknown) => isCancelledError(error),
    );

    expect(cancellation).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
    expect(queryClient.getQueryState(options.queryKey)?.fetchStatus).toBe(
      "idle",
    );
  });
});
