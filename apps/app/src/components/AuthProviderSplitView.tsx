import { Button, EmptyState, StatusBadge, Switch } from "@romeo/ui";
import KeySquare from "lucide-react/dist/esm/icons/key-square.mjs";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.mjs";
import TestTube2 from "lucide-react/dist/esm/icons/test-tube-2.mjs";
import { useMemo } from "react";

import type {
  AuthProviderCatalogEntry,
  AuthProviderConnectionTestReport,
  AuthProviderId,
  EffectiveAuthProviderSetting,
} from "../features/auth-provider-administration";
import { useLocale } from "../lib/i18n";
import { authProviderIcon } from "./AuthProviderIcons";
import {
  canDeprovisionProvider,
  canTestProvider,
} from "./auth-provider-card-actions";
import { splitProviderZones } from "./auth-provider-zones";
import { PanelStats } from "./PanelStats";
import { ProviderSlotCard } from "./ProviderSlotCard";

interface AuthProviderRow {
  configured: boolean;
  enabled: boolean;
  entry: AuthProviderCatalogEntry;
  id: string;
  setting: EffectiveAuthProviderSetting | undefined;
  status: "implemented" | "planned";
  test: AuthProviderConnectionTestReport | undefined;
}

/**
 * Authentication is a closed catalog of singleton slots, so it is presented
 * as active/configured methods and available slots rather than as an inventory
 * table that implies administrators can create duplicate providers.
 */
export function AuthProviderSplitView({
  busy,
  catalog,
  deprovisioning,
  effectiveById,
  onConfigure,
  onDeprovision,
  onTest,
  onToggle,
  testing,
  testResults,
}: {
  busy: boolean;
  catalog: AuthProviderCatalogEntry[];
  deprovisioning: boolean;
  effectiveById: Map<AuthProviderId, EffectiveAuthProviderSetting>;
  onConfigure: (entry: AuthProviderCatalogEntry) => void;
  onDeprovision: (entry: AuthProviderCatalogEntry) => void;
  onTest: (entry: AuthProviderCatalogEntry) => void;
  onToggle: (entry: AuthProviderCatalogEntry, enabled: boolean) => void;
  testing: boolean;
  testResults: Record<string, AuthProviderConnectionTestReport>;
}): React.ReactNode {
  const { t } = useLocale();
  const rows = useMemo<AuthProviderRow[]>(
    () =>
      catalog.map((entry) => {
        const setting = effectiveById.get(entry.id);
        return {
          configured:
            setting?.oidc?.issuerConfigured === true ||
            setting?.secretRefConfigured === true ||
            entry.id === "local",
          enabled: setting?.enabled ?? false,
          entry,
          id: entry.id,
          setting,
          status: entry.status,
          test: testResults[entry.id],
        };
      }),
    [catalog, effectiveById, testResults],
  );
  const zones = useMemo(() => splitProviderZones(rows), [rows]);
  const enabledCount = useMemo(
    () => rows.filter((row) => row.enabled).length,
    [rows],
  );

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: t("authActiveSlots"), value: zones.active.length },
          { label: t("authEnabled"), value: enabledCount },
          { label: t("authAvailableSlots"), value: zones.available.length },
        ]}
      />

      <section className="rm-provider-zone">
        <h3 className="rm-provider-zone__label">{t("authZoneActive")}</h3>
        {zones.active.length === 0 ? (
          <EmptyState
            icon={<KeySquare aria-hidden size={24} />}
            title={t("authNoActiveProviders")}
          >
            {t("authNoActiveProvidersDescription")}
          </EmptyState>
        ) : (
          <div className="rm-provider-zone__grid">
            {zones.active.map((row) => (
              <ProviderSlotCard
                actions={
                  <>
                    <Switch
                      checked={row.enabled}
                      disabled={row.status === "planned" || busy}
                      label={t("authEnabled")}
                      onCheckedChange={(checked) =>
                        onToggle(row.entry, checked === true)
                      }
                    />
                    <Button
                      onClick={() => onConfigure(row.entry)}
                      size="sm"
                      variant="secondary"
                    >
                      <Settings2 aria-hidden size={14} />
                      {t("authConfigure")}
                    </Button>
                    {canTestProvider(row.entry) ? (
                      <Button
                        disabled={testing}
                        onClick={() => onTest(row.entry)}
                        pending={testing}
                        size="sm"
                      >
                        <TestTube2 aria-hidden size={14} />
                        {t("authTest")}
                      </Button>
                    ) : null}
                    {canDeprovisionProvider(row.entry) ? (
                      <Button
                        aria-haspopup="dialog"
                        disabled={deprovisioning}
                        onClick={() => onDeprovision(row.entry)}
                        size="sm"
                        variant="ghost"
                      >
                        {t("authDeprovisionUser")}
                      </Button>
                    ) : null}
                  </>
                }
                configured={row.configured}
                enabled={row.enabled}
                icon={authProviderIcon(row.entry.id)}
                key={row.entry.id}
                name={row.entry.name}
                protocol={row.entry.protocol}
                testStatus={
                  row.test?.status === "disabled"
                    ? "not_tested"
                    : (row.test?.status ?? "not_tested")
                }
              />
            ))}
          </div>
        )}
      </section>

      {zones.available.length > 0 ? (
        <section className="rm-provider-zone">
          <h3 className="rm-provider-zone__label">
            {t("authZoneAvailable")} · {zones.available.length}
          </h3>
          <div className="rm-provider-zone__grid rm-provider-zone__grid--dense">
            {zones.available.map((row) => (
              <Button
                key={row.entry.id}
                onClick={() => onConfigure(row.entry)}
                variant="outline"
              >
                <span className="shrink-0">
                  {authProviderIcon(row.entry.id)}
                </span>
                <span translate="no">{row.entry.name}</span>
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {zones.unavailable.length > 0 ? (
        <section className="rm-provider-zone">
          <h3 className="rm-provider-zone__label">
            {t("authZoneUnavailable")}
          </h3>
          <div className="rm-provider-card__facts">
            {zones.unavailable.map((row) => (
              <StatusBadge key={row.entry.id}>
                <span translate="no">{row.entry.name}</span> ·{" "}
                {t("authComingSoon")}
              </StatusBadge>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
