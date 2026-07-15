import { readFileSync } from "node:fs";

export const requiredReleaseAssetNames = [
  "release-channel",
  "security-evidence",
  "sbom",
  "provenance",
  "approval",
];

export function readReleaseReadbackPlan(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const helm = parsed.helm ?? {};
  return {
    schemaVersion: parsed.schemaVersion,
    helmRepositoryUrl: stringValue(
      helm.repositoryUrl ?? parsed.helmRepositoryUrl,
    ),
    images: arrayValue(parsed.images).map((item, index) => ({
      readback: requiredString(item?.readback, `images[${index}].readback`),
      required: requiredString(item?.required, `images[${index}].required`),
    })),
    charts: arrayValue(parsed.charts).map((item, index) => ({
      readback: requiredString(item?.readback, `charts[${index}].readback`),
      required: requiredString(item?.required, `charts[${index}].required`),
    })),
    assets: arrayValue(parsed.assets).map((item, index) => ({
      readback: requiredString(item?.readback, `assets[${index}].readback`),
      required: requiredString(item?.required, `assets[${index}].required`),
    })),
  };
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Release readback plan ${label} must be a non-empty string.`,
    );
  }
  return value;
}
