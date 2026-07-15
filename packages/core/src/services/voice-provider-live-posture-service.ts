import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const voiceProviderLiveEvidenceSchema = "romeo.voice-provider-live-evidence.v1";

const requiredChecks = [
  "live_tts_preview_verified",
  "live_transcription_verified",
  "voice_artifact_readback_verified",
  "voice_artifact_deletion_verified",
  "streaming_consent_reviewed",
  "provider_failure_redaction_verified",
  "voice_log_redaction",
  "voice_evidence_redaction_reviewed",
] as const;

const redactionFields = [
  "rawAudioReturned",
  "rawEvidencePathsReturned",
  "rawObjectStoreKeysReturned",
  "rawProviderEndpointReturned",
  "rawProviderResponseReturned",
  "rawSpeechTextReturned",
  "rawTranscriptTextReturned",
  "secretValuesReturned",
  "tokenValuesReturned",
] as const;

type VoiceProviderLiveInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type VoiceProviderLivePostureWarning =
  | "voice_provider_live_artifact_missing"
  | "voice_provider_live_evidence_failed"
  | "voice_provider_live_evidence_invalid"
  | "voice_provider_live_evidence_not_configured"
  | "voice_provider_live_evidence_not_live"
  | "voice_provider_live_evidence_not_passed"
  | "voice_provider_live_deployment_invalid"
  | "voice_provider_live_failure_redaction_missing"
  | "voice_provider_live_log_redaction_missing"
  | "voice_provider_live_provider_credential_missing"
  | "voice_provider_live_provider_runtime_disabled"
  | "voice_provider_live_redaction_missing"
  | "voice_provider_live_required_checks_missing"
  | "voice_provider_live_streaming_consent_missing"
  | "voice_provider_live_transcription_missing"
  | "voice_provider_live_tts_missing";

export interface VoiceProviderLivePostureReport {
  schema: "romeo.voice-provider-live-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  runtime: {
    catalogVoiceCount: number;
    liveEvidencePathConfigured: boolean;
    providerCredentialConfigured: boolean;
    providerDriver: RomeoEnv["VOICE_PROVIDER_DRIVER"];
    transcriptionModelConfigured: boolean;
    ttsModelConfigured: boolean;
  };
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof voiceProviderLiveEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: VoiceProviderLiveInvalidReason;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredChecks)[number]>;
  };
  provider: {
    driver: "dev" | "disabled" | "openai-compatible" | "unknown";
    catalogSyncCount: number;
    configuredVoiceCount: number;
    providerFailureRedacted: boolean;
    transcriptionRequestCount: number;
    ttsRequestCount: number;
  };
  tts: {
    livePreviewVerified: boolean;
    generatedArtifactCount: number;
    generatedAudioBytes: number;
  };
  transcription: {
    liveTranscriptionVerified: boolean;
    audioBytes: number;
    promptProvided: boolean;
    transcriptLength: number;
  };
  artifacts: {
    readbackVerified: boolean;
    readbackBytes: number;
    deleteVerified: boolean;
    deletedArtifactCount: number;
  };
  streamingConsent: {
    streamingEnabled: boolean;
    reviewed: boolean;
    reviewedPolicyCount: number;
  };
  logRedaction: {
    appLogRedactionVerified: boolean;
    podLogRedactionVerified: boolean;
    appLogScanCount: number;
    podLogScanCount: number;
    rawAudioSentinelHitCount: number;
    rawSpeechTextSentinelHitCount: number;
    rawTranscriptSentinelHitCount: number;
    secretSentinelHitCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawAudioReturned: false;
    rawEvidencePathsReturned: false;
    rawObjectStoreKeysReturned: false;
    rawProviderEndpointReturned: false;
    rawProviderResponseReturned: false;
    rawSpeechTextReturned: false;
    rawTranscriptTextReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: VoiceProviderLivePostureWarning[];
}

export class VoiceProviderLivePostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<VoiceProviderLivePostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const runtime = runtimePosture(this.env);
    const evidence = await readEvidence(
      this.env.VOICE_PROVIDER_LIVE_EVIDENCE_PATH,
    );

    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        runtime,
        warnings: [
          ...runtimeWarnings(runtime),
          "voice_provider_live_evidence_not_configured",
        ],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        runtime,
        warnings: [
          ...runtimeWarnings(runtime),
          "voice_provider_live_evidence_invalid",
        ],
      });
    }

    const summary = summarizeEvidence(evidence.data, runtime);
    return {
      schema: "romeo.voice-provider-live-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      runtime,
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: VoiceProviderLiveInvalidReason }
  | { status: "valid"; data: Record<string, unknown> };

