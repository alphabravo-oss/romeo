export interface DetachedTaskContext {
  chatId?: string;
  orgId?: string;
  runId?: string;
}

/**
 * Runs fire-and-forget background work without ever producing an unhandled
 * rejection. Failures are logged as a redacted structured record (task label,
 * identifiers, error class and code; never the error message, which can carry
 * provider response bodies) and then handed to `onError` for recovery.
 * The returned promise always resolves, so callers may `void` it safely.
 */
export async function runDetached(
  task: string,
  work: () => Promise<unknown>,
  options: {
    context?: DetachedTaskContext;
    onError?: (error: unknown) => Promise<unknown>;
  } = {},
): Promise<void> {
  try {
    await work();
  } catch (error) {
    reportDetachedFailure(task, error, options.context);
    if (options.onError === undefined) return;
    try {
      await options.onError(error);
    } catch (followUp) {
      reportDetachedFailure(`${task}.recovery`, followUp, options.context);
    }
  }
}

export function reportDetachedFailure(
  task: string,
  error: unknown,
  context: DetachedTaskContext = {},
): void {
  const errorCode = safeErrorCode(error);
  console.error("background task failed", {
    task,
    ...context,
    errorClass: safeErrorClass(error),
    ...(errorCode === undefined ? {} : { errorCode }),
  });
}

const safeToken = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;

export function safeErrorClass(error: unknown): string {
  if (!(error instanceof Error)) return "NonErrorThrow";
  const name = error.constructor?.name ?? error.name;
  return safeToken.test(name) ? name : "Error";
}

export function safeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && safeToken.test(code) ? code : undefined;
}
