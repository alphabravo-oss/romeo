import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

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
      external: ["@node-rs/argon2", "@valkey/valkey-glide"],
    },
  },
  ssr: {
    external: [
      "@node-rs/argon2",
      "@valkey/valkey-glide",
      "@valkey/valkey-glide-darwin-arm64",
    ],
  },
  plugins: [
    tailwindcss(),
    tanstackStart({ srcDirectory: "src" }),
    viteReact(),
    nitro(),
  ],
});
