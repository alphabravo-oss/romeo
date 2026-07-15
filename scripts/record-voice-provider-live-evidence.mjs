import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "live_tts_preview_verified",
  "live_transcription_verified",
  "voice_artifact_readback_verified",
  "voice_artifact_deletion_verified",
  "streaming_consent_reviewed",
  "provider_failure_redaction_verified",
  "voice_log_redaction",
  "voice_evidence_redaction_reviewed",
];

const output = argValue("--output");
if (output === undefined || output.length === 0) {
  throw new Error("--output is required.");
}

const status = enumArg("--status", ["passed", "failed", "planned"], "passed");
const mode = enumArg("--mode", ["live", "dry-run"], "live");
const deployment = enumArg(
  "--deployment",
  ["compose", "kubernetes", "target"],
  "kubernetes",
);

const providerDriver = enumArg(
  "--provider-driver",
  ["openai-compatible", "dev", "disabled"],
  "openai-compatible",
);
const catalogSyncCount = nonNegativeInteger(argValue("--catalog-sync-count"), {
  fallback: "1",
  label: "--catalog-sync-count",
});
const configuredVoiceCount = nonNegativeInteger(
  argValue("--configured-voice-count"),
  { fallback: "1", label: "--configured-voice-count" },
);
const ttsRequestCount = nonNegativeInteger(argValue("--tts-request-count"), {
  fallback: "1",
  label: "--tts-request-count",
});
const transcriptionRequestCount = nonNegativeInteger(
  argValue("--transcription-request-count"),
  { fallback: "1", label: "--transcription-request-count" },
);
const providerFailureRedacted = booleanArg("--provider-failure-redacted", true);

const livePreviewVerified = booleanArg("--live-preview-verified", true);
const generatedArtifactCount = nonNegativeInteger(
  argValue("--generated-artifact-count"),
  { fallback: "1", label: "--generated-artifact-count" },
);
const generatedAudioBytes = nonNegativeInteger(
  argValue("--generated-audio-bytes"),
  { fallback: "44", label: "--generated-audio-bytes" },
);

const liveTranscriptionVerified = booleanArg(
  "--live-transcription-verified",
  true,
);
const transcriptionAudioBytes = nonNegativeInteger(
  argValue("--transcription-audio-bytes"),
  { fallback: "4", label: "--transcription-audio-bytes" },
);
const transcriptionPromptProvided = booleanArg(
  "--transcription-prompt-provided",
  true,
);
const transcriptLength = nonNegativeInteger(argValue("--transcript-length"), {
  fallback: "24",
  label: "--transcript-length",
});

const artifactReadbackVerified = booleanArg(
  "--artifact-readback-verified",
  true,
);
const artifactReadbackBytes = nonNegativeInteger(
  argValue("--artifact-readback-bytes"),
  { fallback: "44", label: "--artifact-readback-bytes" },
);
const artifactDeleteVerified = booleanArg("--artifact-delete-verified", true);
const deletedArtifactCount = nonNegativeInteger(
  argValue("--deleted-artifact-count"),
  { fallback: "1", label: "--deleted-artifact-count" },
);

const streamingEnabled = booleanArg("--streaming-enabled", false);
const streamingConsentReviewed = booleanArg(
  "--streaming-consent-reviewed",
  true,
);
const streamingConsentPolicyCount = nonNegativeInteger(
  argValue("--streaming-consent-policy-count"),
  {
    fallback: streamingEnabled ? "1" : "0",
    label: "--streaming-consent-policy-count",
  },
);

const appLogRedactionVerified = booleanArg(
  "--app-log-redaction-verified",
  true,
);
const podLogRedactionVerified = booleanArg(
  "--pod-log-redaction-verified",
  true,
);
const appLogScanCount = nonNegativeInteger(argValue("--app-log-scan-count"), {
  fallback: "1",
  label: "--app-log-scan-count",
});
const podLogScanCount = nonNegativeInteger(argValue("--pod-log-scan-count"), {
  fallback: "1",
  label: "--pod-log-scan-count",
});
const rawAudioSentinelHitCount = nonNegativeInteger(
  argValue("--raw-audio-sentinel-hit-count"),
  { fallback: "0", label: "--raw-audio-sentinel-hit-count" },
);
const rawSpeechTextSentinelHitCount = nonNegativeInteger(
  argValue("--raw-speech-text-sentinel-hit-count"),
  { fallback: "0", label: "--raw-speech-text-sentinel-hit-count" },
);
const rawTranscriptSentinelHitCount = nonNegativeInteger(
  argValue("--raw-transcript-sentinel-hit-count"),
  { fallback: "0", label: "--raw-transcript-sentinel-hit-count" },
);
const secretSentinelHitCount = nonNegativeInteger(
  argValue("--secret-sentinel-hit-count"),
  { fallback: "0", label: "--secret-sentinel-hit-count" },
);

