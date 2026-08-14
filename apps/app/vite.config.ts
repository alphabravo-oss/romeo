import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const tslibEsm = require.resolve("tslib/tslib.es6.mjs");

const serverRuntimeExternals = [
  "@node-rs/argon2",
  "@valkey/valkey-glide",
  "@google-cloud/secret-manager",
  "firebase-admin",
  "firebase-admin/app",
  "firebase-admin/messaging",
];

export default defineConfig(({ command, mode }) => {
  // Server code reads process.env directly (@romeo/config readEnv), while Vite only ever exposes
  // .env through import.meta.env — so without this a root .env is invisible to the dev server and
  // settings like MANAGED_SECRET_ENCRYPTION_KEY silently keep their rejected placeholder defaults.
  // Dev only: a built server takes its environment from whatever runs it, and reading a stray .env
  // in production would be a surprise rather than a convenience.
  //
  // `??=` so a real environment variable always beats the file — `KEY=… pnpm dev` must still win.
  // The empty prefix loads every key, not just VITE_, because none of these reach the browser:
  // they are read server-side, and the client only ever sees what a route hands it.
  if (command === "serve") {
    for (const [key, value] of Object.entries(
      loadEnv(mode, workspaceRoot, ""),
    )) {
      process.env[key] ??= value;
    }
  }

  return {
    // Nitro's current Rolldown pipeline otherwise selects tslib's CommonJS
    // fallback for Radix/react-remove-scroll and emits an undefined default
    // export in the SSR chunk. Point both environments at tslib's supported
    // ESM entry until the upstream bundler no longer needs the disambiguation.
    resolve: { alias: [{ find: /^tslib$/u, replacement: tslibEsm }] },
    optimizeDeps: {
      exclude: ["@valkey/valkey-glide", "@valkey/valkey-glide-darwin-arm64"],
    },
    server: {
      port: 3000,
    },
    build: {
      manifest: true,
      rolldownOptions: {
        external: serverRuntimeExternals,
      },
    },
    ssr: {
      external: [
        ...serverRuntimeExternals,
        "@valkey/valkey-glide-darwin-arm64",
      ],
    },
    plugins: [
      tailwindcss(),
      tanstackStart({ srcDirectory: "src" }),
      viteReact(),
      nitro(),
    ],
  };
});
