import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
const deliveryDriver = enumArg(
  "--delivery-driver",
  [
    "configured",
    "disabled",
    "fcm-mobile-push",
    "pagerduty-events",
    "resend-email",
    "slack-webhook",
    "smtp-email",
    "teams-webhook",
    "webhook",
  ],
  "configured",
);

const attemptedCount = nonNegativeInteger(argValue("--attempted-count"), {
  fallback: "7",
  label: "--attempted-count",
});
const successfulCount = nonNegativeInteger(argValue("--successful-count"), {
  fallback: "6",
  label: "--successful-count",
});
const failedCount = nonNegativeInteger(argValue("--failed-count"), {
  fallback: "1",
  label: "--failed-count",
});
const providerFamilyCount = nonNegativeInteger(
  argValue("--provider-family-count"),
  { fallback: "6", label: "--provider-family-count" },
);
const providerPayloadRedacted = booleanArg("--provider-payload-redacted", true);

const webhookCount = nonNegativeInteger(argValue("--webhook-count"), {
  fallback: "1",
  label: "--webhook-count",
});
const emailCount = nonNegativeInteger(argValue("--email-count"), {
  fallback: "1",
  label: "--email-count",
});
const slackCount = nonNegativeInteger(argValue("--slack-count"), {
  fallback: "1",
  label: "--slack-count",
});
const teamsCount = nonNegativeInteger(argValue("--teams-count"), {
  fallback: "1",
  label: "--teams-count",
});
const pagerDutyCount = nonNegativeInteger(argValue("--pager-duty-count"), {
  fallback: "1",
  label: "--pager-duty-count",
});
const mobilePushCount = nonNegativeInteger(argValue("--mobile-push-count"), {
  fallback: "1",
  label: "--mobile-push-count",
});
const defaultChannelTotal =
  webhookCount +
  emailCount +
  slackCount +
  teamsCount +
  pagerDutyCount +
  mobilePushCount;
const channelTotal = nonNegativeInteger(argValue("--channel-total"), {
  fallback: String(defaultChannelTotal),
  label: "--channel-total",
});
const mixedChannelTypesVerified = booleanArg(
  "--mixed-channel-types-verified",
  true,
);

const secretRefResolutionCount = nonNegativeInteger(
  argValue("--secret-ref-resolution-count"),
  { fallback: "3", label: "--secret-ref-resolution-count" },
);
const secretResolverBoundaryVerified = booleanArg(
  "--secret-resolver-boundary-verified",
  true,
);

const suppressionVerified = booleanArg("--suppression-verified", true);
const retrySuccessCount = nonNegativeInteger(
  argValue("--retry-success-count"),
  {
    fallback: "1",
    label: "--retry-success-count",
  },
);
const deadLetterCount = nonNegativeInteger(argValue("--dead-letter-count"), {
  fallback: "1",
  label: "--dead-letter-count",
});
const channelTypeIsolationVerified = booleanArg(
  "--channel-type-isolation-verified",
  true,
);