const rawAudioReturned = booleanArg("--raw-audio-returned", false);
const rawEvidencePathsReturned = booleanArg(
  "--raw-evidence-paths-returned",
  false,
);
const rawObjectStoreKeysReturned = booleanArg(
  "--raw-object-store-keys-returned",
  false,
);
const rawProviderEndpointReturned = booleanArg(
  "--raw-provider-endpoint-returned",
  false,
);
const rawProviderResponseReturned = booleanArg(
  "--raw-provider-response-returned",
  false,
);
const rawSpeechTextReturned = booleanArg("--raw-speech-text-returned", false);
const rawTranscriptTextReturned = booleanArg(
  "--raw-transcript-text-returned",
  false,
);
const secretValuesReturned = booleanArg("--secret-values-returned", false);
const tokenValuesReturned = booleanArg("--token-values-returned", false);
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed voice provider live evidence is invalid: ${failures.join(", ")}`,
  );
}
if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with failed/planned.");
}

const checks =
  status === "passed"
    ? [...requiredChecks]
    : requiredChecks.filter((check) => !failures.includes(checkFailure(check)));

const evidence = {
  schemaVersion: "romeo.voice-provider-live-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks,
  provider: {
    driver: providerDriver,
    catalogSyncCount,
    configuredVoiceCount,
    providerFailureRedacted,
    transcriptionRequestCount,
    ttsRequestCount,
  },
  tts: {
    livePreviewVerified,
    generatedArtifactCount,
    generatedAudioBytes,
  },
  transcription: {
    liveTranscriptionVerified,
    audioBytes: transcriptionAudioBytes,
    promptProvided: transcriptionPromptProvided,
    transcriptLength,
  },
  artifacts: {
    readbackVerified: artifactReadbackVerified,
    readbackBytes: artifactReadbackBytes,
    deleteVerified: artifactDeleteVerified,
    deletedArtifactCount,
  },
  streamingConsent: {
    streamingEnabled,
    reviewed: streamingConsentReviewed,
    reviewedPolicyCount: streamingConsentPolicyCount,
  },
  logRedaction: {
    appLogRedactionVerified,
    podLogRedactionVerified,
    appLogScanCount,
    podLogScanCount,
    rawAudioSentinelHitCount,
    rawSpeechTextSentinelHitCount,
    rawTranscriptSentinelHitCount,
    secretSentinelHitCount,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    rawAudioReturned,
    rawEvidencePathsReturned,
    rawObjectStoreKeysReturned,
    rawProviderEndpointReturned,
    rawProviderResponseReturned,
    rawSpeechTextReturned,
    rawTranscriptTextReturned,
    secretValuesReturned,
    tokenValuesReturned,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote voice provider live evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (
    providerDriver !== "openai-compatible" ||
    catalogSyncCount <= 0 ||
    configuredVoiceCount <= 0 ||
    ttsRequestCount <= 0 ||
    !livePreviewVerified ||
    generatedArtifactCount <= 0 ||
    generatedAudioBytes <= 0
  ) {
    failures.push("live_tts_preview_missing");
  }
  if (
    transcriptionRequestCount <= 0 ||
    !liveTranscriptionVerified ||
    transcriptionAudioBytes <= 0 ||
    transcriptLength <= 0
  ) {
    failures.push("live_transcription_missing");
  }
  if (!artifactReadbackVerified || artifactReadbackBytes <= 0) {
    failures.push("voice_artifact_readback_missing");
  }
  if (!artifactDeleteVerified || deletedArtifactCount <= 0) {
    failures.push("voice_artifact_deletion_missing");
  }
  if (
    streamingEnabled &&
    (!streamingConsentReviewed || streamingConsentPolicyCount <= 0)
  ) {
    failures.push("streaming_consent_missing");
  }
  if (!providerFailureRedacted) {
    failures.push("provider_failure_redaction_missing");
  }
  if (
    !appLogRedactionVerified ||
    !podLogRedactionVerified ||
    appLogScanCount <= 0 ||
    podLogScanCount <= 0 ||
    rawAudioSentinelHitCount > 0 ||
    rawSpeechTextSentinelHitCount > 0 ||
    rawTranscriptSentinelHitCount > 0 ||
    secretSentinelHitCount > 0
  ) {
    failures.push("voice_log_redaction_missing");
  }
  if (
    rawAudioReturned ||
    rawEvidencePathsReturned ||
    rawObjectStoreKeysReturned ||
    rawProviderEndpointReturned ||
    rawProviderResponseReturned ||
    rawSpeechTextReturned ||
    rawTranscriptTextReturned ||
    secretValuesReturned ||
    tokenValuesReturned
  ) {
    failures.push("voice_evidence_redaction_missing");
  }
  return failures;
}

function checkFailure(check) {
  return {
    live_tts_preview_verified: "live_tts_preview_missing",
    live_transcription_verified: "live_transcription_missing",
    voice_artifact_readback_verified: "voice_artifact_readback_missing",
    voice_artifact_deletion_verified: "voice_artifact_deletion_missing",
    streaming_consent_reviewed: "streaming_consent_missing",
    provider_failure_redaction_verified: "provider_failure_redaction_missing",
    voice_log_redaction: "voice_log_redaction_missing",
    voice_evidence_redaction_reviewed: "voice_evidence_redaction_missing",
  }[check];
}

function enumArg(name, allowedValues, fallback) {
  const value = argValue(name) ?? fallback;
  if (value === undefined || !allowedValues.includes(value)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(", ")}.`);
  }
  return value;
}

function booleanArg(name, fallback) {
  const value = argValue(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function nonNegativeInteger(value, options) {
  const resolved = value ?? options.fallback;
  const parsed = Number.parseInt(resolved, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${options.label} must be a non-negative integer.`);
  }
  return parsed;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
