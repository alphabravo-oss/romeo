export interface DataConnectorRetryPolicy {
  retryAttempts: number;
  retryBackoffMs: number;
}

export async function retryConnectorResponse(
  request: () => Promise<Response>,
  policy: DataConnectorRetryPolicy,
): Promise<Response> {
  let response = await request();
  for (let attempt = 0; attempt < policy.retryAttempts; attempt += 1) {
    if (!isRetryableConnectorResponse(response)) return response;
    await discardResponseBody(response);
    await sleep(retryDelayMs(response, policy.retryBackoffMs, attempt));
    response = await request();
  }
  return response;
}

function isRetryableConnectorResponse(response: Response): boolean {
  if ([429, 500, 502, 503, 504].includes(response.status)) return true;
  return (
    response.status === 403 &&
    response.headers.get("x-ratelimit-remaining") === "0"
  );
}

function retryDelayMs(
  response: Response,
  retryBackoffMs: number,
  attempt: number,
): number {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMs = retryAfter === null ? undefined : parseRetryAfterMs(retryAfter);
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, 30_000);
  return retryBackoffMs * Math.max(1, attempt + 1);
}

function parseRetryAfterMs(value: string): number | undefined {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discardResponseBody(response: Response): Promise<void> {
  if (response.body === null || response.bodyUsed) return;
  try {
    await response.body.cancel();
  } catch {
    // Best-effort cleanup only; the retry outcome should be driven by the next request.
  }
}
