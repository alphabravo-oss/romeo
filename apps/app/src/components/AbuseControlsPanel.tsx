import { Button, Input } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  abuseControlsQueryOptions,
  updateAbuseControlsMutationOptions,
  type AbuseControlPolicyReport,
  type BillingStatus,
  type UpdateAbuseControlPolicyRequest,
} from "../features/admin-insights";
import { type MessageKey, useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { Section, StatRow } from "./console";
import { useConfirm } from "./ConfirmDialog";
import { DangerZone } from "./DangerZone";
import { confirmTone, requiresTypedConfirmation } from "./danger-tier";
import { billingPlanStatusKey } from "./billing-display";
import { PageActions } from "./PageActions";
import { EdgeSecurityPostureTab } from "./EdgeSecurityPostureTab";
import { ContentPolicyTab } from "./ContentPolicyTab";
import { bootstrapQueryOptions } from "../lib/api-query-options";
import { useRouterApiClient } from "../lib/router-context";
import { IdListEditor } from "./IdListEditor";
import { Tabs } from "./Tabs";
import { AbusePolicySimulator } from "./AbusePolicySimulator";

const billingStatuses: BillingStatus[] = [
  "active",
  "canceled",
  "past_due",
  "trialing",
];

// Mirrors abuseControlIdSchema in packages/core/src/http/schemas.ts.
const ID_PATTERN = /^[A-Za-z0-9_.:/@-]+$/u;
const ID_MAX_LENGTH = 200;
const ID_LIST_MAX = 250;

/** Serialized form value <-> string[] helpers. */
function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function arrayToLines(values: string[]): string {
  return values.join("\n");
}

/** Validate an id list against the backend regex + count/length limits. */
type Translate = (key: MessageKey) => string;

function validateIdList(
  label: string,
  values: string[],
  t: Translate,
): string | undefined {
  if (values.length > ID_LIST_MAX) {
    return `${label}: ${t("abuseAtMost")} ${ID_LIST_MAX} ${t("abuseEntriesGot")} ${values.length}).`;
  }
  for (const value of values) {
    if (value.length > ID_MAX_LENGTH) {
      return `${label}: "${value}" ${t("abuseExceeds")} ${ID_MAX_LENGTH} ${t("abuseCharacters")}.`;
    }
    if (!ID_PATTERN.test(value)) {
      return `${label}: "${value}" ${t("abuseInvalidCharacters")}`;
    }
  }
  return undefined;
}

export function AbuseControlsPanel() {
  const { t } = useLocale();
  return (
    <Section>
      <Tabs
        tabs={[
          {
            id: "controls",
            label: t("abuseControlsTab"),
            content: <ControlsTab />,
          },
          {
            id: "edge",
            label: t("abuseEdgePostureTab"),
            content: <EdgeSecurityPostureTab />,
          },
          {
            id: "content",
            label: t("contentPolicyTab"),
            content: <ContentPolicyTab />,
          },
        ]}
      />
    </Section>
  );
}

function ControlsTab() {
  const { t } = useLocale();
  const controlsQuery = useQuery(abuseControlsQueryOptions());

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("abuseControls")}</div>
        <PageActions
          onRefresh={() => void controlsQuery.refetch()}
          refreshLabel={t("refresh")}
          refreshing={controlsQuery.isFetching}
        />
      </div>
      <PanelState
        query={controlsQuery}
        empty={t("abuseNoControlsLoaded")}
        isEmpty={() => false}
      >
        {(report) => <ControlsEditor report={report} />}
      </PanelState>
    </div>
  );
}

