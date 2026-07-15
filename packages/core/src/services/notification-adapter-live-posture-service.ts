import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const notificationAdapterLiveEvidenceSchema =
  "romeo.notification-adapter-live-evidence.v1";

const requiredChecks = [
  "live_notification_delivery_verified",
  "mixed_channel_type_delivery_verified",
  "secret_ref_resolution_verified",
  "notification_egress_policy_verified",
  "provider_payload_redaction_verified",
  "channel_type_isolation_verified",
  "retry_and_dead_letter_verified",
  "notification_log_redaction",
  "notification_evidence_redaction_reviewed",
] as const;

const redactionFields = [
  "rawDestinationsReturned",
  "rawEndpointUrlsReturned",
  "rawEvidencePathsReturned",
  "rawLogLinesReturned",
  "rawMessageBodiesReturned",
  "rawProviderResponsesReturned",
  "rawSecretRefsReturned",
  "secretValuesReturned",
  "tokenValuesReturned",
] as const;

type NotificationAdapterLiveInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type NotificationAdapterLivePostureWarning =
  | "notification_adapter_live_channel_isolation_missing"
  | "notification_adapter_live_channel_mix_missing"
  | "notification_adapter_live_delivery_missing"
  | "notification_adapter_live_deployment_invalid"
  | "notification_adapter_live_egress_missing"
  | "notification_adapter_live_evidence_failed"
  | "notification_adapter_live_evidence_invalid"
  | "notification_adapter_live_evidence_not_configured"
  | "notification_adapter_live_evidence_not_live"
  | "notification_adapter_live_log_redaction_missing"
  | "notification_adapter_live_policy_invalid"
  | "notification_adapter_live_provider_credential_missing"
  | "notification_adapter_live_redaction_missing"
  | "notification_adapter_live_required_checks_missing"
  | "notification_adapter_live_retry_dead_letter_missing"
  | "notification_adapter_live_runtime_disabled"
  | "notification_adapter_live_secret_resolution_missing";

export interface NotificationAdapterLivePostureReport {
  schema: "romeo.notification-adapter-live-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  runtime: {
    deliveryDriver: RomeoEnv["NOTIFICATION_DELIVERY_DRIVER"];
    emailDeliveryDriver: RomeoEnv["NOTIFICATION_EMAIL_DELIVERY_DRIVER"];
    fcmConfigured: boolean;
    liveEvidencePathConfigured: boolean;
    pagerDutyConfigured: boolean;
    providerEndpointCount: number;
    resendConfigured: boolean;
    secretResolverConfigured: boolean;
    smtpConfigured: boolean;
  };
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof notificationAdapterLiveEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: NotificationAdapterLiveInvalidReason;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredChecks)[number]>;
  };
  delivery: {
    attemptedCount: number;
    deliveryDriver: RomeoEnv["NOTIFICATION_DELIVERY_DRIVER"] | "unknown";
    failedCount: number;
    providerFamilyCount: number;
    providerPayloadRedacted: boolean;
    successfulCount: number;
  };
  channels: {
    emailCount: number;
    mobilePushCount: number;
    mixedChannelTypesVerified: boolean;
    pagerDutyCount: number;
    slackCount: number;
    teamsCount: number;
    total: number;
    webhookCount: number;
  };
  secrets: {
    secretRefResolutionCount: number;
    secretResolverBoundaryVerified: boolean;
  };
  policy: {
    channelTypeIsolationVerified: boolean;
    deadLetterCount: number;
    retrySuccessCount: number;
    suppressionVerified: boolean;
  };
  egress: {
    hostAllowlistEnforced: boolean;
    networkPolicyEnforced: boolean;
    privateNetworkDenied: boolean;
    providerEndpointAccessVerified: boolean;
  };
  logRedaction: {
    appLogRedactionVerified: boolean;
    appLogScanCount: number;
    bodySentinelHitCount: number;
    destinationSentinelHitCount: number;
    podLogRedactionVerified: boolean;
    podLogScanCount: number;
    secretSentinelHitCount: number;
    tokenSentinelHitCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawDestinationsReturned: false;
    rawEndpointUrlsReturned: false;
    rawEvidencePathsReturned: false;
    rawLogLinesReturned: false;
    rawMessageBodiesReturned: false;
    rawProviderResponsesReturned: false;
    rawSecretRefsReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: NotificationAdapterLivePostureWarning[];
}

