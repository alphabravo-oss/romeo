import { Button, Field, NativeSelect, StatusBadge, Textarea } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type {
  ContentPolicyReport,
  ContentPolicySimulation,
} from "../features/content-policy";
import {
  simulateContentPolicyMutationOptions,
  updateContentPolicyMutationOptions,
} from "../features/content-policy-mutation-options";
import { contentPolicyQueryOptions } from "../features/content-policy-query-options";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { ContentPolicyVersionsPanel } from "./ContentPolicyVersionsPanel";
import { PageActions } from "./PageActions";

const detectorCodes = [
  "credit_card",
  "email_address",
  "us_ssn",
  "api_token",
] as const;
const actions = ["disabled", "audit", "block", "redact"] as const;
type DetectorCode = (typeof detectorCodes)[number];
type PolicyAction = (typeof actions)[number];

export function ContentPolicyTab() {
  const { t } = useLocale();
  const policyQuery = useQuery(contentPolicyQueryOptions());
  return (
    <div className="grid gap-3">
      <div className="rm-card-header">
        <div>
          <div className="rm-card-title">{t("contentPolicyTitle")}</div>
          <p className="rm-muted">{t("contentPolicyDescription")}</p>
        </div>
        <PageActions
          onRefresh={() => void policyQuery.refetch()}
          refreshLabel={t("refresh")}
          refreshing={policyQuery.isFetching}
        />
      </div>
      <PanelState
        query={policyQuery}
        empty={t("contentPolicyUnavailable")}
        isEmpty={() => false}
      >
        {(report) => (
          <ContentPolicyEditor
            key={`${report.updatedAt ?? "default"}:${JSON.stringify(report.detectors)}`}
            report={report}
          />
        )}
      </PanelState>
    </div>
  );
}

function ContentPolicyEditor({ report }: { report: ContentPolicyReport }) {
  const { t } = useLocale();
  const [detectors, setDetectors] = useState(report.detectors);
  const [simulationContent, setSimulationContent] = useState("");
  const [simulation, setSimulation] = useState<ContentPolicySimulation>();
  const updateMutation = useMutation(updateContentPolicyMutationOptions());
  const simulateMutation = useMutation(simulateContentPolicyMutationOptions());

  async function save() {
    try {
      await updateMutation.mutateAsync({ detectors });
      toast(t("contentPolicySaved"), "success");
    } catch {
      toast(t("contentPolicySaveFailed"), "error");
    }
  }

  async function simulate() {
    const content = simulationContent;
    if (content.trim().length === 0) return;
    try {
      const result = await simulateMutation.mutateAsync({ content });
      // The browser should not retain the sensitive sample after evaluation.
      setSimulationContent("");
      setSimulation(result);
    } catch {
      toast(t("contentPolicySimulationFailed"), "error");
    }
  }

  return (
    <div className="grid gap-4">
      <section aria-labelledby="content-policy-detectors" className="rm-card">
        <div className="rm-card-header">
          <div>
            <div className="rm-card-title" id="content-policy-detectors">
              {t("contentPolicyDetectors")}
            </div>
            <p className="rm-muted">{t("contentPolicyDetectorHelp")}</p>
          </div>
          <StatusBadge
            tone={report.policySource === "org" ? "info" : "neutral"}
          >
            {report.policySource === "org"
              ? t("contentPolicyOrgPolicy")
              : t("contentPolicyDefaultPolicy")}
          </StatusBadge>
        </div>
        <div className="grid gap-2">
          {detectorCodes.map((code) => (
            <Field key={code} label={detectorLabel(code, t)}>
              <NativeSelect
                aria-label={`${detectorLabel(code, t)} ${t("contentPolicyAction")}`}
                name={`content_policy_${code}`}
                onChange={(event) =>
                  setDetectors((current) => ({
                    ...current,
                    [code]: event.currentTarget.value as PolicyAction,
                  }))
                }
                value={detectors[code]}
              >
                {actions.map((action) => (
                  <option key={action} value={action}>
                    {actionLabel(action, t)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ))}
        </div>
        <div className="rm-form-actions">
          <Button
            disabled={updateMutation.isPending}
            onClick={() => void save()}
            type="button"
          >
            {updateMutation.isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </section>

      <section aria-labelledby="content-policy-simulator" className="rm-card">
        <div className="rm-card-title" id="content-policy-simulator">
          {t("contentPolicySimulator")}
        </div>
        <p className="rm-muted">{t("contentPolicySimulatorHelp")}</p>
        <Field label={t("contentPolicySampleLabel")}>
          <Textarea
            autoComplete="off"
            name="content_policy_simulation"
            onChange={(event) =>
              setSimulationContent(event.currentTarget.value)
            }
            rows={4}
            spellCheck={false}
            value={simulationContent}
          />
        </Field>
        <div className="rm-form-actions">
          <Button
            disabled={
              simulateMutation.isPending ||
              simulationContent.trim().length === 0
            }
            onClick={() => void simulate()}
            type="button"
            variant="secondary"
          >
            {simulateMutation.isPending
              ? t("contentPolicySimulating")
              : t("contentPolicySimulate")}
          </Button>
        </div>
        {simulation === undefined ? null : (
          <div aria-live="polite" className="grid gap-2" role="status">
            <StatusBadge tone={simulationTone(simulation.action)}>
              {simulationLabel(simulation.action, t)}
            </StatusBadge>
            {simulation.detections.length === 0 ? (
              <p className="rm-muted">{t("contentPolicyNoDetections")}</p>
            ) : (
              <ul className="rm-plain-list">
                {simulation.detections.map((detection) => (
                  <li key={detection.code}>
                    {detectorLabel(detection.code, t)}: {detection.count} ·{" "}
                    {actionLabel(detection.action, t)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <ContentPolicyVersionsPanel report={report} />
    </div>
  );
}

function detectorLabel(
  code: DetectorCode,
  t: ReturnType<typeof useLocale>["t"],
) {
  if (code === "credit_card") return t("contentPolicyDetector_credit_card");
  if (code === "email_address") return t("contentPolicyDetector_email_address");
  if (code === "us_ssn") return t("contentPolicyDetector_us_ssn");
  return t("contentPolicyDetector_api_token");
}

function actionLabel(
  action: PolicyAction,
  t: ReturnType<typeof useLocale>["t"],
) {
  if (action === "disabled") return t("contentPolicyAction_disabled");
  if (action === "audit") return t("contentPolicyAction_audit");
  if (action === "block") return t("contentPolicyAction_block");
  return t("contentPolicyAction_redact");
}

function simulationLabel(
  action: ContentPolicySimulation["action"],
  t: ReturnType<typeof useLocale>["t"],
) {
  if (action === "allow") return t("contentPolicyResult_allow");
  if (action === "audit") return t("contentPolicyResult_audit");
  if (action === "redact") return t("contentPolicyResult_redact");
  return t("contentPolicyResult_block");
}

function simulationTone(action: ContentPolicySimulation["action"]) {
  if (action === "block") return "danger" as const;
  if (action === "redact" || action === "audit") return "warning" as const;
  return "success" as const;
}
