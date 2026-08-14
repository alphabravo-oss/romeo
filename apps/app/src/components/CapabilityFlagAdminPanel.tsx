import {
  capabilitiesGetAdminOverviewQueryKey,
  capabilityFlagsGetAdminReportQueryKey,
  capabilityFlagsGetHistoryQueryKey,
  capabilityFlagsListEffectiveQueryKey,
  capabilityFlagsUpdateMutation,
} from "@romeo/api-client/generated/query";
import { Button, Field, InlineError, NativeSelect, Textarea } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { CapabilityScope } from "../features/capabilities/queries";
import {
  capabilityFlagAdminReportQueryOptions,
  capabilityFlagHistoryQueryOptions,
  type CapabilityFlagAdminReport,
  type CapabilityFlagId,
  type CapabilityFlagState,
  type OrganizationCapabilityFlag,
} from "../features/capability-flags";
import * as appQueryKeys from "../lib/app-query-keys";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { useRouterApiClient } from "../lib/router-context";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { toast } from "../lib/toast";
import {
  capabilityFlagNameKey,
  formatCapabilityFlagAllowlist,
  parseCapabilityFlagAllowlist,
  type CapabilityFlagAllowlistError,
} from "./capability-flag-admin-model";
import { capabilityApiErrorCode } from "./capability-admin-display";
import { Section, StatRow } from "./console";

type FlagDefinition = CapabilityFlagAdminReport["definitions"][number];

export function CapabilityFlagAdminPanel({
  capabilityScopes,
}: {
  capabilityScopes: CapabilityScope[];
}): React.ReactNode {
  const apiClient = useRouterApiClient();
  const { t } = useLocale();
  const report = useQuery(capabilityFlagAdminReportQueryOptions(apiClient));

  return (
    <Section
      description={t("capabilityFlagAdminIntro")}
      title={t("capabilityFlagAdministration")}
    >
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          {t("capabilityFlagPrecedenceNotice")}
        </p>
        <PanelState query={report}>
          {(data) => (
            <CapabilityFlagInventory
              capabilityScopes={capabilityScopes}
              report={data}
            />
          )}
        </PanelState>
      </div>
    </Section>
  );
}

function CapabilityFlagInventory({
  capabilityScopes,
  report,
}: {
  capabilityScopes: CapabilityScope[];
  report: CapabilityFlagAdminReport;
}) {
  const configuredById = useMemo(
    () => new Map(report.configured.map((item) => [item.flagId, item])),
    [report.configured],
  );
  const platformDisabled = useMemo(
    () => new Set(report.platformDisabledFlagIds),
    [report.platformDisabledFlagIds],
  );
  return (
    <div className="grid gap-3">
      {report.definitions.map((definition) => {
        const configured = configuredById.get(definition.id);
        return (
          <CapabilityFlagRow
            capabilityScopes={capabilityScopes}
            configured={configured}
            definition={definition}
            key={`${definition.id}:${configured?.version ?? 0}`}
            platformDisabled={platformDisabled.has(definition.id)}
          />
        );
      })}
    </div>
  );
}

