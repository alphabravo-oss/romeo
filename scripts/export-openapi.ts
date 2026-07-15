import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { openApiDocument } from "../packages/core/src/http/openapi/document";

const output = argValue("--output") ?? "dist/ci/openapi.json";
const outputPath = resolve(process.cwd(), output);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify(
    openApiDocument({
      openWebUiCompatibilityEnabled:
        process.env.OPENWEBUI_COMPATIBILITY_ENABLED === "true",
    }),
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`Wrote Romeo OpenAPI document to ${outputPath}`);

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
