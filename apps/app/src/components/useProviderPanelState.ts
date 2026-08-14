import { useMemo, useRef, useState } from "react";

import type {
  BaseModel,
  Provider,
  ProviderVerification,
} from "../features/providers/types";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { useConfirm } from "./ConfirmDialog";
import { safeUserErrorMessage } from "../lib/safe-user-error";

export function useProviderPanelState(input: {
  models: BaseModel[];
  onDeleteProviderModel: (
    providerId: string,
    modelId: string,
    model: string,
  ) => Promise<unknown>;
  onPullProviderModel: (providerId: string, model: string) => Promise<unknown>;
  onSyncProvider: (providerId: string) => Promise<void>;
  onVerifyProvider: (
    providerId: string,
    signal?: AbortSignal,
  ) => Promise<ProviderVerification>;
}) {
  const { t } = useLocale();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [dialog, setDialog] = useState<"new" | Provider>();
  const [verification, setVerification] = useState<
    Record<string, ProviderVerification>
  >({});
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    () => new Set(),
  );
  const [pullNames, setPullNames] = useState<Record<string, string>>({});
  const verifyAbort = useRef<AbortController | undefined>(undefined);
  const modelsByProvider = useMemo(() => {
    const grouped = new Map<string, BaseModel[]>();
    for (const model of input.models) {
      const items = grouped.get(model.providerId) ?? [];
      items.push(model);
      grouped.set(model.providerId, items);
    }
    for (const items of grouped.values()) {
      items.sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      );
    }
    return grouped;
  }, [input.models]);

  async function verify(providerId: string) {
    verifyAbort.current?.abort();
    const controller = new AbortController();
    verifyAbort.current = controller;
    try {
      const result = await input.onVerifyProvider(providerId, controller.signal);
      if (controller.signal.aborted) return;
      setVerification((current) => ({ ...current, [providerId]: result }));
      toast(
        result.ok ? t("connectionVerified") : t("couldNotVerifyConnection"),
        result.ok ? "success" : "error",
      );
    } catch {
      if (controller.signal.aborted) {
        toast(t("catalogVerifyCancelled"));
        return;
      }
      toast(t("couldNotVerifyConnection"), "error");
    }
  }

  function cancelVerify() {
    verifyAbort.current?.abort();
  }

  async function sync(providerId: string) {
    try {
      await input.onSyncProvider(providerId);
      toast(t("modelsSynced"), "success");
    } catch (caught) {
      toast(safeUserErrorMessage(caught, t("couldNotSyncModels")), "error");
    }
  }

  async function pull(providerId: string) {
    const model = pullNames[providerId]?.trim();
    if (!model) return;
    try {
      await input.onPullProviderModel(providerId, model);
      setPullNames((current) => ({ ...current, [providerId]: "" }));
      toast(t("modelPulled"), "success");
    } catch {
      toast(t("couldNotPullModel"), "error");
    }
  }

  async function remove(providerId: string, model: BaseModel) {
    const confirmed = await ask({
      title: t("deleteOllamaModel"),
      body: `${t("deleteOllamaModelDescription")} ${model.name}`,
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await input.onDeleteProviderModel(providerId, model.id, model.name);
      toast(t("modelDeleted"), "success");
    } catch {
      toast(t("couldNotDeleteModel"), "error");
    }
  }

  return {
    cancelVerify,
    confirmDialog,
    dialog,
    expandedProviders,
    modelsByProvider,
    pull,
    pullNames,
    remove,
    setDialog,
    setExpandedProviders,
    setPullNames,
    sync,
    verification,
    verify,
  };
}
