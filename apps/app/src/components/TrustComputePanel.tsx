import { Button, StatusBadge } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  admitComputeArtifactMutationOptions,
  authorizeArtifactLifecycleMutationOptions,
  authorizeBreakGlassMutationOptions,
  authorizeRuntimeImageMutationOptions,
  checkpointSiemExportMutationOptions,
  createArtifactVersionMutationOptions,
  evaluateSandboxPostureMutationOptions,
  previewComputeArtifactMutationOptions,
  previewComputeOperationsMutationOptions,
  previewCryptoShredMutationOptions,
  recordComputeProvenanceMutationOptions,
  sealAuditSegmentMutationOptions,
  trustPostureQueryOptions,
  auditSegmentPreview,
  completeProvenancePreview,
  cryptoShredPreview,
  hardenedSandboxPreview,
  holdDeletePreview,
  htmlSameOriginPreview,
  mandatoryBreakGlassPreview,
  overwriteVersionPreview,
  publicRuntimeImagePreview,
  siemCheckpointPreview,
  traversalArtifactPreview,
  unavailableOpsPreview,
} from "../features/trust-compute";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { Section } from "./console";

const postureValueKeys = {
  failed: "trustPostureFailed",
  not_applicable: "trustPostureNotApplicable",
  not_configured: "trustPostureNotConfigured",
  stale: "trustPostureStale",
  verified: "trustPostureVerified",
} as const satisfies Record<string, MessageKey>;

export function TrustComputePanel() {
  const query = useQuery(trustPostureQueryOptions());
  return (
    <PanelState query={query}>
      {(posture) => <TrustComputePanelView posture={posture} />}
    </PanelState>
  );
}

