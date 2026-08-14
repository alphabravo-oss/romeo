import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Server-module tests intentionally construct the local development
    // runtime; production/default configuration remains fail-closed.
    env: { DEV_SEEDED_LOGIN: "true" },
  },
});
