import { createFileRoute } from "@tanstack/react-router";

import { romeoServerApi } from "../../server/romeo-api";

function handle({ request }: { request: Request }) {
  return romeoServerApi.fetch(request);
}

/**
 * OpenAI-compatible legacy aliases intentionally live at /api/* while the
 * canonical Romeo surface lives at /api/v1/*. The core router owns the exact
 * allowlist and returns 404 for every other legacy path.
 */
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      OPTIONS: handle,
    },
  },
});
