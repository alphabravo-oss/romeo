import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const serverRuntimeExternals = [
  "@node-rs/argon2",
  "@valkey/valkey-glide",
  "@google-cloud/secret-manager",
  "firebase-admin",
  "firebase-admin/app",
  "firebase-admin/messaging",
];

export default defineConfig({
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
    external: [...serverRuntimeExternals, "@valkey/valkey-glide-darwin-arm64"],
  },
  plugins: [
    tailwindcss(),
    tanstackStart({ srcDirectory: "src" }),
    viteReact(),
    nitro(),
  ],
});
