import { defineConfig } from "@hey-api/openapi-ts";

const outputRoot = process.env.ROMEO_GENERATED_ROOT ?? "src/generated";

export default defineConfig([
  {
    input: "../../dist/generated/openapi.json",
    output: {
      path: `${outputRoot}/sdk`,
      postProcess: ["prettier"],
    },
    plugins: [
      { name: "@hey-api/client-fetch", includeInEntry: true },
      "@hey-api/sdk",
      "zod",
    ],
  },
  {
    input: "../../dist/generated/openapi-query.json",
    output: {
      path: `${outputRoot}/query`,
      postProcess: ["prettier"],
    },
    plugins: [
      { name: "@hey-api/client-fetch", includeInEntry: true },
      "@tanstack/react-query",
    ],
  },
]);