const networkPolicyEnforced = booleanArg("--network-policy-enforced", true);
const hostAllowlistEnforced = booleanArg("--host-allowlist-enforced", true);
const privateNetworkDenied = booleanArg("--private-network-denied", true);
const providerEndpointAccessVerified = booleanArg(
  "--provider-endpoint-access-verified",
  true,
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
const destinationSentinelHitCount = nonNegativeInteger(
  argValue("--destination-sentinel-hit-count"),
  { fallback: "0", label: "--destination-sentinel-hit-count" },
);
const bodySentinelHitCount = nonNegativeInteger(
  argValue("--body-sentinel-hit-count"),
  { fallback: "0", label: "--body-sentinel-hit-count" },
);
const secretSentinelHitCount = nonNegativeInteger(
  argValue("--secret-sentinel-hit-count"),
  { fallback: "0", label: "--secret-sentinel-hit-count" },
);
const tokenSentinelHitCount = nonNegativeInteger(
  argValue("--token-sentinel-hit-count"),
  { fallback: "0", label: "--token-sentinel-hit-count" },
);

const rawDestinationsReturned = booleanArg(
  "--raw-destinations-returned",
  false,
);
const rawEndpointUrlsReturned = booleanArg(
  "--raw-endpoint-urls-returned",
  false,
);
const rawEvidencePathsReturned = booleanArg(
  "--raw-evidence-paths-returned",
  false,
);
const rawLogLinesReturned = booleanArg("--raw-log-lines-returned", false);
const rawMessageBodiesReturned = booleanArg(
  "--raw-message-bodies-returned",
  false,
);
const rawProviderResponsesReturned = booleanArg(
  "--raw-provider-responses-returned",
  false,
);
const rawSecretRefsReturned = booleanArg("--raw-secret-refs-returned", false);
const secretValuesReturned = booleanArg("--secret-values-returned", false);
const tokenValuesReturned = booleanArg("--token-values-returned", false);
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed notification adapter live evidence is invalid: ${failures.join(
      ", ",
    )}`,
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
  schemaVersion: "romeo.notification-adapter-live-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks,
  delivery: {
    deliveryDriver,
    attemptedCount,
    successfulCount,
    failedCount,
    providerFamilyCount,
    providerPayloadRedacted,
  },
  channels: {
    total: channelTotal,
    webhookCount,
    emailCount,
    slackCount,
    teamsCount,
    pagerDutyCount,
    mobilePushCount,
    mixedChannelTypesVerified,
  },
  secrets: {
    secretRefResolutionCount,
    secretResolverBoundaryVerified,
  },
  policy: {
    suppressionVerified,
    retrySuccessCount,
    deadLetterCount,
    channelTypeIsolationVerified,
  },
  egress: {
    networkPolicyEnforced,
    hostAllowlistEnforced,
    privateNetworkDenied,
    providerEndpointAccessVerified,
  },
  logRedaction: {
    appLogRedactionVerified,
    podLogRedactionVerified,
    appLogScanCount,
    podLogScanCount,
    destinationSentinelHitCount,
    bodySentinelHitCount,
    secretSentinelHitCount,
    tokenSentinelHitCount,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    rawDestinationsReturned,
    rawEndpointUrlsReturned,
    rawEvidencePathsReturned,
    rawLogLinesReturned,
    rawMessageBodiesReturned,
    rawProviderResponsesReturned,
    rawSecretRefsReturned,
    secretValuesReturned,
    tokenValuesReturned,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote notification adapter live evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (
    deliveryDriver === "disabled" ||
    attemptedCount <= 0 ||
    successfulCount <= 0 ||
    providerFamilyCount <= 0
  ) {
    failures.push("live_notification_delivery_missing");
  }
  if (channelTotal <= 1 || !mixedChannelTypesVerified) {
    failures.push("mixed_channel_type_delivery_missing");
  }
  if (secretRefResolutionCount <= 0 || !secretResolverBoundaryVerified) {
    failures.push("secret_ref_resolution_missing");
  }
  if (
    !networkPolicyEnforced ||
    !hostAllowlistEnforced ||
    !privateNetworkDenied ||
    !providerEndpointAccessVerified
  ) {
    failures.push("notification_egress_policy_missing");
  }
  if (!providerPayloadRedacted) {
    failures.push("provider_payload_redaction_missing");
  }
  if (!channelTypeIsolationVerified) {
    failures.push("channel_type_isolation_missing");
  }
  if (!suppressionVerified || retrySuccessCount <= 0 || deadLetterCount <= 0) {
    failures.push("retry_and_dead_letter_missing");
  }
  if (
    !appLogRedactionVerified ||
    !podLogRedactionVerified ||
    appLogScanCount <= 0 ||
    podLogScanCount <= 0 ||
    destinationSentinelHitCount > 0 ||
    bodySentinelHitCount > 0 ||
    secretSentinelHitCount > 0 ||
    tokenSentinelHitCount > 0
  ) {
    failures.push("notification_log_redaction_missing");
  }
  if (
    rawDestinationsReturned ||
    rawEndpointUrlsReturned ||
    rawEvidencePathsReturned ||
    rawLogLinesReturned ||
    rawMessageBodiesReturned ||
    rawProviderResponsesReturned ||
    rawSecretRefsReturned ||
    secretValuesReturned ||
    tokenValuesReturned
  ) {
    failures.push("notification_evidence_redaction_missing");
  }
  return failures;
}

function checkFailure(check) {
  return {
    live_notification_delivery_verified: "live_notification_delivery_missing",
    mixed_channel_type_delivery_verified: "mixed_channel_type_delivery_missing",
    secret_ref_resolution_verified: "secret_ref_resolution_missing",
    notification_egress_policy_verified: "notification_egress_policy_missing",
    provider_payload_redaction_verified: "provider_payload_redaction_missing",
    channel_type_isolation_verified: "channel_type_isolation_missing",
    retry_and_dead_letter_verified: "retry_and_dead_letter_missing",
    notification_log_redaction: "notification_log_redaction_missing",
    notification_evidence_redaction_reviewed:
      "notification_evidence_redaction_missing",
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
