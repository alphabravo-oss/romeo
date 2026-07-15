import { readFileSync } from "node:fs";

export const requiredKubernetesDrModes = ["external-postgres", "cloudnativepg"];

export function readKubernetesDrPlan(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    schemaVersion: parsed.schemaVersion,
    modes: Object.fromEntries(
      requiredKubernetesDrModes.map((mode) => [
        mode,
        normalizeMode(parsed.modes?.[mode] ?? {}),
      ]),
    ),
  };
}

function normalizeMode(value) {
  return {
    sourceNamespace: stringValue(value.sourceNamespace),
    restoreNamespace: stringValue(value.restoreNamespace),
    releaseName: stringValue(value.releaseName),
    image: stringValue(value.image),
    sourceDatabaseUrlSecret: stringValue(value.sourceDatabaseUrlSecret),
    restoreDatabaseUrlSecret: stringValue(value.restoreDatabaseUrlSecret),
  };
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
