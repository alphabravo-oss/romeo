import { ApiError } from "../errors";
import { publicBrowserAutomationArtifact } from "./workflow-browser-tasks";
import type {
  BrowserAutomationArtifactSummary,
  BrowserAutomationCompletionResult,
  BrowserAutomationStoredArtifact,
} from "./workflow-browser-tasks";

export const browserAutomationArtifactUploadTtlSeconds = 900;
export const browserAutomationArtifactMaxBytes = 50 * 1024 * 1024;

export const allowedScreenshotArtifactContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const allowedTraceArtifactContentTypes = new Set([
  "application/gzip",
  "application/json",
  "application/octet-stream",
  "application/x-ndjson",
  "application/zip",
]);

export function normalizeArtifactUploadInput(input: {
  contentType: string;
  sizeBytes: number;
  type: "screenshot" | "trace";
}): {
  contentType: string;
  sizeBytes: number;
  type: "screenshot" | "trace";
} {
  const contentType = input.contentType.trim().toLowerCase();
  const allowed =
    input.type === "screenshot"
      ? allowedScreenshotArtifactContentTypes
      : allowedTraceArtifactContentTypes;
  if (!allowed.has(contentType)) {
    throw new ApiError(
      "browser_automation_artifact_content_type_invalid",
      "Browser automation artifact content type is not allowed.",
      400,
      {
        allowedContentTypes: [...allowed].sort(),
        type: input.type,
      },
    );
  }
  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > browserAutomationArtifactMaxBytes
  ) {
    throw new ApiError(
      "browser_automation_artifact_size_invalid",
      "Browser automation artifact size is outside the allowed range.",
      400,
      { maxBytes: browserAutomationArtifactMaxBytes },
    );
  }
  return { contentType, sizeBytes: input.sizeBytes, type: input.type };
}

export function artifactExtension(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/gzip":
      return "gz";
    case "application/json":
      return "json";
    case "application/x-ndjson":
      return "ndjson";
    case "application/zip":
      return "zip";
    default:
      return "bin";
  }
}

export function withRegisteredArtifacts(
  result: BrowserAutomationCompletionResult,
  storedArtifacts: BrowserAutomationStoredArtifact[],
): BrowserAutomationCompletionResult {
  const registeredArtifacts = storedArtifacts.map(
    publicBrowserAutomationArtifact,
  );
  if (registeredArtifacts.length === 0) {
    if (result.artifacts === undefined) return result;
    return {
      ...result,
      artifacts: result.artifacts.map(withoutArtifactUrl),
    };
  }
  if (result.artifacts === undefined) {
    return {
      ...result,
      artifactCount: result.artifactCount ?? registeredArtifacts.length,
      artifacts: registeredArtifacts,
    };
  }
  const registeredById = new Map(
    registeredArtifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const artifacts = result.artifacts.map(
    (artifact) =>
      registeredById.get(artifact.artifactId) ?? withoutArtifactUrl(artifact),
  );
  const seen = new Set(artifacts.map((artifact) => artifact.artifactId));
  for (const registered of registeredArtifacts) {
    if (!seen.has(registered.artifactId)) artifacts.push(registered);
  }
  return {
    ...result,
    artifactCount: result.artifactCount ?? artifacts.length,
    artifacts,
  };
}

function withoutArtifactUrl(
  artifact: BrowserAutomationArtifactSummary,
): BrowserAutomationArtifactSummary {
  return {
    artifactId: artifact.artifactId,
    type: artifact.type,
    ...(artifact.contentType === undefined
      ? {}
      : { contentType: artifact.contentType }),
    ...(artifact.sizeBytes === undefined
      ? {}
      : { sizeBytes: artifact.sizeBytes }),
  };
}