export class NotificationAdapterLivePostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(
    subject: AuthSubject,
  ): Promise<NotificationAdapterLivePostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const runtime = runtimePosture(this.env);
    const evidence = await readEvidence(
      this.env.NOTIFICATION_ADAPTER_LIVE_EVIDENCE_PATH,
    );

    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        runtime,
        warnings: [
          ...runtimeWarnings(runtime),
          "notification_adapter_live_evidence_not_configured",
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
          "notification_adapter_live_evidence_invalid",
        ],
      });
    }

    const summary = summarizeEvidence(evidence.data, runtime);
    return {
      schema: "romeo.notification-adapter-live-posture.v1",
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
  | { status: "invalid"; invalidReason: NotificationAdapterLiveInvalidReason }
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
    parsed.schemaVersion !== notificationAdapterLiveEvidenceSchema
  ) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }

  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: NotificationAdapterLiveInvalidReason;
  orgId: string;
  runtime: NotificationAdapterLivePostureReport["runtime"];
  warnings: NotificationAdapterLivePostureReport["warnings"];
}): NotificationAdapterLivePostureReport {
  return {
    schema: "romeo.notification-adapter-live-posture.v1",
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
    delivery: {
      attemptedCount: 0,
      deliveryDriver: "unknown",
      failedCount: 0,
      providerFamilyCount: 0,
      providerPayloadRedacted: false,
      successfulCount: 0,
    },
    channels: {
      emailCount: 0,
      mobilePushCount: 0,
      mixedChannelTypesVerified: false,
      pagerDutyCount: 0,
      slackCount: 0,
      teamsCount: 0,
      total: 0,
      webhookCount: 0,
    },
    secrets: {
      secretRefResolutionCount: 0,
      secretResolverBoundaryVerified: false,
    },
    policy: {
      channelTypeIsolationVerified: false,
      deadLetterCount: 0,
      retrySuccessCount: 0,
      suppressionVerified: false,
    },
    egress: {
      hostAllowlistEnforced: false,
      networkPolicyEnforced: false,
      privateNetworkDenied: false,
      providerEndpointAccessVerified: false,
    },
    logRedaction: {
      appLogRedactionVerified: false,
      appLogScanCount: 0,
      bodySentinelHitCount: 0,
      destinationSentinelHitCount: 0,
      podLogRedactionVerified: false,
      podLogScanCount: 0,
      secretSentinelHitCount: 0,
      tokenSentinelHitCount: 0,
    },
    redaction: reportRedaction(),
    warnings: [...new Set(input.warnings)].sort(),
  };
}

function summarizeEvidence(
  data: Record<string, unknown>,
  runtime: NotificationAdapterLivePostureReport["runtime"],
): Omit<
  NotificationAdapterLivePostureReport,
  "generatedAt" | "orgId" | "runtime" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const delivery = summarizeDelivery(data.delivery);
  const channels = summarizeChannels(data.channels);
  const secrets = summarizeSecrets(data.secrets);
  const policy = summarizePolicy(data.policy);
  const egress = summarizeEgress(data.egress);
  const logRedaction = summarizeLogRedaction(data.logRedaction);
  const redactionPassed = evidenceRedactionPassed(data.redaction);
  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const deployment = deploymentValue(data.deployment);
  const failureCodes = failureCodesForEvidence({
    channels,
    checks,
    delivery,
    deployment,
    egress,
    evidenceStatus,
    logRedaction,
    mode,
    policy,
    redactionPassed,
    secrets,
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
      schemaVersion: notificationAdapterLiveEvidenceSchema,
      ...(typeof data.generatedAt === "string"
        ? { generatedAt: data.generatedAt }
        : {}),
      evidenceStatus,
      mode,
      deployment,
      failureCodes,
    },
    checks,
    delivery,
    channels,
    secrets,
    policy,
    egress,
    logRedaction,
    redaction: reportRedaction(),
    warnings: [...new Set(warnings)],
  };
}

