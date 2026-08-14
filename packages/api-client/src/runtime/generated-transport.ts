type GeneratedRequestTarget = (request: Request) => RequestInfo | URL;

/** Preserve Request cancellation and transport fields across generated clients. */
export function adaptGeneratedFetch(
  fetchImpl: typeof fetch,
  requestTarget: GeneratedRequestTarget = (request) => request.url,
): typeof fetch {
  return async (input, init) => {
    if (!(input instanceof Request)) return fetchImpl(input, init);
    const request = init === undefined ? input : new Request(input, init);
    const body = ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await request.clone().text();
    return fetchImpl(requestTarget(request), {
      ...(body === undefined || body === "" ? {} : { body }),
      cache: request.cache,
      credentials: request.credentials,
      headers: Object.fromEntries(request.headers.entries()),
      integrity: request.integrity,
      keepalive: request.keepalive,
      method: request.method,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      signal: request.signal,
    });
  };
}