async function readEvidence(evidencePath: string): Promise<ReadEvidenceResult> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) return { status: "not_configured" };

  let raw: string;
  try {
    raw = await readFile(configuredPath, "utf8");
  } catch {
    return { status: "invalid", invalidReason: "read_failed" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", invalidReason: "invalid_json" };
  }

  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== voiceProviderLiveEvidenceSchema
  ) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }

  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: VoiceProviderLiveInvalidReason;
  orgId: string;
  runtime: VoiceProviderLivePostureReport["runtime"];
  warnings: VoiceProviderLivePostureReport["warnings"];
}): VoiceProviderLivePostureReport {
  return {
    schema: "romeo.voice-provider-live-posture.v1",
    generatedAt: input.generatedAt,
    orgId: input.orgId,
    status: "attention_required",
    runtime: input.runtime,
    evidence: {
      configured: input.invalidReason !== undefined,
      source:
        input.invalidReason === undefined
          ? "not_configured"
          : "configured_file",
      status: input.invalidReason === undefined ? "not_configured" : "invalid",
      ...(input.invalidReason === undefined
        ? {}
        : { invalidReason: input.invalidReason }),
      failureCodes:
        input.invalidReason === undefined ? [] : [input.invalidReason],
    },
    checks: {
      total: 0,
      requiredTotal: requiredChecks.length,
      requiredPresent: 0,
      missingRequired: [...requiredChecks],
    },
    provider: {
      driver: "unknown",
      catalogSyncCount: 0,
      configuredVoiceCount: 0,
      providerFailureRedacted: false,
      transcriptionRequestCount: 0,
      ttsRequestCount: 0,
    },
    tts: {
      livePreviewVerified: false,
      generatedArtifactCount: 0,
      generatedAudioBytes: 0,
    },
    transcription: {
      liveTranscriptionVerified: false,
      audioBytes: 0,
      promptProvided: false,
      transcriptLength: 0,
    },
    artifacts: {
      readbackVerified: false,
      readbackBytes: 0,
      deleteVerified: false,
      deletedArtifactCount: 0,
    },
    streamingConsent: {
      streamingEnabled: false,
      reviewed: false,
      reviewedPolicyCount: 0,
    },
    logRedaction: {
      appLogRedactionVerified: false,
      podLogRedactionVerified: false,
      appLogScanCount: 0,
      podLogScanCount: 0,
      rawAudioSentinelHitCount: 0,
      rawSpeechTextSentinelHitCount: 0,
      rawTranscriptSentinelHitCount: 0,
      secretSentinelHitCount: 0,
    },
    redaction: reportRedaction(),
    warnings: [...new Set(input.warnings)].sort(),
  };
}

function summarizeEvidence(
  data: Record<string, unknown>,
  runtime: VoiceProviderLivePostureReport["runtime"],
): Omit<
  VoiceProviderLivePostureReport,
  "generatedAt" | "orgId" | "runtime" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const provider = summarizeProvider(data.provider);
  const tts = summarizeTts(data.tts);
  const transcription = summarizeTranscription(data.transcription);
  const artifacts = summarizeArtifacts(data.artifacts);
  const streamingConsent = summarizeStreamingConsent(data.streamingConsent);
  const logRedaction = summarizeLogRedaction(data.logRedaction);
  const redactionPassed = evidenceRedactionPassed(data.redaction);
  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const deployment = deploymentValue(data.deployment);
  const failureCodes = failureCodesForEvidence({
    artifacts,
    checks,
    deployment,
    evidenceStatus,
    logRedaction,
    mode,
    provider,
    redactionPassed,
    streamingConsent,
    transcription,
    tts,
  });
  const warnings = [
    ...runtimeWarnings(runtime),
    ...warningsForFailureCodes(failureCodes, {
      evidenceStatus,
      mode,
      redactionPassed,
    }),
  ].sort();
  const postureStatus =
    evidenceStatus === "planned" || mode === "dry-run"
      ? "planned"
      : failureCodes.length > 0
        ? "failed"
        : "satisfied";

  return {
    evidence: {
      configured: true,
      source: "configured_file",
      status: postureStatus,
      schemaVersion: voiceProviderLiveEvidenceSchema,
      ...(typeof data.generatedAt === "string"
        ? { generatedAt: data.generatedAt }
        : {}),
      evidenceStatus,
      mode,
      deployment,
      failureCodes,
    },
    checks,
    provider,
    tts,
    transcription,
    artifacts,
    streamingConsent,
    logRedaction,
    redaction: reportRedaction(),
    warnings: [...new Set(warnings)],
  };
}