function summarizeChecks(
  value: unknown,
): NotificationAdapterLivePostureReport["checks"] {
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

function summarizeDelivery(
  value: unknown,
): NotificationAdapterLivePostureReport["delivery"] {
  if (!isRecord(value)) {
    return {
      attemptedCount: 0,
      deliveryDriver: "unknown",
      failedCount: 0,
      providerFamilyCount: 0,
      providerPayloadRedacted: false,
      successfulCount: 0,
    };
  }
  return {
    attemptedCount: numberValue(value.attemptedCount),
    deliveryDriver: deliveryDriver(value.deliveryDriver),
    failedCount: numberValue(value.failedCount),
    providerFamilyCount: numberValue(value.providerFamilyCount),
    providerPayloadRedacted: value.providerPayloadRedacted === true,
    successfulCount: numberValue(value.successfulCount),
  };
}

function summarizeChannels(
  value: unknown,
): NotificationAdapterLivePostureReport["channels"] {
  if (!isRecord(value)) {
    return {
      emailCount: 0,
      mobilePushCount: 0,
      mixedChannelTypesVerified: false,
      pagerDutyCount: 0,
      slackCount: 0,
      teamsCount: 0,
      total: 0,
      webhookCount: 0,
    };
  }
  return {
    emailCount: numberValue(value.emailCount),
    mobilePushCount: numberValue(value.mobilePushCount),
    mixedChannelTypesVerified: value.mixedChannelTypesVerified === true,
    pagerDutyCount: numberValue(value.pagerDutyCount),
    slackCount: numberValue(value.slackCount),
    teamsCount: numberValue(value.teamsCount),
    total: numberValue(value.total),
    webhookCount: numberValue(value.webhookCount),
  };
}

function summarizeSecrets(
  value: unknown,
): NotificationAdapterLivePostureReport["secrets"] {
  if (!isRecord(value)) {
    return {
      secretRefResolutionCount: 0,
      secretResolverBoundaryVerified: false,
    };
  }
  return {
    secretRefResolutionCount: numberValue(value.secretRefResolutionCount),
    secretResolverBoundaryVerified:
      value.secretResolverBoundaryVerified === true,
  };
}

function summarizePolicy(
  value: unknown,
): NotificationAdapterLivePostureReport["policy"] {
  if (!isRecord(value)) {
    return {
      channelTypeIsolationVerified: false,
      deadLetterCount: 0,
      retrySuccessCount: 0,
      suppressionVerified: false,
    };
  }
  return {
    channelTypeIsolationVerified: value.channelTypeIsolationVerified === true,
    deadLetterCount: numberValue(value.deadLetterCount),
    retrySuccessCount: numberValue(value.retrySuccessCount),
    suppressionVerified: value.suppressionVerified === true,
  };
}

function summarizeEgress(
  value: unknown,
): NotificationAdapterLivePostureReport["egress"] {
  if (!isRecord(value)) {
    return {
      hostAllowlistEnforced: false,
      networkPolicyEnforced: false,
      privateNetworkDenied: false,
      providerEndpointAccessVerified: false,
    };
  }
  return {
    hostAllowlistEnforced: value.hostAllowlistEnforced === true,
    networkPolicyEnforced: value.networkPolicyEnforced === true,
    privateNetworkDenied: value.privateNetworkDenied === true,
    providerEndpointAccessVerified:
      value.providerEndpointAccessVerified === true,
  };
}

function summarizeLogRedaction(
  value: unknown,
): NotificationAdapterLivePostureReport["logRedaction"] {
  if (!isRecord(value)) {
    return {
      appLogRedactionVerified: false,
      appLogScanCount: 0,
      bodySentinelHitCount: 0,
      destinationSentinelHitCount: 0,
      podLogRedactionVerified: false,
      podLogScanCount: 0,
      secretSentinelHitCount: 0,
      tokenSentinelHitCount: 0,
    };
  }
  return {
    appLogRedactionVerified: value.appLogRedactionVerified === true,
    appLogScanCount: numberValue(value.appLogScanCount),
    bodySentinelHitCount: numberValue(value.bodySentinelHitCount),
    destinationSentinelHitCount: numberValue(value.destinationSentinelHitCount),
    podLogRedactionVerified: value.podLogRedactionVerified === true,
    podLogScanCount: numberValue(value.podLogScanCount),
    secretSentinelHitCount: numberValue(value.secretSentinelHitCount),
    tokenSentinelHitCount: numberValue(value.tokenSentinelHitCount),
  };
}

function failureCodesForEvidence(input: {
  channels: NotificationAdapterLivePostureReport["channels"];
  checks: NotificationAdapterLivePostureReport["checks"];
  delivery: NotificationAdapterLivePostureReport["delivery"];
  deployment: NotificationAdapterLivePostureReport["evidence"]["deployment"];
  egress: NotificationAdapterLivePostureReport["egress"];
  evidenceStatus: NotificationAdapterLivePostureReport["evidence"]["evidenceStatus"];
  logRedaction: NotificationAdapterLivePostureReport["logRedaction"];
  mode: NotificationAdapterLivePostureReport["evidence"]["mode"];
  policy: NotificationAdapterLivePostureReport["policy"];
  redactionPassed: boolean;
  secrets: NotificationAdapterLivePostureReport["secrets"];
}): string[] {
  const failures: string[] = [];
  if (input.mode !== "live")
    failures.push("notification_adapter_live_not_live");
  if (input.evidenceStatus !== "passed") {
    failures.push("notification_adapter_live_not_passed");
  }
  if (
    input.deployment !== "compose" &&
    input.deployment !== "kubernetes" &&
    input.deployment !== "target"
  ) {
    failures.push("notification_adapter_live_deployment_invalid");
  }
  for (const check of input.checks.missingRequired) {
    failures.push(`notification_adapter_live_missing_check:${check}`);
  }
  if (
    input.delivery.deliveryDriver === "disabled" ||
    input.delivery.attemptedCount <= 0 ||
    input.delivery.successfulCount <= 0 ||
    input.delivery.providerFamilyCount <= 0 ||
    input.delivery.providerPayloadRedacted !== true
  ) {
    failures.push("notification_adapter_live_delivery_invalid");
  }
  if (
    input.channels.total <= 1 ||
    input.channels.mixedChannelTypesVerified !== true
  ) {
    failures.push("notification_adapter_live_channel_mix_invalid");
  }
  if (
    input.secrets.secretRefResolutionCount <= 0 ||
    input.secrets.secretResolverBoundaryVerified !== true
  ) {
    failures.push("notification_adapter_live_secret_resolution_invalid");
  }
  if (
    input.egress.networkPolicyEnforced !== true ||
    input.egress.hostAllowlistEnforced !== true ||
    input.egress.privateNetworkDenied !== true ||
    input.egress.providerEndpointAccessVerified !== true
  ) {
    failures.push("notification_adapter_live_egress_invalid");
  }
  if (
    input.policy.suppressionVerified !== true ||
    input.policy.retrySuccessCount <= 0 ||
    input.policy.deadLetterCount <= 0 ||
    input.policy.channelTypeIsolationVerified !== true
  ) {
    failures.push("notification_adapter_live_policy_invalid");
  }
  if (
    input.logRedaction.appLogRedactionVerified !== true ||
    input.logRedaction.podLogRedactionVerified !== true ||
    input.logRedaction.appLogScanCount <= 0 ||
    input.logRedaction.podLogScanCount <= 0 ||
    input.logRedaction.destinationSentinelHitCount > 0 ||
    input.logRedaction.bodySentinelHitCount > 0 ||
    input.logRedaction.secretSentinelHitCount > 0 ||
    input.logRedaction.tokenSentinelHitCount > 0
  ) {
    failures.push("notification_adapter_live_log_redaction_invalid");
  }
  if (!input.redactionPassed) {
    failures.push("notification_adapter_live_redaction_missing");
  }
  return [...new Set(failures)];
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    evidenceStatus: NotificationAdapterLivePostureReport["evidence"]["evidenceStatus"];
    mode: NotificationAdapterLivePostureReport["evidence"]["mode"];
    redactionPassed: boolean;
  },
): NotificationAdapterLivePostureReport["warnings"] {
  const warnings = new Set<NotificationAdapterLivePostureWarning>();
  if (input.mode !== "live") {
    warnings.add("notification_adapter_live_evidence_not_live");
  }
  if (input.evidenceStatus !== "passed") {
    warnings.add("notification_adapter_live_evidence_failed");
  }
  if (failureCodes.includes("notification_adapter_live_deployment_invalid")) {
    warnings.add("notification_adapter_live_deployment_invalid");
  }
  if (
    failureCodes.some((code) =>
      code.startsWith("notification_adapter_live_missing_check:"),
    )
  ) {
    warnings.add("notification_adapter_live_required_checks_missing");
  }
  if (failureCodes.includes("notification_adapter_live_delivery_invalid")) {
    warnings.add("notification_adapter_live_delivery_missing");
  }
  if (failureCodes.includes("notification_adapter_live_channel_mix_invalid")) {
    warnings.add("notification_adapter_live_channel_mix_missing");
  }
  if (failureCodes.includes("notification_adapter_live_egress_invalid")) {
    warnings.add("notification_adapter_live_egress_missing");
  }
  if (
    failureCodes.includes("notification_adapter_live_secret_resolution_invalid")
  ) {
    warnings.add("notification_adapter_live_secret_resolution_missing");
  }
  if (failureCodes.includes("notification_adapter_live_policy_invalid")) {
    warnings.add("notification_adapter_live_policy_invalid");
  }
  if (
    failureCodes.includes("notification_adapter_live_log_redaction_invalid")
  ) {
    warnings.add("notification_adapter_live_log_redaction_missing");
  }
  if (!input.redactionPassed) {
    warnings.add("notification_adapter_live_redaction_missing");
  }
  return [...warnings];
}

