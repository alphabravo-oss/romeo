import { createFileRoute } from "@tanstack/react-router";

import { romeoServerApi } from "../../../server/romeo-api";

function handle({ request }: { request: Request }) {
  return romeoServerApi.fetch(request);
}

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
      OPTIONS: handle,
    },
  },
});
