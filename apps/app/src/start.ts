import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";

import {
  applyBrowserSecurityHeaders,
  createCspNonce,
} from "./lib/security-headers";

const browserSecurityMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next }) => {
    const cspNonce = createCspNonce();
    const result = await next({ context: { cspNonce } });
    applyBrowserSecurityHeaders(result.response.headers, cspNonce, {
      development: process.env.NODE_ENV !== "production",
    });
    return result;
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [
    browserSecurityMiddleware,
    createCsrfMiddleware({
      filter: (context) => context.handlerType === "serverFn",
    }),
  ],
}));