function runtimeWarnings(
  runtime: NotificationAdapterLivePostureReport["runtime"],
): NotificationAdapterLivePostureReport["warnings"] {
  const warnings = new Set<NotificationAdapterLivePostureWarning>();
  if (runtime.deliveryDriver === "disabled") {
    warnings.add("notification_adapter_live_runtime_disabled");
  }
  if (
    (runtime.deliveryDriver === "resend-email" && !runtime.resendConfigured) ||
    (runtime.deliveryDriver === "smtp-email" && !runtime.smtpConfigured) ||
    (runtime.deliveryDriver === "fcm-mobile-push" && !runtime.fcmConfigured)
  ) {
    warnings.add("notification_adapter_live_provider_credential_missing");
  }
  return [...warnings];
}

function runtimePosture(
  env: RomeoEnv,
): NotificationAdapterLivePostureReport["runtime"] {
  const endpointConfigured = [
    env.NOTIFICATION_FCM_BASE_URL,
    env.NOTIFICATION_FCM_TOKEN_URL,
    env.NOTIFICATION_PAGERDUTY_EVENTS_URL,
    env.NOTIFICATION_RESEND_BASE_URL,
  ].filter((value) => value.trim().length > 0).length;
  return {
    deliveryDriver: env.NOTIFICATION_DELIVERY_DRIVER,
    emailDeliveryDriver: env.NOTIFICATION_EMAIL_DELIVERY_DRIVER,
    fcmConfigured:
      env.NOTIFICATION_FCM_PROJECT_ID.trim().length > 0 &&
      env.NOTIFICATION_FCM_SERVICE_ACCOUNT_REF.trim().length > 0,
    liveEvidencePathConfigured:
      env.NOTIFICATION_ADAPTER_LIVE_EVIDENCE_PATH.trim().length > 0,
    pagerDutyConfigured:
      env.NOTIFICATION_PAGERDUTY_EVENTS_URL.trim().length > 0,
    providerEndpointCount: endpointConfigured,
    resendConfigured:
      env.NOTIFICATION_RESEND_API_KEY.trim().length > 0 &&
      env.NOTIFICATION_RESEND_BASE_URL.trim().length > 0,
    secretResolverConfigured: env.SECRET_RESOLVER_DRIVER !== "disabled",
    smtpConfigured:
      env.NOTIFICATION_SMTP_HOST.trim().length > 0 &&
      env.NOTIFICATION_SMTP_USER.trim().length > 0 &&
      env.NOTIFICATION_SMTP_PASSWORD.trim().length > 0,
  };
}

function evidenceRedactionPassed(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return redactionFields.every((field) => value[field] === false);
}

function reportRedaction(): NotificationAdapterLivePostureReport["redaction"] {
  return {
    evidenceFileBodyReturned: false,
    rawDestinationsReturned: false,
    rawEndpointUrlsReturned: false,
    rawEvidencePathsReturned: false,
    rawLogLinesReturned: false,
    rawMessageBodiesReturned: false,
    rawProviderResponsesReturned: false,
    rawSecretRefsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function deliveryDriver(
  value: unknown,
): NotificationAdapterLivePostureReport["delivery"]["deliveryDriver"] {
  if (
    value === "configured" ||
    value === "disabled" ||
    value === "fcm-mobile-push" ||
    value === "pagerduty-events" ||
    value === "resend-email" ||
    value === "slack-webhook" ||
    value === "smtp-email" ||
    value === "teams-webhook" ||
    value === "webhook"
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

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
