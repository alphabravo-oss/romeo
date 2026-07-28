import type { StreamChatChunk } from "@romeo/providers";

export class ProviderStreamFailure extends Error {
  constructor(readonly errorCode: string) {
    super(errorCode);
  }
}

export class ProviderStreamAborted extends Error {
  constructor() {
    super("Provider stream aborted.");
  }
}

type ProviderStreamOutcome = "cancelled" | "timeout";

export function createProviderStreamRuntime(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): {
  clear(): void;
  markActivity(): void;
  next(
    iterator: AsyncIterator<StreamChatChunk>,
  ): Promise<IteratorResult<StreamChatChunk>>;
  outcome: ProviderStreamOutcome | undefined;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  let outcome: ProviderStreamOutcome | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const abort = (nextOutcome: ProviderStreamOutcome) => {
    outcome ??= nextOutcome;
    if (!controller.signal.aborted) controller.abort();
  };
  const armTimeout = () => {
    if (timeoutMs === undefined) return;
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = setTimeout(() => abort("timeout"), timeoutMs);
  };
  const abortForParent = () => abort("cancelled");

  if (parentSignal?.aborted === true) abortForParent();
  else parentSignal?.addEventListener("abort", abortForParent, { once: true });
  if (timeoutMs !== undefined) armTimeout();

  return {
    clear() {
      if (timeout !== undefined) clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortForParent);
    },
    markActivity() {
      armTimeout();
    },
    next(iterator) {
      if (controller.signal.aborted)
        return Promise.reject(new ProviderStreamAborted());
      return new Promise((resolve, reject) => {
        const abortListener = () => reject(new ProviderStreamAborted());
        controller.signal.addEventListener("abort", abortListener, {
          once: true,
        });
        iterator
          .next()
          .then(resolve, reject)
          .finally(() => {
            controller.signal.removeEventListener("abort", abortListener);
          });
      });
    },
    get outcome() {
      return outcome;
    },
    signal: controller.signal,
  };
}
