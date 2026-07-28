import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Field, Input, Select, Textarea } from "@romeo/ui";
import { useMemo, useState } from "react";

import { createAgent } from "../features/managed-models";
import type { BaseModel, Provider } from "../features/providers/types";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";

export function CreateManagedModelDialog({
  models,
  onCreated,
  providers,
  workspaceId,
}: {
  models: BaseModel[];
  onCreated: (agentId: string) => void;
  providers: Provider[];
  workspaceId: string | undefined;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseModelId, setBaseModelId] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const providerNames = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );
  const enabledModels = models.filter((model) => model.enabled);
  const createMutation = useMutation({ mutationFn: createAgent });

  function reset() {
    setName("");
    setBaseModelId(enabledModels[0]?.id ?? "");
    setSystemPrompt("");
  }

  async function submit() {
    if (!workspaceId || !baseModelId || !name.trim() || !systemPrompt.trim())
      return;
    try {
      const created = await createMutation.mutateAsync({
        workspaceId,
        name: name.trim(),
        baseModelId,
        systemPrompt: systemPrompt.trim(),
      });
      await queryClient.invalidateQueries({
        queryKey: ["agents", workspaceId],
      });
      onCreated(created.id);
      setOpen(false);
      reset();
      toast(t("agentCreated"), "success");
    } catch {
      toast(t("agentCouldNotCreate"), "error");
    }
  }

  return (
    <Dialog
      closeLabel={t("close")}
      description={t("agentCreateDescription")}
      footer={
        <Button
          disabled={
            !workspaceId || !baseModelId || !name.trim() || !systemPrompt.trim()
          }
          onClick={() => void submit()}
          pending={createMutation.isPending}
          variant="primary"
        >
          {t("agentCreate")}
        </Button>
      }
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen && !baseModelId)
          setBaseModelId(enabledModels[0]?.id ?? "");
      }}
      open={open}
      title={t("agentCreateTitle")}
      trigger={
        <Button disabled={!workspaceId || enabledModels.length === 0}>
          {t("agentNew")}
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label={t("agentName")} required>
          <Input
            autoComplete="off"
            onChange={(event) => setName(event.currentTarget.value)}
            value={name}
          />
        </Field>
        <Field label={t("agentModel")} required>
          <Select
            onValueChange={setBaseModelId}
            options={enabledModels.map((model) => ({
              group: providerNames.get(model.providerId) ?? model.providerId,
              label: model.displayName,
              value: model.id,
            }))}
            value={baseModelId}
          />
        </Field>
        <Field label={t("agentSystemPrompt")} required>
          <Textarea
            onChange={(event) => setSystemPrompt(event.currentTarget.value)}
            rows={6}
            value={systemPrompt}
          />
        </Field>
      </div>
    </Dialog>
  );
}
