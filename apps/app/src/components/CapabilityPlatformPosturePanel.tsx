import { StatusBadge } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";

import {
  capabilityPlatformPostureQueryOptions,
  type PlatformCapabilityPosture,
} from "../features/capabilities";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { useRouterApiClient } from "../lib/router-context";
import { Section } from "./console";

const capabilityNameKeys = {
  image_generation: "capabilityImageGenerationName",
  reasoning_policy: "capabilityReasoningPolicyName",
  voice_processing: "capabilityVoiceProcessingName",
  web_retrieval: "capabilityWebRetrievalName",
  content_firewall: "capabilityContentFirewallName",
  knowledge_acl: "capabilityKnowledgeAclName",
  realtime_voice: "capabilityRealtimeVoiceName",
  image_editing: "capabilityImageEditingName",
  secure_compute: "capabilitySecureComputeName",
  multi_model_compare: "capabilityMultiModelCompareName",
  tenant_encryption: "capabilityTenantEncryptionName",
  data_export: "capabilityDataExportName",
} as const satisfies Record<
  PlatformCapabilityPosture["capabilities"][number]["capabilityId"],
  MessageKey
>;

export function CapabilityPlatformPosturePanel() {
  const apiClient = useRouterApiClient();
  const query = useQuery(capabilityPlatformPostureQueryOptions(apiClient));
  return (
    <PanelState query={query}>
      {(posture) => <CapabilityPlatformPostureView posture={posture} />}
    </PanelState>
  );
}

export function CapabilityPlatformPostureView({
  posture,
}: {
  posture: PlatformCapabilityPosture;
}) {
  const { t } = useLocale();
  return (
    <Section
      description={t("capabilityPlatformIntro")}
      title={t("capabilityPlatformAdministration")}
    >
      <div className="grid gap-3">
        <p className="text-sm text-muted" role="status">
          {t("capabilityPlatformReadOnly")}
        </p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("capabilityRegistryVersion")}
            </dt>
            <dd translate="no">{posture.registryVersion}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("capabilityPlatformControlPlane")}
            </dt>
            <dd>{t("capabilityPlatformDeploymentEnvironment")}</dd>
          </div>
        </dl>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {posture.capabilities.map((capability) => (
            <li
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              key={capability.capabilityId}
            >
              <span>{t(capabilityNameKeys[capability.capabilityId])}</span>
              <StatusBadge
                tone={capability.state === "enabled" ? "success" : "danger"}
              >
                {t(
                  capability.state === "enabled"
                    ? "capabilityValueEnabled"
                    : "capabilityValueDisabled",
                )}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
