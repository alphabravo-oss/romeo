import {
  getHealthRoute,
  getInternalReadinessRoute,
  ROMEO_PRODUCT_VERSION,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerHealthRoutes(app: RomeoApi): void {
  app.openapi(getHealthRoute, (context) =>
    context.json(
      {
        data: {
          status: "ok",
          service: "romeo-api",
          version: ROMEO_PRODUCT_VERSION,
          requestId: context.get("requestId"),
        },
      },
      200,
    ),
  );

  // Internal kubelet-only data-plane readiness. The server adapter supplies
  // the transport peer out of band, so an ingress client cannot spoof this
  // boundary with a header.
  app.openapi(getInternalReadinessRoute, async (context) => {
    if (!isLoopbackPeer(context.env?.requestPeerAddress))
      return context.notFound();
    const readiness = await context.get("services").internalReadiness.report();
    const payload = { data: readiness };
    return readiness.status === "ready"
      ? context.json(payload, 200)
      : context.json(payload, 503);
  });
}

function isLoopbackPeer(value: string | undefined): boolean {
  const address = value
    ?.trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, "$1");
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}
