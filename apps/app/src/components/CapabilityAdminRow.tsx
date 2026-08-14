import {
  capabilitiesExplainAdminQueryKey,
  capabilitiesGetAdminOverviewQueryKey,
  capabilitiesGetAssignmentHistoryQueryKey,
  capabilitiesPatchAssignmentMutation,
  capabilitiesPreviewAssignmentMutation,
  capabilitiesPreviewImpactMutation,
  type CapabilityImpactPreview,
} from "@romeo/api-client/generated/query";
import { Button, Field, Input, NativeSelect, Textarea } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  capabilityAssignmentScope,
  capabilityExplainQueryOptions,
  capabilityHistoryQueryOptions,
  type CapabilityAdminOverview,
  type CapabilityAssignmentState,
  type CapabilityScope,
} from "../features/capabilities";
import { useLocale } from "../lib/i18n";
import { useRouterApiClient } from "../lib/router-context";
import { toast } from "../lib/toast";
import {
  capabilityApiErrorCode,
  displayCapabilityValue,
} from "./capability-admin-display";
import {
  capabilityConfigurationFor,
  capabilityCopyFor,
  capabilityExpiryInputValue,
  initialCapabilityPolicyValues,
  isCapabilityExpiryValid,
  isCapabilityPolicyValid,
} from "./capability-admin-policy";
import { CapabilityPolicyFields } from "./CapabilityPolicyFields";
import { StatRow } from "./console";

