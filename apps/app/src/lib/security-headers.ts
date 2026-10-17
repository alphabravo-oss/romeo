export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export interface BrowserSecurityOptions {
  development?: boolean;
  /**
   * Origin of the S3-compatible object store when the browser PUTs to
   * presigned URLs (knowledge uploads). Nothing else needs cross-origin
   * connections.
   */
  objectStoreOrigin?: string | undefined;
}

/**
 * The object-store origin the browser must reach for presigned uploads, or
 * undefined when uploads stay on the application origin.
 */
export function objectStoreOriginFromEnv(
  env: Record<string, string | undefined>,
): string | undefined {
  if (env.OBJECT_STORE_DRIVER !== "s3" || !env.S3_ENDPOINT) return undefined;
  try {
    const url = new URL(env.S3_ENDPOINT);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

export function contentSecurityPolicy(
  nonce: string,
  options: BrowserSecurityOptions = {},
): string {
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(options.development === true ? ["'unsafe-eval'"] : []),
  ];
  const connectSources = [
    "'self'",
    "blob:",
    ...(options.objectStoreOrigin === undefined
      ? []
      : [options.objectStoreOrigin]),
    // Vite's HMR client connects over a websocket during development.
    ...(options.development === true ? ["ws:", "wss:"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    // Remote https: images stay allowed for administrator-configured model
    // avatars. Markdown from model output never auto-loads remote images
    // (see lib/markdown-image.tsx), which is the control against exfiltration.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // No arbitrary https:/wss: so injected script or markup cannot beacon
    // chat data out with fetch, EventSource or WebSocket.
    `connect-src ${connectSources.join(" ")}`,
    "media-src 'self' data: blob: https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
  ].join("; ");
}

export function applyBrowserSecurityHeaders(
  headers: Headers,
  nonce: string,
  options: BrowserSecurityOptions = {},
): void {
  headers.set("content-security-policy", contentSecurityPolicy(nonce, options));
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
}