function summarizeChecks(
  value: unknown,
): VoiceProviderLivePostureReport["checks"] {
  const present = new Set(
    array(value).filter((item): item is string => typeof item === "string"),
  );
  const missingRequired = requiredChecks.filter((check) => !present.has(check));
  return {
    total: present.size,
    requiredTotal: requiredChecks.length,
    requiredPresent: requiredChecks.length - missingRequired.length,
    missingRequired,
  };
}

function summarizeProvider(
  value: unknown,
): VoiceProviderLivePostureReport["provider"] {
  if (!isRecord(value)) {
    return {
      driver: "unknown",
      catalogSyncCount: 0,
      configuredVoiceCount: 0,
      providerFailureRedacted: false,
      transcriptionRequestCount: 0,
      ttsRequestCount: 0,
    };
  }
  return {
    driver: providerDriver(value.driver),
    catalogSyncCount: numberValue(value.catalogSyncCount),
    configuredVoiceCount: numberValue(value.configuredVoiceCount),
    providerFailureRedacted: value.providerFailureRedacted === true,
    transcriptionRequestCount: numberValue(value.transcriptionRequestCount),
    ttsRequestCount: numberValue(value.ttsRequestCount),
  };
}

function summarizeTts(value: unknown): VoiceProviderLivePostureReport["tts"] {
  if (!isRecord(value)) {
    return {
      livePreviewVerified: false,
      generatedArtifactCount: 0,
      generatedAudioBytes: 0,
    };
  }
  return {
    livePreviewVerified: value.livePreviewVerified === true,
    generatedArtifactCount: numberValue(value.generatedArtifactCount),
    generatedAudioBytes: numberValue(value.generatedAudioBytes),
  };
}

function summarizeTranscription(
  value: unknown,
): VoiceProviderLivePostureReport["transcription"] {
  if (!isRecord(value)) {
    return {
      liveTranscriptionVerified: false,
      audioBytes: 0,
      promptProvided: false,
      transcriptLength: 0,
    };
  }
  return {
    liveTranscriptionVerified: value.liveTranscriptionVerified === true,
    audioBytes: numberValue(value.audioBytes),
    promptProvided: value.promptProvided === true,
    transcriptLength: numberValue(value.transcriptLength),
  };
}

function summarizeArtifacts(
  value: unknown,
): VoiceProviderLivePostureReport["artifacts"] {
  if (!isRecord(value)) {
    return {
      readbackVerified: false,
      readbackBytes: 0,
      deleteVerified: false,
      deletedArtifactCount: 0,
    };
  }
  return {
    readbackVerified: value.readbackVerified === true,
    readbackBytes: numberValue(value.readbackBytes),
    deleteVerified: value.deleteVerified === true,
    deletedArtifactCount: numberValue(value.deletedArtifactCount),
  };
}

function summarizeStreamingConsent(
  value: unknown,
): VoiceProviderLivePostureReport["streamingConsent"] {
  if (!isRecord(value)) {
    return {
      streamingEnabled: false,
      reviewed: false,
      reviewedPolicyCount: 0,
    };
  }
  return {
    streamingEnabled: value.streamingEnabled === true,
    reviewed: value.reviewed === true,
    reviewedPolicyCount: numberValue(value.reviewedPolicyCount),
  };
}

function summarizeLogRedaction(
  value: unknown,
): VoiceProviderLivePostureReport["logRedaction"] {
  if (!isRecord(value)) {
    return {
      appLogRedactionVerified: false,
      podLogRedactionVerified: false,
      appLogScanCount: 0,
      podLogScanCount: 0,
      rawAudioSentinelHitCount: 0,
      rawSpeechTextSentinelHitCount: 0,
      rawTranscriptSentinelHitCount: 0,
      secretSentinelHitCount: 0,
    };
  }
  return {
    appLogRedactionVerified: value.appLogRedactionVerified === true,
    podLogRedactionVerified: value.podLogRedactionVerified === true,
    appLogScanCount: numberValue(value.appLogScanCount),
    podLogScanCount: numberValue(value.podLogScanCount),
    rawAudioSentinelHitCount: numberValue(value.rawAudioSentinelHitCount),
    rawSpeechTextSentinelHitCount: numberValue(
      value.rawSpeechTextSentinelHitCount,
    ),
    rawTranscriptSentinelHitCount: numberValue(
      value.rawTranscriptSentinelHitCount,
    ),
    secretSentinelHitCount: numberValue(value.secretSentinelHitCount),
  };
}

