import { existsSync } from "node:fs";

const retiredExample = "deploy/keda/webhook-retry-scaledjob.example.yaml";

export function checkKedaExamples() {
  if (existsSync(retiredExample)) {
    throw new Error(
      "The tenant-token webhook-retry KEDA example must remain retired; scheduled retries are owned by the fenced all-tenant coordinator.",
    );
  }
  return {
    retired: true,
    retiredExample,
    resourceCount: 0,
    resources: [],
  };
}