function CapabilityFlagRow({
  capabilityScopes,
  configured,
  definition,
  platformDisabled,
}: {
  capabilityScopes: CapabilityScope[];
  configured: OrganizationCapabilityFlag | undefined;
  definition: FlagDefinition;
  platformDisabled: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const currentState = configured?.state ?? definition.defaultState;
  const flagLabel = t(capabilityFlagNameKey(definition.id));
  return (
    <details
      className="rounded-lg border"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary aria-label={flagLabel} className="cursor-pointer px-4 py-3">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{flagLabel}</span>
          <span className="text-sm text-muted-foreground">
            {t(
              platformDisabled
                ? "capabilityFlagPlatformDisabled"
                : currentState === "preview"
                  ? "capabilityFlagPreview"
                  : currentState === "enabled"
                    ? "capabilityValueEnabled"
                    : "capabilityValueDisabled",
            )}
          </span>
        </span>
      </summary>
      {open ? (
        <CapabilityFlagEditor
          capabilityScopes={capabilityScopes}
          configured={configured}
          definition={definition}
          platformDisabled={platformDisabled}
        />
      ) : null}
    </details>
  );
}

function CapabilityFlagEditor({
  capabilityScopes,
  configured,
  definition,
  platformDisabled,
}: {
  capabilityScopes: CapabilityScope[];
  configured: OrganizationCapabilityFlag | undefined;
  definition: FlagDefinition;
  platformDisabled: boolean;
}) {
  const apiClient = useRouterApiClient();
  const queryClient = useQueryClient();
  const { locale, t } = useLocale();
  const [state, setState] = useState<CapabilityFlagState>(
    configured?.state ?? definition.defaultState,
  );
  const [allowlist, setAllowlist] = useState(() =>
    formatCapabilityFlagAllowlist(configured?.allowlistedSubjects ?? []),
  );
  const [reason, setReason] = useState("");
  const [allowlistError, setAllowlistError] =
    useState<CapabilityFlagAllowlistError>();
  const [saveError, setSaveError] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const update = useMutation(
    capabilityFlagsUpdateMutation({ client: apiClient }),
  );
  const history = useQuery(
    capabilityFlagHistoryQueryOptions(definition.id, historyOpen, apiClient),
  );
  const parsedAllowlist = parseCapabilityFlagAllowlist(allowlist);
  const historyId = `capability-flag-history-${definition.id}`;

  async function save(): Promise<void> {
    setSaveError(undefined);
    if (!parsedAllowlist.ok) {
      setAllowlistError(parsedAllowlist.error);
      return;
    }
    if (state === "preview" && parsedAllowlist.subjects.length === 0) {
      setAllowlistError("invalid");
      return;
    }
    setAllowlistError(undefined);
    try {
      await update.mutateAsync({
        body: {
          allowlistedSubjects:
            state === "preview" ? parsedAllowlist.subjects : [],
          expectedVersion: configured?.version ?? 0,
          reason: reason.trim(),
          state,
        },
        path: { flagId: definition.id },
      });
      setReason("");
      await invalidateCapabilityFlagQueries({
        apiClient,
        capabilityScopes,
        flagId: definition.id,
        queryClient,
      });
      toast(t("capabilityFlagSaved"), "success");
    } catch (caught) {
      if (
        capabilityApiErrorCode(caught) === "capability_flag_version_conflict"
      ) {
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: capabilityFlagsGetAdminReportQueryKey({
            client: apiClient,
          }),
        });
        setSaveError(t("capabilityFlagVersionConflict"));
        return;
      }
      setSaveError(safeUserErrorMessage(caught, t("capabilityFlagSaveFailed")));
    }
  }

  return (
    <div className="grid gap-4 border-t px-4 py-4">
      <StatRow
        items={[
          {
            label: t("capabilityFlagDefault"),
            value: t(
              definition.defaultState === "enabled"
                ? "capabilityValueEnabled"
                : "capabilityValueDisabled",
            ),
          },
          {
            label: t("capabilityFlagConsumer"),
            value: t(
              definition.consumerStatus === "enforced"
                ? "capabilityFlagEnforced"
                : "capabilityFlagReserved",
            ),
          },
          {
            label: t("capabilityFlagPlatformCeiling"),
            value: t(
              platformDisabled
                ? "capabilityFlagPlatformDisabled"
                : definition.platformCapabilityId === undefined
                  ? "capabilityFlagNotApplicable"
                  : "capabilityFlagPlatformAllows",
            ),
            tone: platformDisabled ? "danger" : "default",
          },
          {
            label: t("capabilityFlagRevision"),
            value:
              configured === undefined
                ? t("capabilityFlagDefaultRevision")
                : `v${configured.version}`,
          },
        ]}
      />
      <p className="text-sm" role={platformDisabled ? "alert" : "status"}>
        {platformDisabled
          ? t("capabilityFlagPlatformDisabledNotice")
          : definition.consumerStatus === "enforced"
            ? t("capabilityFlagEnforcedNotice")
            : t("capabilityFlagReservedNotice")}
      </p>
      <fieldset className="grid gap-4" disabled={update.isPending}>
        <legend className="font-medium">
          {t("capabilityFlagOrganizationOverride")}
        </legend>
        <Field label={t("capabilityFlagState")}>
          <NativeSelect
            name={`capability-flag-state-${definition.id}`}
            onChange={(event) => {
              setState(event.currentTarget.value as CapabilityFlagState);
              setAllowlistError(undefined);
            }}
            value={state}
          >
            <option value="disabled">{t("capabilityValueDisabled")}</option>
            <option value="preview">{t("capabilityFlagPreview")}</option>
            <option value="enabled">{t("capabilityValueEnabled")}</option>
          </NativeSelect>
        </Field>
        {state === "preview" ? (
          <Field
            description={t("capabilityFlagAllowlistDescription")}
            error={
              allowlistError === undefined
                ? undefined
                : t(
                    allowlistError === "duplicate"
                      ? "capabilityFlagAllowlistDuplicate"
                      : allowlistError === "too_many"
                        ? "capabilityFlagAllowlistTooMany"
                        : "capabilityFlagAllowlistInvalid",
                  )
            }
            label={t("capabilityFlagAllowlist")}
            required
          >
            <Textarea
              name={`capability-flag-allowlist-${definition.id}`}
              onChange={(event) => {
                setAllowlist(event.currentTarget.value);
                setAllowlistError(undefined);
              }}
              onBlur={() => {
                const parsed = parseCapabilityFlagAllowlist(allowlist);
                setAllowlistError(
                  !parsed.ok
                    ? parsed.error
                    : parsed.subjects.length === 0
                      ? "invalid"
                      : undefined,
                );
              }}
              placeholder={t("capabilityFlagAllowlistPlaceholder")}
              rows={4}
              spellCheck={false}
              value={allowlist}
            />
          </Field>
        ) : null}
        <Field
          description={t("capabilityFlagReasonDescription")}
          label={t("capabilityReason")}
          required
        >
          <Textarea
            maxLength={1000}
            name={`capability-flag-reason-${definition.id}`}
            onChange={(event) => setReason(event.currentTarget.value)}
            required
            rows={2}
            value={reason}
          />
        </Field>
        {saveError === undefined ? null : (
          <InlineError role="alert">{saveError}</InlineError>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={reason.trim().length === 0}
            onClick={() => void save()}
            type="button"
          >
            {update.isPending ? t("capabilitySaving") : t("capabilityFlagSave")}
          </Button>
          <Button
            aria-controls={historyId}
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((current) => !current)}
            type="button"
            variant="outline"
          >
            {t("capabilityHistory")}
          </Button>
        </div>
      </fieldset>
      {historyOpen ? (
        <div
          aria-live="polite"
          className="rounded-md bg-muted p-3"
          id={historyId}
        >
          <h4 className="font-medium">{t("capabilityHistory")}</h4>
          <PanelState empty={t("capabilityFlagNoHistory")} query={history}>
            {(items) => (
              <ol className="list-decimal pl-5 text-sm">
                {items.map((item) => (
                  <li key={item.id}>
                    v{item.version} —{" "}
                    {t(
                      item.state === "preview"
                        ? "capabilityFlagPreview"
                        : item.state === "enabled"
                          ? "capabilityValueEnabled"
                          : "capabilityValueDisabled",
                    )}{" "}
                    — {item.reason} —{" "}
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(item.createdAt))}
                  </li>
                ))}
              </ol>
            )}
          </PanelState>
        </div>
      ) : null}
    </div>
  );
}