export function CapabilityAdminRow({
  row,
  scope,
}: {
  row: CapabilityAdminOverview["capabilities"][number];
  scope: CapabilityScope;
}): React.ReactNode {
  const apiClient = useRouterApiClient();
  const queryClient = useQueryClient();
  const { locale, t } = useLocale();
  const assignment = row.configuredAssignment;
  const copy = capabilityCopyFor(row.definition.id);
  const [state, setState] = useState<CapabilityAssignmentState>(
    assignment?.state ?? "inherit",
  );
  const [policyValues, setPolicyValues] = useState(() =>
    initialCapabilityPolicyValues(row),
  );
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState(() =>
    capabilityExpiryInputValue(assignment?.expiresAt),
  );
  const [showExplain, setShowExplain] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [previewed, setPreviewed] =
    useState<CapabilityAdminOverview["capabilities"][number]["effective"]>();
  const [impactPreview, setImpactPreview] = useState<CapabilityImpactPreview>();
  const explain = useQuery(
    capabilityExplainQueryOptions(scope, row.definition.id, apiClient),
  );
  const history = useQuery(
    capabilityHistoryQueryOptions(scope, row.definition.id, apiClient),
  );
  const update = useMutation(
    capabilitiesPatchAssignmentMutation({ client: apiClient }),
  );
  const preview = useMutation(
    capabilitiesPreviewAssignmentMutation({ client: apiClient }),
  );
  const impact = useMutation(
    capabilitiesPreviewImpactMutation({ client: apiClient }),
  );
  const expiryValid = isCapabilityExpiryValid(expiresAt);
  const canSave =
    row.canOverride &&
    reason.trim().length > 0 &&
    expiryValid &&
    isCapabilityPolicyValid(row.definition.id, state, policyValues);

  async function invalidateCapabilityQueries(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({
        exact: true,
        queryKey: capabilitiesGetAdminOverviewQueryKey({
          client: apiClient,
          query: scope,
        }),
      }),
      queryClient.invalidateQueries({
        exact: true,
        queryKey: capabilitiesGetAssignmentHistoryQueryKey({
          client: apiClient,
          path: { capabilityId: row.definition.id },
          query: capabilityAssignmentScope(scope),
        }),
      }),
      queryClient.invalidateQueries({
        exact: true,
        queryKey: capabilitiesExplainAdminQueryKey({
          client: apiClient,
          path: { capabilityId: row.definition.id },
          query: scope,
        }),
      }),
    ]);
  }

  async function save(): Promise<void> {
    if (!canSave) return;
    try {
      await update.mutateAsync({
        path: { capabilityId: row.definition.id },
        body: {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          state,
          reason: reason.trim(),
          expectedVersion: assignment?.version ?? 0,
          configuration: capabilityConfigurationFor(
            row.definition.id,
            state,
            policyValues,
          ),
          expiresAt:
            expiresAt.length === 0 ? null : new Date(expiresAt).toISOString(),
        },
      });
      setReason("");
      await invalidateCapabilityQueries();
      toast(t("capabilitySaved"), "success");
    } catch (caught) {
      if (
        capabilityApiErrorCode(caught) ===
        "capability_assignment_version_conflict"
      ) {
        await invalidateCapabilityQueries();
        toast(t("capabilityVersionConflict"), "error");
        return;
      }
      if (
        capabilityApiErrorCode(caught) === "policy_bundle_approval_required"
      ) {
        toast(t("capabilityApprovalRequired"), "error");
        return;
      }
      toast(t("capabilitySaveFailed"), "error");
    }
  }

  async function previewPolicy(): Promise<void> {
    if (!row.canOverride || !expiryValid) return;
    try {
      const response = await preview.mutateAsync({
        path: { capabilityId: row.definition.id },
        body: {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          state,
          configuration: capabilityConfigurationFor(
            row.definition.id,
            state,
            policyValues,
          ),
          workspaceId: scope.workspaceId,
          expiresAt:
            expiresAt.length === 0 ? null : new Date(expiresAt).toISOString(),
        },
      });
      setPreviewed(response.data);
      const counted = await impact.mutateAsync({
        path: { capabilityId: row.definition.id },
        body: {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          state,
          configuration: capabilityConfigurationFor(
            row.definition.id,
            state,
            policyValues,
          ),
          workspaceId: scope.workspaceId,
          expiresAt:
            expiresAt.length === 0 ? null : new Date(expiresAt).toISOString(),
          samples: [
            { role: "admin", workspaceClass: "default" },
            { role: "member", workspaceClass: "regulated" },
          ],
        },
      });
      setImpactPreview(counted.data);
    } catch {
      toast(t("capabilityPreviewFailed"), "error");
    }
  }

  const inherited =
    assignment === undefined || assignment.state === "inherit"
      ? row.inheritedAssignment
      : undefined;
  return (
    <article
      className="rounded-lg border p-4"
      aria-labelledby={`capability-name-${row.definition.id}`}
    >
      <div className="grid gap-1">
        <h3
          className="text-base font-semibold"
          id={`capability-name-${row.definition.id}`}
        >
          {t(copy.name)}
        </h3>
        <p className="text-sm text-muted-foreground">{t(copy.description)}</p>
        <p className="text-sm text-muted-foreground">
          {t("capabilityRisk")}: {t(copy.risk)}
        </p>
      </div>
      <p className="text-sm">
        {t("capabilityConfigured")}:{" "}
        {displayCapabilityValue(assignment?.state ?? "inherit", t)}
      </p>
      {row.controllingLayer === undefined ? null : (
        <p className="text-sm" id={`capability-controlling-${row.definition.id}`}>
          {t("capabilityControllingLayer")}:{" "}
          {displayCapabilityValue(row.controllingLayer, t)}
        </p>
      )}
      {!row.canOverride && row.controllingLayer !== undefined ? (
        <p
          className="text-sm text-muted-foreground"
          role="status"
          aria-describedby={`capability-controlling-${row.definition.id}`}
        >
          {t("capabilityLockedInheritance")}
        </p>
      ) : null}
      <StatRow
        items={[
          {
            label: t("capabilityInstalled"),
            value: displayCapabilityValue(
              row.effective.dimensions.installed,
              t,
            ),
          },
          {
            label: t("capabilityEntitled"),
            value: displayCapabilityValue(row.effective.dimensions.entitled, t),
          },
          {
            label: t("capabilityAvailable"),
            value: displayCapabilityValue(
              row.effective.dimensions.available,
              t,
            ),
          },
          {
            label: t("capabilityAllowed"),
            value: displayCapabilityValue(row.effective.dimensions.allowed, t),
          },
          {
            label: t("capabilityCapable"),
            value: displayCapabilityValue(row.effective.dimensions.capable, t),
          },
          {
            label: t("capabilityEffective"),
            value: displayCapabilityValue(row.effective.status, t),
          },
        ]}
      />
      <p className="text-sm" aria-live="polite">
        {inherited === undefined
          ? `${t("capabilityConfiguredHere")}: ${displayCapabilityValue(assignment?.state ?? "inherit", t)}`
          : `${t("capabilityInheritedFromOrganization")}: ${displayCapabilityValue(inherited.state, t)}`}
      </p>
      {row.effective.reasons.length > 0 ? (
        <ul className="list-disc pl-5 text-sm">
          {row.effective.reasons.map((item) => (
            <li key={`${item.layer}:${item.code}`}>
              {displayCapabilityValue(item.layer, t)}:{" "}
              {displayCapabilityValue(item.code, t)}
            </li>
          ))}
        </ul>
      ) : null}
      {!row.canOverride ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          {t("capabilityOrganizationOnly")}
        </p>
      ) : null}
      <fieldset
        className="mt-4 grid gap-4"
        disabled={update.isPending || !row.canOverride}
      >
        <legend className="font-medium">{t("capabilityPolicyOverride")}</legend>
        <Field label={t("capabilityState")}>
          <NativeSelect
            name={`capability_state_${row.definition.id}`}
            onChange={(event) =>
              setState(event.currentTarget.value as CapabilityAssignmentState)
            }
            value={state}
          >
            {row.definition.allowedStates.map((value) => (
              <option key={value} value={value}>
                {displayCapabilityValue(value, t)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <CapabilityPolicyFields
          capabilityId={row.definition.id}
          disabled={state === "inherit"}
          onChange={setPolicyValues}
          values={policyValues}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            description={
              expiryValid
                ? t("capabilityExpiryDescription")
                : t("capabilityExpiryInvalid")
            }
            label={t("capabilityExpiry")}
          >
            <Input
              aria-invalid={!expiryValid}
              name={`capability_expiry_${row.definition.id}`}
              onChange={(event) => setExpiresAt(event.currentTarget.value)}
              type="datetime-local"
              value={expiresAt}
            />
          </Field>
          <Field label={t("capabilityReason")} required>
            <Textarea
              maxLength={1000}
              name={`capability_reason_${row.definition.id}`}
              onChange={(event) => setReason(event.currentTarget.value)}
              required
              rows={2}
              value={reason}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!row.canOverride || !expiryValid || preview.isPending}
            onClick={() => void previewPolicy()}
            type="button"
            variant="outline"
          >
            {preview.isPending
              ? t("capabilityPreviewing")
              : t("capabilityPreview")}
          </Button>
          <Button disabled={!canSave} onClick={() => void save()} type="button">
            {update.isPending ? t("capabilitySaving") : t("capabilitySave")}
          </Button>
        </div>
      </fieldset>
      {previewed ? (
        <p className="mt-3 text-sm" aria-live="polite">
          {t("capabilityPreviewResult")}:{" "}
          {displayCapabilityValue(previewed.status, t)}
        </p>
      ) : null}
      {impactPreview ? (
        <p className="mt-2 text-sm" aria-live="polite">
          {t("capabilityImpactCounts")}: {impactPreview.sampleCount}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setShowExplain(true);
            void explain.refetch();
          }}
          type="button"
          variant="outline"
        >
          {t("capabilityExplain")}
        </Button>
        <Button
          onClick={() => {
            setShowHistory(true);
            void history.refetch();
          }}
          type="button"
          variant="outline"
        >
          {t("capabilityHistory")}
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {t(copy.remediation)}
      </p>
      {showExplain ? (
        <aside className="mt-4 rounded-md bg-muted p-3" aria-live="polite">
          <h4 className="font-medium">{t("capabilityExplanation")}</h4>
          {explain.isFetching ? <p>{t("loading")}</p> : null}
          {explain.data ? (
            <ol className="list-decimal pl-5 text-sm">
              {explain.data.assignments.map((item) => (
                <li key={item.id}>
                  {displayCapabilityValue(item.layer, t)}:{" "}
                  {displayCapabilityValue(item.state, t)} (v{item.version})
                </li>
              ))}
            </ol>
          ) : null}
        </aside>
      ) : null}
      {showHistory ? (
        <aside className="mt-4 rounded-md bg-muted p-3" aria-live="polite">
          <h4 className="font-medium">{t("capabilityHistory")}</h4>
          {history.isFetching ? <p>{t("loading")}</p> : null}
          {history.data ? (
            <ol className="list-decimal pl-5 text-sm">
              {history.data.map((item) => (
                <li key={item.id}>
                  v{item.version} — {displayCapabilityValue(item.state, t)} —{" "}
                  {item.reason} —{" "}
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(item.createdAt))}
                </li>
              ))}
            </ol>
          ) : null}
        </aside>
      ) : null}
    </article>
  );
}
