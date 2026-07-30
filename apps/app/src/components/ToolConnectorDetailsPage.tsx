import { Button, StatusBadge } from "@romeo/ui";
import Power from "lucide-react/dist/esm/icons/power.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";

import type { ToolConnector, ToolConnectorAuthCheck } from "../features/types";
import { type MessageKey, useLocale } from "../lib/i18n";
import { ToolOperationList } from "./ToolOperationList";

type Translate = (key: MessageKey) => string;

export function ToolConnectorDetailsPage({
  authCheck,
  checkingAuth,
  connector,
  onCheckAuth,
  onToggle,
  updating,
}: {
  authCheck: ToolConnectorAuthCheck | undefined;
  checkingAuth: boolean;
  connector: ToolConnector;
  onCheckAuth: (connectorId: string) => Promise<void>;
  onToggle: (connectorId: string, enabled: boolean) => Promise<void>;
  updating: boolean;
}) {
  const { t } = useLocale();
  return (
    <div className="grid gap-5">
      <div>
        <h2 className="rm-card-title">{connector.name}</h2>
        <p className="text-sm text-muted">{t("toolManageDescription")}</p>
      </div>
      <div className="rm-model-meta-grid">
        <span>
          <small>{t("toolType")}</small>
          <span translate="no">{connector.type}</span>
        </span>
        <span>
          <small>{t("toolStatus")}</small>
          <StatusBadge tone={connector.enabled ? "success" : "neutral"}>
            {t(connector.enabled ? "toolEnabled" : "toolDisabled")}
          </StatusBadge>
        </span>
        <span>
          <small>{t("toolRisk")}</small>
          {humanize(connector.riskLevel)}
        </span>
        <span>
          <small>{t("toolConnectorApproval")}</small>
          {humanize(connector.approvalPolicy)}
        </span>
        <span>
          <small>{t("toolVisibility")}</small>
          {humanize(connector.visibility)}
        </span>
        <span>
          <small>{t("toolDependentAssistants")}</small>
          {connector.dependentAgentCount ?? 0}
        </span>
        <span>
          <small>{t("toolDependentOperations")}</small>
          {connector.dependentOperationCount ?? 0}
        </span>
        <span>
          <small>{t("toolAuth")}</small>
          {t(
            connector.authConfig.configured === true
              ? "toolAuthRefSet"
              : "toolNoAuthRef",
          )}
        </span>
      </div>
      {connector.description ? (
        <p className="text-sm text-muted">{connector.description}</p>
      ) : null}
      <div className="text-sm text-muted">
        {networkPolicyText(connector.networkPolicy, t)}
      </div>
      {authCheck ? (
        <div className="text-sm text-muted">{authCheckText(authCheck, t)}</div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={updating}
          onClick={() => void onToggle(connector.id, !connector.enabled)}
          type="button"
        >
          <Power aria-hidden="true" size={16} />
          {t(connector.enabled ? "toolDisable" : "toolEnable")}
        </Button>
        <Button
          disabled={checkingAuth}
          onClick={() => void onCheckAuth(connector.id)}
          type="button"
        >
          <ShieldCheck aria-hidden="true" size={16} />
          {t("toolCheckAuth")}
        </Button>
      </div>
      <div className="border-t border-border pt-4">
        <details className="mb-4 rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t("toolConnectorSchema")}
          </summary>
          <pre className="mt-3 max-h-80 overflow-auto text-xs">
            {JSON.stringify(connector.schema, null, 2)}
          </pre>
        </details>
        <ToolOperationList connectorId={connector.id} />
      </div>
    </div>
  );
}

function authCheckText(check: ToolConnectorAuthCheck, t: Translate): string {
  if (!check.configured) return t("toolSecretNotConfigured");
  if (check.available)
    return `${t("toolSecretAvailable")} (${check.secretRefScheme ?? t("toolManaged")})`;
  return `${t("toolSecretUnavailable")}: ${check.failureCode ?? t("toolUnavailable")}`;
}

function networkPolicyText(
  policy: { mode: string; allowedHosts: string[] },
  t: Translate,
): string {
  return policy.mode === "allow_hosts"
    ? `${t("toolNetwork")}: ${policy.allowedHosts.join(", ")}`
    : `${t("toolNetwork")}: ${t("toolNetworkDenyAll")}`;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
