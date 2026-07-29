import {
  Button,
  Field,
  IconButton,
  Input,
  Sheet,
  StatusBadge,
  Switch,
} from "@romeo/ui";
import { Link } from "@tanstack/react-router";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.mjs";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import Pencil from "lucide-react/dist/esm/icons/pencil.mjs";
import PlugZap from "lucide-react/dist/esm/icons/plug-zap.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";

import type {
  BaseModel,
  Provider,
  ProviderVerification,
} from "../features/providers/types";
import { useLocale } from "../lib/i18n";

export function ProviderDetailsSheet({
  deletingModelId,
  isUpdating,
  models,
  onClose,
  onConfigure,
  onDeleteModel,
  onPullModel,
  onRefresh,
  onToggle,
  onVerify,
  open,
  provider,
  pullName,
  pulling,
  setPullName,
  syncing,
  verification,
  verifying,
}: {
  deletingModelId: string | undefined;
  isUpdating: boolean;
  models: BaseModel[];
  onClose: () => void;
  onConfigure: () => void;
  onDeleteModel: (providerId: string, model: BaseModel) => Promise<void>;
  onPullModel: (providerId: string) => Promise<void>;
  onRefresh: () => void;
  onToggle: (enabled: boolean) => void;
  onVerify: () => void;
  open: boolean;
  provider: Provider | undefined;
  pullName: string;
  pulling: boolean;
  setPullName: (value: string) => void;
  syncing: boolean;
  verification: ProviderVerification | undefined;
  verifying: boolean;
}) {
  const { t } = useLocale();
  return (
    <Sheet
      closeLabel={t("close")}
      description={t("connectionDetails")}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
      title={provider?.name ?? t("providerCredentials")}
    >
      {provider ? (
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
              {models.length}
            </span>
          </div>
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
            <Button disabled={syncing} onClick={onRefresh} pending={syncing}>
              <RefreshCw aria-hidden size={14} /> {t("refreshModels")}
            </Button>
            <Button onClick={onConfigure} variant="primary">
              <Pencil aria-hidden size={14} /> {t("configure")}
            </Button>
          </div>
          {verification ? (
            <div
              className={`rm-connection-result ${verification.ok ? "success" : "error"}`}
              role="status"
            >
              {verification.ok ? (
                <CheckCircle2 aria-hidden size={14} />
              ) : (
                <CircleAlert aria-hidden size={14} />
              )}
              <span>{verification.message}</span>
              <small>{verification.latencyMs} ms</small>
            </div>
          ) : null}
          <div className="grid gap-2 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <strong>{t("discoveredModels")}</strong>
              <Button asChild size="sm" variant="ghost">
                <Link
                  onClick={onClose}
                  search={{
                    section: "providers",
                    view: "models",
                    provider: provider.id,
                  }}
                  to="/admin"
                >
                  {t("viewModels")}
                </Link>
              </Button>
            </div>
            {models.length > 0 ? (
              <ul className="rm-connection-model-list">
                {models.map((model) => (
                  <li key={model.id}>
                    <span title={model.name} translate="no">
                      {model.displayName}
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge tone={model.enabled ? "success" : "neutral"}>
                        {model.enabled
                          ? t("availableInChat")
                          : t("notAvailableInChat")}
                      </StatusBadge>
                      {provider.type === "ollama" ? (
                        <IconButton
                          aria-label={`${t("deleteOllamaModel")} ${model.name}`}
                          disabled={deletingModelId === model.id}
                          onClick={() => void onDeleteModel(provider.id, model)}
                          size="sm"
                          variant="ghost"
                        >
                          <Trash2 aria-hidden size={14} />
                        </IconButton>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("noModelsDiscovered")}</p>
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
      ) : null}
    </Sheet>
  );
}
