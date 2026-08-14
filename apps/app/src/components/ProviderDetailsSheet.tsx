import { Button, Field, Input, StatusBadge, Switch } from "@romeo/ui";
import { Link } from "@tanstack/react-router";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.mjs";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import Pencil from "lucide-react/dist/esm/icons/pencil.mjs";
import PlugZap from "lucide-react/dist/esm/icons/plug-zap.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";

import type {
  BaseModel,
  Provider,
  ProviderVerification,
} from "../features/providers/types";
import type { Agent } from "../features/managed-models/types";
import { useLocale } from "../lib/i18n";
import { ProviderCatalogStatus } from "./ProviderCatalogStatus";
import { ProviderCapabilityEvidencePanel } from "./ProviderCapabilityEvidence";
import { ProviderDialectSummary } from "./ProviderDialectSummary";
import { ProviderModelsTable } from "./ProviderModelsTable";

export function ProviderDetailsPage({
  dependentAgents,
  deletingModelId,
  isUpdating,
  models,
  onBack,
  onConfigure,
  onDeleteModel,
  onPullModel,
  onRefresh,
  onToggle,
  onToggleModel,
  onCancelVerify,
  onVerify,
  provider,
  pullName,
  pulling,
  setPullName,
  syncing,
  verification,
  verifying,
}: {
  dependentAgents: Agent[];
  deletingModelId: string | undefined;
  isUpdating: boolean;
  models: BaseModel[];
  onBack: () => void;
  onConfigure: () => void;
  onDeleteModel: (providerId: string, model: BaseModel) => Promise<void>;
  onPullModel: (providerId: string) => Promise<void>;
  onRefresh: () => void;
  onToggle: (enabled: boolean) => void;
  onToggleModel: (model: BaseModel, enabled: boolean) => Promise<void>;
  onCancelVerify?: () => void;
  onVerify: () => void;
  provider: Provider | undefined;
  pullName: string;
  pulling: boolean;
  setPullName: (value: string) => void;
  syncing: boolean;
  verification: ProviderVerification | undefined;
  verifying: boolean;
}) {
  const { t } = useLocale();
  if (!provider) return null;
  const availableModels = models.filter(
    (model) => model.available !== false,
  ).length;

  return (
    <div className="grid gap-4">
      <Button className="w-fit" onClick={onBack} variant="ghost">
        <ArrowLeft aria-hidden="true" size={16} />
        {t("backToProviders")}
      </Button>
      <section>
        <div className="rm-card-header">
          <div>
            <h2 className="rm-card-title">{provider.name}</h2>
            <p className="text-sm text-muted">{t("connectionDetails")}</p>
          </div>
          <Button onClick={onConfigure} variant="primary">
            <Pencil aria-hidden size={14} /> {t("configure")}
          </Button>
        </div>
        <div className="grid gap-5">
          <div className="rm-model-meta-grid">
            <span>
              <small>{t("providerType")}</small>
              <span translate="no">{provider.type}</span>
            </span>
            <span>
              <small>{t("status")}</small>
              <StatusBadge tone={provider.enabled ? "success" : "neutral"}>
                {provider.enabled ? t("enabled") : t("disabled")}
              </StatusBadge>
            </span>
            <span>
              <small>{t("models")}</small>
              {availableModels}/{models.length}
            </span>
            <span>
              <small>{t("catalog")}</small>
              <ProviderCatalogStatus compact provider={provider} />
            </span>
            <span>
              <small>{t("providerDependentAssistants")}</small>
              {dependentAgents.length}
            </span>
          </div>
          <ProviderDialectSummary dialect={provider.dialect} />
          <ProviderCapabilityEvidencePanel providerId={provider.id} />
          {dependentAgents.length > 0 ? (
            <div className="rounded-md border border-border p-3 text-sm">
              <strong>{t("dependencyImpact")}</strong>
              <p className="mt-1 text-muted">
                {dependentAgents.map((agent) => agent.name).join(", ")}
              </p>
            </div>
          ) : null}
          <div className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("endpoint")}
            </span>
            <code className="break-words text-sm" translate="no">
              {provider.baseUrl}
            </code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={provider.enabled}
              disabled={isUpdating}
              label={t("enabled")}
              onCheckedChange={(checked) => onToggle(checked === true)}
            />
            <Button disabled={verifying} onClick={onVerify} pending={verifying}>
              <PlugZap aria-hidden size={14} /> {t("verify")}
            </Button>
            {verifying && onCancelVerify !== undefined ? (
              <Button onClick={onCancelVerify} variant="outline">
                {t("cancel")}
              </Button>
            ) : null}
            <Button asChild variant="ghost">
              <Link search={{ auditCategory: "admin", section: "audit" }} to="/admin">
                {t("catalogViewAudit")}
              </Link>
            </Button>
            <Button disabled={syncing} onClick={onRefresh} pending={syncing}>
              <RefreshCw aria-hidden size={14} /> {t("syncNow")}
            </Button>
          </div>
          <div className="rm-catalog-sync-summary">
            <div>
              <strong>{t("automaticCatalogSync")}</strong>
              <p>{t("automaticCatalogSyncDescription")}</p>
            </div>
            <ProviderCatalogStatus provider={provider} />
          </div>
          {verification ? (
            <div
              className={`rm-connection-result ${verification.ok ? "success" : "error"}`}
              role={verification.ok ? "status" : "alert"}
            >
              {verification.ok ? (
                <CheckCircle2 aria-hidden size={14} />
              ) : (
                <CircleAlert aria-hidden size={14} />
              )}
              <span>
                {verification.ok
                  ? t("connectionVerified")
                  : t("couldNotVerifyConnection")}
              </span>
              <small>{verification.latencyMs} ms</small>
            </div>
          ) : null}
          <div className="grid gap-2 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <strong>{t("discoveredModels")}</strong>
              <Button asChild size="sm" variant="ghost">
                <Link
                  search={{
                    section: "providers",
                    view: "base-models",
                    provider: provider.id,
                  }}
                  to="/admin"
                >
                  {t("viewModels")}
                </Link>
              </Button>
            </div>
            {models.length > 0 ? (
              <ProviderModelsTable
                deletingModelId={deletingModelId}
                dependentAgents={dependentAgents}
                isUpdating={isUpdating}
                models={models}
                onDeleteModel={onDeleteModel}
                onToggleModel={onToggleModel}
                provider={provider}
              />
            ) : (
              <p className="text-sm text-muted">
                {provider.catalogSync?.status === "error"
                  ? t("catalogSyncFailedEmpty")
                  : t("catalogSyncPendingEmpty")}
              </p>
            )}
          </div>
          {provider.type === "ollama" ? (
            <form
              className="rm-ollama-pull"
              onSubmit={(event) => {
                event.preventDefault();
                void onPullModel(provider.id);
              }}
            >
              <div>
                <Field
                  description={t("pullOllamaModelDescription")}
                  label={t("pullOllamaModel")}
                >
                  <Input
                    name="pullName"
                    onChange={(event) => setPullName(event.currentTarget.value)}
                    placeholder="llama3.2:latest"
                    value={pullName}
                  />
                </Field>
                <Button
                  disabled={pulling || pullName.trim() === ""}
                  pending={pulling}
                  type="submit"
                >
                  <Download aria-hidden size={14} />
                  {t("pullModel")}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
}
