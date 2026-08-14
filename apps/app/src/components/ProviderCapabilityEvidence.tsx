import { StatusBadge } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";

import type {
  ProviderCapabilityEvidence,
  ProviderModelCapabilityEvidence,
} from "../features/providers/types";
import {
  providerCapabilityReportQueryOptions,
  providerModelCapabilityReportQueryOptions,
} from "../lib/api-query-options";
import { useLocale, type MessageKey } from "../lib/i18n";
import { LocalizedTokens } from "../lib/locale-format";
import { PanelState } from "../lib/panel-state";

const operationalReasonKeys = {
  available: "modelOperationalAvailable",
  model_disabled: "modelOperationalModelDisabled",
  model_unavailable: "modelOperationalModelUnavailable",
  provider_disabled: "modelOperationalProviderDisabled",
} as const satisfies Record<
  ProviderModelCapabilityEvidence["operationalReason"],
  MessageKey
>;

export function ProviderCapabilityEvidencePanel({
  providerId,
}: {
  providerId: string;
}) {
  const query = useQuery(providerCapabilityReportQueryOptions(providerId));
  return (
    <PanelState query={query}>
      {(report) => <ProviderCapabilityEvidenceView report={report} />}
    </PanelState>
  );
}

export function ProviderModelCapabilityEvidencePanel({
  modelId,
}: {
  modelId: string;
}) {
  const query = useQuery(providerModelCapabilityReportQueryOptions(modelId));
  return (
    <PanelState query={query}>
      {(report) => <ProviderModelCapabilityEvidenceView report={report} />}
    </PanelState>
  );
}

export function ProviderCapabilityEvidenceView({
  report,
}: {
  report: ProviderCapabilityEvidence;
}) {
  const { t } = useLocale();
  const headingId = useId();
  const matchesDefaults = capabilityPosturesMatch(
    report.advertisedDefaults,
    report.configuredCapabilities,
  );

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-3 rounded-md border border-border p-3"
    >
      <div>
        <h3 className="text-sm font-semibold" id={headingId}>
          {t("providerCapabilityEvidence")}
        </h3>
        <p className="text-sm text-muted">
          {t("providerCapabilityEvidenceDescription")}
        </p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("providerConfiguredPosture")}
          </dt>
          <dd>
            <StatusBadge tone={matchesDefaults ? "neutral" : "warning"}>
              {t(
                matchesDefaults
                  ? "providerCapabilityMatchesDefaults"
                  : "providerCapabilityOverridesDefaults",
              )}
            </StatusBadge>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("providerCredentialState")}
          </dt>
          <dd>
            <StatusBadge
              tone={report.credentialConfigured ? "success" : "neutral"}
            >
              {t(
                report.credentialConfigured
                  ? "providerCredentialStored"
                  : "providerCredentialNotStored",
              )}
            </StatusBadge>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("catalog")}
          </dt>
          <dd translate="no">{report.catalog.status}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("providerVisibleModels")}
          </dt>
          <dd>
            {report.visibleModels.total} / {report.visibleModels.enabled} /{" "}
            {report.visibleModels.available}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted">
        {t("providerCapabilityNotAuthorization")}
      </p>
    </section>
  );
}

function capabilityPosturesMatch(
  left: ProviderCapabilityEvidence["advertisedDefaults"],
  right: ProviderCapabilityEvidence["configuredCapabilities"],
): boolean {
  return (
    left.streaming === right.streaming &&
    left.toolCalling === right.toolCalling &&
    left.vision === right.vision &&
    left.audioInput === right.audioInput &&
    left.structuredJson === right.structuredJson &&
    left.reasoning === right.reasoning &&
    left.temperature === right.temperature &&
    left.imageGeneration === right.imageGeneration &&
    left.deployment.mode === right.deployment.mode &&
    left.deployment.networkAccess === right.deployment.networkAccess &&
    left.deployment.credentialRequired ===
      right.deployment.credentialRequired &&
    [...left.modalities].sort().join("\u001f") ===
      [...right.modalities].sort().join("\u001f")
  );
}

export function ProviderModelCapabilityEvidenceView({
  report,
}: {
  report: ProviderModelCapabilityEvidence;
}) {
  const { t } = useLocale();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-3 rounded-md border border-border p-3"
    >
      <div>
        <h3 className="text-sm font-semibold" id={headingId}>
          {t("modelCapabilityEvidence")}
        </h3>
        <p className="text-sm text-muted">
          {t("modelCapabilityEvidenceDescription")}
        </p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("modelCapabilitySource")}
          </dt>
          <dd>
            <StatusBadge
              tone={
                report.capabilitySource === "override" ? "warning" : "neutral"
              }
            >
              {t(
                report.capabilitySource === "override"
                  ? "adminOverride"
                  : "detectedDefault",
              )}
            </StatusBadge>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("modelOperationalState")}
          </dt>
          <dd>
            <StatusBadge
              tone={report.operationallyUsable ? "success" : "danger"}
            >
              {t(operationalReasonKeys[report.operationalReason])}
            </StatusBadge>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("contextWindow")}
          </dt>
          <dd>
            <LocalizedTokens value={report.limits.contextWindow} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("providerDialectImplementationVersion")}
          </dt>
          <dd translate="no">{report.provider.dialect.version}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted">
        {t("providerCapabilityNotAuthorization")}
      </p>
    </section>
  );
}
