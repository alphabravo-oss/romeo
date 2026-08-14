import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // API tests intentionally exercise the seeded administrator unless a test
    // passes an explicit secure-mode environment.
    env: { DEV_SEEDED_LOGIN: "true" },
  },
});