export function TrustComputePanelView({
  posture,
}: {
  posture: {
    acl: keyof typeof postureValueKeys;
    dlp: keyof typeof postureValueKeys;
    keys: keyof typeof postureValueKeys;
    residency: keyof typeof postureValueKeys;
    syntheticGreen: false;
  };
}) {
  const { t } = useLocale();
  return (
    <Section description={t("trustComputeIntro")} title={t("trustPostureTitle")}>
      <p className="text-sm text-muted" role="status">
        {t("trustSyntheticGreenNever")}
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {(
          [
            ["trustKeys", posture.keys],
            ["trustResidency", posture.residency],
            ["trustDlp", posture.dlp],
            ["trustAcl", posture.acl],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">
              {t(label)}
            </dt>
            <dd>
              <StatusBadge tone={value === "verified" ? "success" : "neutral"}>
                {t(postureValueKeys[value])}
              </StatusBadge>
            </dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-6 text-sm font-medium">{t("computeChecksTitle")}</h3>
      <ul className="grid gap-2">
        <SandboxCheck />
        <ImageCheck />
        <IntakeCheck />
        <ProvenanceCheck />
        <VersionCheck />
        <PreviewCheck />
        <LifecycleCheck />
        <OpsCheck />
        <ShredCheck />
        <BreakGlassCheck />
        <AuditCheck />
        <SiemCheck />
      </ul>
    </Section>
  );
}

function SandboxCheck() {
  const mutation = useMutation(evaluateSandboxPostureMutationOptions());
  return (
    <CheckRow
      labelKey="computeEvaluateSandbox"
      mutation={mutation}
      variables={hardenedSandboxPreview}
    />
  );
}

function ImageCheck() {
  const mutation = useMutation(authorizeRuntimeImageMutationOptions());
  return (
    <CheckRow
      labelKey="computeEvaluateImage"
      mutation={mutation}
      variables={publicRuntimeImagePreview}
    />
  );
}

function IntakeCheck() {
  const mutation = useMutation(admitComputeArtifactMutationOptions());
  return (
    <CheckRow
      labelKey="computeEvaluateIntake"
      mutation={mutation}
      variables={traversalArtifactPreview}
    />
  );
}

function ProvenanceCheck() {
  const mutation = useMutation(recordComputeProvenanceMutationOptions());
  return (
    <CheckRow
      labelKey="computeEvaluateProvenance"
      mutation={mutation}
      variables={completeProvenancePreview}
    />
  );
}

function VersionCheck() {
  const mutation = useMutation(createArtifactVersionMutationOptions());
  return (
    <CheckRow
      labelKey="computeEvaluateVersion"
      mutation={mutation}
      variables={overwriteVersionPreview}
    />
  );
}

function PreviewCheck() {
  const mutation = useMutation(previewComputeArtifactMutationOptions());
  return (
    <CheckRow
      labelKey="computeEvaluatePreview"
      mutation={mutation}
      variables={htmlSameOriginPreview}
    />
  );
}

function LifecycleCheck() {
  const mutation = useMutation(authorizeArtifactLifecycleMutationOptions());
  return (
    <CheckRow
      labelKey="computeEvaluateLifecycle"
      mutation={mutation}
      variables={holdDeletePreview}
    />
  );
}

function OpsCheck() {
  const mutation = useMutation(previewComputeOperationsMutationOptions());
  return (
    <CheckRow
      labelKey="computeEvaluateOps"
      mutation={mutation}
      variables={unavailableOpsPreview}
    />
  );
}

function ShredCheck() {
  const mutation = useMutation(previewCryptoShredMutationOptions());
  return (
    <CheckRow
      labelKey="trustEvaluateShred"
      mutation={mutation}
      variables={cryptoShredPreview}
    />
  );
}

function BreakGlassCheck() {
  const mutation = useMutation(authorizeBreakGlassMutationOptions());
  return (
    <CheckRow
      labelKey="trustEvaluateBreakGlass"
      mutation={mutation}
      variables={mandatoryBreakGlassPreview}
    />
  );
}

function AuditCheck() {
  const mutation = useMutation(sealAuditSegmentMutationOptions());
  return (
    <CheckRow
      labelKey="trustEvaluateAuditSegment"
      mutation={mutation}
      variables={auditSegmentPreview}
    />
  );
}

function SiemCheck() {
  const mutation = useMutation(checkpointSiemExportMutationOptions());
  return (
    <CheckRow
      labelKey="trustEvaluateSiem"
      mutation={mutation}
      variables={siemCheckpointPreview}
    />
  );
}

function CheckRow<TVariables>({
  labelKey,
  mutation,
  variables,
}: {
  labelKey: MessageKey;
  mutation: {
    data?: unknown;
    isPending: boolean;
    mutate: (variables: TVariables) => void;
  };
  variables: TVariables;
}) {
  const { t } = useLocale();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
      <span>{t(labelKey)}</span>
      <div className="flex items-center gap-2">
        {mutation.data !== undefined ? (
          <StatusBadge tone={resultTone(mutation.data)}>
            {resultLabel(mutation.data, t)}
          </StatusBadge>
        ) : null}
        <Button
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(variables)}
          size="sm"
          variant="secondary"
        >
          {t("computeEvaluate")}
        </Button>
      </div>
    </li>
  );
}

function resultTone(
  data: unknown,
): "success" | "danger" | "warning" | "neutral" {
  if (isRecord(data) && data.outcome === "accepted") return "success";
  if (isRecord(data) && data.outcome === "denied") return "danger";
  if (isRecord(data) && data.state === "healthy") return "success";
  if (isRecord(data) && data.state === "degraded") return "warning";
  if (isRecord(data) && data.state === "unavailable") return "danger";
  return "neutral";
}

function resultLabel(data: unknown, t: (key: MessageKey) => string): string {
  if (isRecord(data) && data.outcome === "accepted")
    return t("computeOutcomeAccepted");
  if (isRecord(data) && data.outcome === "denied")
    return t("computeOutcomeDenied");
  if (isRecord(data) && data.state === "healthy") return t("computeStateHealthy");
  if (isRecord(data) && data.state === "degraded")
    return t("computeStateDegraded");
  if (isRecord(data) && data.state === "unavailable")
    return t("computeStateUnavailable");
  return t("computeOutcomeDenied");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