function ControlsEditor(props: { report: AbuseControlPolicyReport }) {
  const apiClient = useRouterApiClient();
  const { t } = useLocale();
  const { report } = props;
  const updateMutation = useMutation(updateAbuseControlsMutationOptions());
  const suspensionMutation = useMutation(updateAbuseControlsMutationOptions());
  const bootstrapQuery = useQuery(bootstrapQueryOptions(apiClient));
  const { ask, dialog } = useConfirm();

  const form = useForm({
    defaultValues: {
      reasonCode: report.suspension.reasonCode ?? "",
      enforceBillingStatus: report.entitlements.enforceBillingStatus,
      denyWhenBillingPlanMissing:
        report.entitlements.denyWhenBillingPlanMissing,
      allowedBillingStatuses: report.entitlements.allowedBillingStatuses,
      connectorIds: arrayToLines(report.killSwitches.connectorIds),
      providerIds: arrayToLines(report.killSwitches.providerIds),
      toolIds: arrayToLines(report.killSwitches.toolIds),
      workerClasses: arrayToLines(report.killSwitches.workerClasses),
    },
    onSubmit: async ({ value }) => {
      const reasonCode = value.reasonCode.trim();

      // reasonCode is optional, but if present it must match the backend id regex.
      if (reasonCode.length > 0) {
        const reasonError = validateIdList(
          t("abuseSuspensionReasonCode"),
          [reasonCode],
          t,
        );
        if (reasonError) {
          toast(reasonError, "error");
          return;
        }
      }

      // Enforcing billing status with no allowed statuses would block everything.
      if (
        value.enforceBillingStatus &&
        value.allowedBillingStatuses.length < 1
      ) {
        toast(t("abuseSelectBillingStatus"), "error");
        return;
      }

      const connectorIds = linesToArray(value.connectorIds);
      const providerIds = linesToArray(value.providerIds);
      const toolIds = linesToArray(value.toolIds);
      const workerClasses = linesToArray(value.workerClasses);

      const listError =
        validateIdList(t("abuseConnectorKillSwitches"), connectorIds, t) ??
        validateIdList(t("abuseProviderKillSwitches"), providerIds, t) ??
        validateIdList(t("abuseToolKillSwitches"), toolIds, t) ??
        validateIdList(t("abuseWorkerClassKillSwitches"), workerClasses, t);
      if (listError) {
        toast(listError, "error");
        return;
      }

      const input: UpdateAbuseControlPolicyRequest = {
        suspension: {
          // exactOptionalPropertyTypes: send null to clear, string to set — never undefined.
          reasonCode: reasonCode.length > 0 ? reasonCode : null,
        },
        entitlements: {
          enforceBillingStatus: value.enforceBillingStatus,
          denyWhenBillingPlanMissing: value.denyWhenBillingPlanMissing,
          allowedBillingStatuses: value.allowedBillingStatuses,
        },
        killSwitches: {
          connectorIds,
          providerIds,
          toolIds,
          workerClasses,
        },
      };

      try {
        await updateMutation.mutateAsync(input);
        toast(t("abuseControlsUpdated"), "success");
      } catch (caught) {
        toast(t("abuseCouldNotUpdateControls"), "error");
        throw caught;
      }
    },
  });

  async function toggleSuspension(nextSuspended: boolean) {
    const tier = nextSuspended ? "high" : "medium";
    const organization = bootstrapQuery.data?.organizations.find(
      (entry) => entry.id === report.orgId,
    );
    const organizationName =
      organization?.name ?? organization?.slug ?? report.orgId;
    const ok = await ask({
      title: nextSuspended
        ? t("abuseSuspendConfirmTitle")
        : t("abuseResumeConfirmTitle"),
      body: nextSuspended
        ? t("abuseSuspendConfirmBody")
        : t("abuseResumeConfirmBody"),
      confirmLabel: nextSuspended ? t("abuseSuspendOrg") : t("abuseResumeOrg"),
      tone: confirmTone(tier),
      ...(requiresTypedConfirmation(tier)
        ? { confirmPhrase: organizationName }
        : {}),
    });
    if (!ok) return;

    try {
      await suspensionMutation.mutateAsync({
        suspension: { suspended: nextSuspended },
      });
      toast(t("abuseControlsUpdated"), "success");
    } catch (caught) {
      toast(t("abuseCouldNotUpdateControls"), "error");
      throw caught;
    }
  }

  return (
    <div className="grid gap-4">
      <StatRow
        items={[
          { label: t("abuseSource"), value: report.source },
          {
            label: t("abuseSuspended"),
            value: report.suspension.suspended ? t("abuseYes") : t("abuseNo"),
          },
          {
            label: t("abuseCostWork"),
            value: report.enforcement.costWorkBlocked
              ? t("abuseBlocked")
              : t("abuseAllowed"),
          },
          {
            label: t("abuseActiveKillSwitches"),
            value: report.enforcement.activeKillSwitchCount,
          },
          {
            label: t("abuseDefaultBlockReasons"),
            value: report.enforcement.defaultBlockReasons.length,
          },
        ]}
      />

      <AbusePolicySimulator />

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <div className="rm-card-title">{t("abuseSuspension")}</div>
        <form.Field name="reasonCode">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="abuse-reason-code">
                {t("abuseSuspensionReasonOptional")}
              </label>
              <Input
                name="reasonCode"
                id="abuse-reason-code"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("abuseReasonCodePlaceholder")}
                value={field.state.value}
              />
              <div className="text-xs text-muted">
                {t("abuseReasonCodeHint")}
              </div>
            </div>
          )}
        </form.Field>

        <div className="rm-card-title">{t("abuseEntitlements")}</div>
        <form.Field name="enforceBillingStatus">
          {(field) => (
            <label className="flex items-center gap-2 text-sm">
              <Input
                name="enforceBillingStatus"
                checked={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>{t("abuseEnforceBillingStatus")}</span>
            </label>
          )}
        </form.Field>
        <form.Field name="denyWhenBillingPlanMissing">
          {(field) => (
            <label className="flex items-center gap-2 text-sm">
              <Input
                name="denyWhenBillingPlanMissing"
                checked={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>{t("abuseDenyMissingBillingPlan")}</span>
            </label>
          )}
        </form.Field>
        <form.Field name="allowedBillingStatuses">
          {(field) => (
            <div className="grid gap-1">
              <div className="text-sm text-muted">
                {t("abuseAllowedBillingStatuses")}
              </div>
              <div className="flex flex-wrap gap-3">
                {billingStatuses.map((status) => {
                  const checked = field.state.value.includes(status);
                  return (
                    <label
                      className="flex items-center gap-2 text-sm"
                      key={status}
                    >
                      <Input
                        name="allowedBillingStatuses"
                        checked={checked}
                        onChange={(event) => {
                          const next = event.currentTarget.checked
                            ? [...field.state.value, status]
                            : field.state.value.filter(
                                (value) => value !== status,
                              );
                          field.handleChange(next);
                        }}
                        type="checkbox"
                      />
                      <span>{t(billingPlanStatusKey(status))}</span>
                    </label>
                  );
                })}
              </div>
              <div className="text-xs text-muted">
                {t("abuseBillingStatusRequired")}
              </div>
            </div>
          )}
        </form.Field>

        <div>
          <div className="rm-card-title">{t("abuseKillSwitches")}</div>
          <p className="text-sm text-muted">
            {t("abuseKillSwitchesDescription")}
          </p>
        </div>
        <form.Field name="connectorIds">
          {(field) => (
            <IdListEditor
              id="abuse-connector-ids"
              label={t("abuseConnectorIds")}
              onChange={field.handleChange}
              placeholder="gmail"
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="providerIds">
          {(field) => (
            <IdListEditor
              id="abuse-provider-ids"
              label={t("abuseProviderIds")}
              onChange={field.handleChange}
              placeholder="openai"
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="toolIds">
          {(field) => (
            <IdListEditor
              id="abuse-tool-ids"
              label={t("abuseToolIds")}
              onChange={field.handleChange}
              placeholder="web.search"
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="workerClasses">
          {(field) => (
            <IdListEditor
              id="abuse-worker-classes"
              label={t("abuseWorkerClasses")}
              onChange={field.handleChange}
              placeholder="ingest"
              value={field.state.value}
            />
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                disabled={!canSubmit || isSubmitting}
                type="submit"
              >
                {isSubmitting ? t("abuseSaving") : t("abuseSaveControls")}
              </Button>
              {report.updatedAt ? (
                <span className="text-xs text-muted">
                  {t("abuseUpdated")}{" "}
                  <LocalizedDateTime value={report.updatedAt} />
                  {report.updatedBy
                    ? ` ${t("abuseBy")} ${report.updatedBy}`
                    : ""}
                </span>
              ) : null}
            </div>
          )}
        </form.Subscribe>
      </form>
      <DangerZone
        description={t("abuseSuspendDescription")}
        title={t("abuseSuspendTitle")}
      >
        <Button
          aria-haspopup="dialog"
          disabled={suspensionMutation.isPending}
          onClick={() => void toggleSuspension(!report.suspension.suspended)}
          type="button"
          variant={report.suspension.suspended ? "secondary" : "danger"}
        >
          {report.suspension.suspended
            ? t("abuseResumeOrg")
            : t("abuseSuspendOrg")}
        </Button>
      </DangerZone>
      {dialog}
    </div>
  );
}