async function invalidateCapabilityFlagQueries(input: {
  apiClient: ReturnType<typeof useRouterApiClient>;
  capabilityScopes: CapabilityScope[];
  flagId: CapabilityFlagId;
  queryClient: ReturnType<typeof useQueryClient>;
}): Promise<void> {
  const { apiClient, capabilityScopes, flagId, queryClient } = input;
  const invalidations = [
    queryClient.invalidateQueries({
      exact: true,
      queryKey: capabilityFlagsGetAdminReportQueryKey({ client: apiClient }),
    }),
    queryClient.invalidateQueries({
      exact: true,
      queryKey: capabilityFlagsGetHistoryQueryKey({
        client: apiClient,
        path: { flagId },
      }),
    }),
    queryClient.invalidateQueries({
      exact: true,
      queryKey: capabilityFlagsListEffectiveQueryKey({ client: apiClient }),
    }),
  ];
  for (const scope of capabilityScopes) {
    invalidations.push(
      queryClient.invalidateQueries({
        exact: true,
        queryKey: capabilitiesGetAdminOverviewQueryKey({
          client: apiClient,
          query: scope,
        }),
      }),
    );
  }
  for (const workspaceId of new Set(
    capabilityScopes.map((scope) => scope.workspaceId),
  ))
    invalidations.push(
      queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.workspaceCapabilities(workspaceId),
      }),
    );
  await Promise.all(invalidations);
}