function failureCodesForEvidence(input: {
  artifacts: VoiceProviderLivePostureReport["artifacts"];
  checks: VoiceProviderLivePostureReport["checks"];
  deployment: VoiceProviderLivePostureReport["evidence"]["deployment"];
  evidenceStatus: VoiceProviderLivePostureReport["evidence"]["evidenceStatus"];
  logRedaction: VoiceProviderLivePostureReport["logRedaction"];
  mode: VoiceProviderLivePostureReport["evidence"]["mode"];
  provider: VoiceProviderLivePostureReport["provider"];
  redactionPassed: boolean;
  streamingConsent: VoiceProviderLivePostureReport["streamingConsent"];
  transcription: VoiceProviderLivePostureReport["transcription"];
  tts: VoiceProviderLivePostureReport["tts"];
}): string[] {
  const failures: string[] = [];
  if (input.mode !== "live") failures.push("voice_provider_live_not_live");
  if (input.evidenceStatus !== "passed") {
    failures.push("voice_provider_live_not_passed");
  }
  if (
    input.deployment !== "compose" &&
    input.deployment !== "kubernetes" &&
    input.deployment !== "target"
  ) {
    failures.push("voice_provider_live_deployment_invalid");
  }
  for (const check of input.checks.missingRequired) {
    failures.push(`voice_provider_live_missing_check:${check}`);
  }
  if (
    input.provider.driver !== "openai-compatible" ||
    input.provider.catalogSyncCount <= 0 ||
    input.provider.configuredVoiceCount <= 0 ||
    input.provider.ttsRequestCount <= 0 ||
    input.tts.livePreviewVerified !== true ||
    input.tts.generatedArtifactCount <= 0 ||
    input.tts.generatedAudioBytes <= 0
  ) {
    failures.push("voice_provider_live_tts_invalid");
  }
  if (
    input.provider.transcriptionRequestCount <= 0 ||
    input.transcription.liveTranscriptionVerified !== true ||
    input.transcription.audioBytes <= 0 ||
    input.transcription.transcriptLength <= 0
  ) {
    failures.push("voice_provider_live_transcription_invalid");
  }
  if (
    input.artifacts.readbackVerified !== true ||
    input.artifacts.deleteVerified !== true ||
    input.artifacts.readbackBytes <= 0 ||
    input.artifacts.deletedArtifactCount <= 0
  ) {
    failures.push("voice_provider_live_artifact_invalid");
  }
  if (
    input.streamingConsent.reviewed !== true ||
    (input.streamingConsent.streamingEnabled &&
      input.streamingConsent.reviewedPolicyCount <= 0)
  ) {
    failures.push("voice_provider_live_streaming_consent_invalid");
  }
  if (input.provider.providerFailureRedacted !== true) {
    failures.push("voice_provider_live_failure_redaction_invalid");
  }
  if (
    input.logRedaction.appLogRedactionVerified !== true ||
    input.logRedaction.podLogRedactionVerified !== true ||
    input.logRedaction.appLogScanCount <= 0 ||
    input.logRedaction.podLogScanCount <= 0 ||
    input.logRedaction.rawAudioSentinelHitCount > 0 ||
    input.logRedaction.rawSpeechTextSentinelHitCount > 0 ||
    input.logRedaction.rawTranscriptSentinelHitCount > 0 ||
    input.logRedaction.secretSentinelHitCount > 0
  ) {
    failures.push("voice_provider_live_log_redaction_invalid");
  }
  if (!input.redactionPassed) {
    failures.push("voice_provider_live_redaction_missing");
  }
  return [...new Set(failures)];
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    evidenceStatus: VoiceProviderLivePostureReport["evidence"]["evidenceStatus"];
    mode: VoiceProviderLivePostureReport["evidence"]["mode"];
    redactionPassed: boolean;
  },
): VoiceProviderLivePostureReport["warnings"] {
  const warnings = new Set<VoiceProviderLivePostureWarning>();
  if (input.mode !== "live")
    warnings.add("voice_provider_live_evidence_not_live");
  if (input.evidenceStatus !== "passed")
    warnings.add("voice_provider_live_evidence_failed");
  if (failureCodes.includes("voice_provider_live_deployment_invalid")) {
    warnings.add("voice_provider_live_deployment_invalid");
  }
  if (
    failureCodes.some((code) =>
      code.startsWith("voice_provider_live_missing_check:"),
    )
  ) {
    warnings.add("voice_provider_live_required_checks_missing");
  }
  if (failureCodes.includes("voice_provider_live_tts_invalid")) {
    warnings.add("voice_provider_live_tts_missing");
  }
  if (failureCodes.includes("voice_provider_live_transcription_invalid")) {
    warnings.add("voice_provider_live_transcription_missing");
  }
  if (failureCodes.includes("voice_provider_live_artifact_invalid")) {
    warnings.add("voice_provider_live_artifact_missing");
  }
  if (failureCodes.includes("voice_provider_live_streaming_consent_invalid")) {
    warnings.add("voice_provider_live_streaming_consent_missing");
  }
  if (failureCodes.includes("voice_provider_live_failure_redaction_invalid")) {
    warnings.add("voice_provider_live_failure_redaction_missing");
  }
  if (failureCodes.includes("voice_provider_live_log_redaction_invalid")) {
    warnings.add("voice_provider_live_log_redaction_missing");
  }
  if (!input.redactionPassed)
    warnings.add("voice_provider_live_redaction_missing");
  return [...warnings];
}

