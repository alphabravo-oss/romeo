import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@romeo/ui";

import {
  getManagedModelCustomizationPolicy,
  updateManagedModelCustomizationPolicy,
} from "../features/managed-models";
import type {
  Agent,
  ManagedModelCustomizationPolicy,
} from "../features/managed-models";
import { useLocale, type MessageKey } from "../lib/i18n";
import { toast } from "../lib/toast";

const controls: Array<{
  field: keyof ManagedModelCustomizationPolicy;
  label: MessageKey;
}> = [
  { field: "allowCommunicationStyle", label: "managedModelAllowTone" },
  { field: "allowResponseLength", label: "managedModelAllowLength" },
  { field: "allowLanguage", label: "managedModelAllowLanguage" },
  { field: "allowCustomInstructions", label: "managedModelAllowInstructions" },
  { field: "allowPersonalMemory", label: "managedModelAllowMemory" },
  { field: "allowVoiceSelection", label: "managedModelAllowVoice" },
];

export function ManagedModelCustomizationPanel({
  activeAgent,
}: {
  activeAgent: Agent | undefined;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const policyQuery = useQuery({
    queryKey: ["managedModelCustomizationPolicy", activeAgent?.id],
    queryFn: () => getManagedModelCustomizationPolicy(activeAgent!.id),
    enabled: activeAgent !== undefined,
  });
  const updateMutation = useMutation({
    mutationFn: updateManagedModelCustomizationPolicy,
    onSuccess: async (policy) => {
      queryClient.setQueryData(
        ["managedModelCustomizationPolicy", activeAgent?.id],
        policy,
      );
      await queryClient.invalidateQueries({
        queryKey: ["managedModelPreferences", activeAgent?.id],
      });
    },
  });

  return (
    <div className="mt-4 grid gap-3 border-t border-border pt-4">
      <div>
        <div className="text-sm font-medium">
          {t("managedModelCustomization")}
        </div>
        <p className="mt-1 text-xs text-muted">
          {t("managedModelCustomizationDescription")}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {controls.map(({ field, label }) => (
          <div
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            key={field}
          >
            <Checkbox
              checked={policyQuery.data?.[field] === true}
              disabled={
                activeAgent === undefined ||
                policyQuery.isLoading ||
                updateMutation.isPending
              }
              label={t(label)}
              onCheckedChange={(checked) => {
                if (!activeAgent) return;
                void updateMutation
                  .mutateAsync({
                    agentId: activeAgent.id,
                    policy: { [field]: checked === true },
                  })
                  .then(() => toast(t("saved"), "success"))
                  .catch(() => toast(t("failed"), "error"));
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