function runtimeWarnings(
  runtime: VoiceProviderLivePostureReport["runtime"],
): VoiceProviderLivePostureReport["warnings"] {
  const warnings = new Set<VoiceProviderLivePostureWarning>();
  if (
    runtime.providerDriver === "disabled" ||
    runtime.providerDriver === "dev"
  ) {
    warnings.add("voice_provider_live_provider_runtime_disabled");
  }
  if (
    runtime.providerDriver === "openai-compatible" &&
    !runtime.providerCredentialConfigured
  ) {
    warnings.add("voice_provider_live_provider_credential_missing");
  }
  return [...warnings];
}

function runtimePosture(
  env: RomeoEnv,
): VoiceProviderLivePostureReport["runtime"] {
  return {
    catalogVoiceCount: voiceCatalogCount(env.VOICE_OPENAI_VOICES),
    liveEvidencePathConfigured:
      env.VOICE_PROVIDER_LIVE_EVIDENCE_PATH.trim().length > 0,
    providerCredentialConfigured:
      env.VOICE_PROVIDER_DRIVER !== "openai-compatible" ||
      env.VOICE_OPENAI_API_KEY.trim().length > 0,
    providerDriver: env.VOICE_PROVIDER_DRIVER,
    transcriptionModelConfigured:
      env.VOICE_OPENAI_TRANSCRIPTION_MODEL.trim().length > 0,
    ttsModelConfigured: env.VOICE_OPENAI_MODEL.trim().length > 0,
  };
}

function evidenceRedactionPassed(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return redactionFields.every((field) => value[field] === false);
}

function reportRedaction(): VoiceProviderLivePostureReport["redaction"] {
  return {
    evidenceFileBodyReturned: false,
    rawAudioReturned: false,
    rawEvidencePathsReturned: false,
    rawObjectStoreKeysReturned: false,
    rawProviderEndpointReturned: false,
    rawProviderResponseReturned: false,
    rawSpeechTextReturned: false,
    rawTranscriptTextReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function providerDriver(
  value: unknown,
): VoiceProviderLivePostureReport["provider"]["driver"] {
  if (
    value === "dev" ||
    value === "disabled" ||
    value === "openai-compatible"
  ) {
    return value;
  }
  return "unknown";
}

function statusValue(
  value: unknown,
): "failed" | "passed" | "planned" | "unknown" {
  if (value === "failed" || value === "passed" || value === "planned") {
    return value;
  }
  return "unknown";
}

function modeValue(value: unknown): "dry-run" | "live" | "unknown" {
  if (value === "dry-run" || value === "live") return value;
  return "unknown";
}

function deploymentValue(
  value: unknown,
): "compose" | "kubernetes" | "target" | "unknown" {
  if (value === "compose" || value === "kubernetes" || value === "target") {
    return value;
  }
  return "unknown";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function voiceCatalogCount(value: string): number {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0).length;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
