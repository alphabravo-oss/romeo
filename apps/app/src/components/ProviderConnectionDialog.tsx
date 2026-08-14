import { useRef, useState } from "react";
import { Button, Field, InlineError, Input, Select, Textarea } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";

import type { Provider, ProviderKind } from "../features/providers/types";
import { providerKindsQueryOptions } from "../lib/api-query-options";
import { useLocale } from "../lib/i18n";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { FormDialog } from "./FormDialog";
import {
  parseProviderModelIds,
  providerConfigurationField,
  providerFieldCopyKeys,
  providerKindDefinition,
  providerKindOptions,
} from "./provider-connection-catalog";

export interface ProviderFormInput {
  type: ProviderKind;
  name: string;
  baseUrl: string;
  apiKey?: string;
  modelIds?: string[];
}

export function ConnectionDialog({
  busy,
  onClose,
  onSave,
  provider,
}: {
  busy: boolean;
  onClose: () => void;
  onSave: (input: ProviderFormInput) => Promise<void>;
  provider: Provider | undefined;
}) {
  const { t } = useLocale();
  const [type, setType] = useState<ProviderKind>(
    provider?.type ?? "openai-compatible",
  );
  const [name, setName] = useState(provider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [presetId, setPresetId] = useState("");
  const [modelIds, setModelIds] = useState(
    provider?.modelIds?.join("\n") ?? "",
  );
  const [error, setError] = useState<string>();
  const submitting = useRef(false);
  const providerKindsQuery = useQuery(providerKindsQueryOptions());
  const definitions = providerKindsQuery.data ?? [];
  const definition = providerKindDefinition(definitions, type);
  const nameField = providerConfigurationField(definition, "name");
  const baseUrlField = providerConfigurationField(definition, "baseUrl");
  const credentialField = providerConfigurationField(
    definition,
    "credentialRef",
  );
  const modelIdsField = providerConfigurationField(definition, "modelIds");
  const schemaReady =
    nameField !== undefined &&
    baseUrlField !== undefined &&
    credentialField !== undefined &&
    modelIdsField !== undefined;
  const credentialRequired =
    credentialField?.required === true && !provider?.credentialConfigured;
  const typeOptions = providerKindOptions(definitions);

  const presets = [
    {
      id: "ollama",
      label: "Ollama (local)",
      type: "ollama" as const,
      name: "Local Ollama",
      baseUrl: "http://localhost:11434",
    },
    {
      id: "openai",
      label: "OpenAI",
      type: "openai-responses-compatible" as const,
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      id: "anthropic",
      label: "Anthropic",
      type: "anthropic" as const,
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com/v1",
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      type: "openai-compatible" as const,
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
    },
    {
      id: "vllm",
      label: "vLLM / compatible",
      type: "openai-compatible" as const,
      name: "vLLM",
      baseUrl: "http://localhost:8000/v1",
    },
  ];

  return (
    <FormDialog
      open
      title={provider ? t("configureConnection") : t("addConnection")}
      onClose={onClose}
    >
      <form
        className="mt-4 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          setError(undefined);
          const form = new FormData(event.currentTarget);
          const submittedName = formText(form, "name").trim();
          const submittedBaseUrl = formText(form, "baseUrl").trim();
          const submittedApiKey = formText(form, "apiKey").trim();
          if (!schemaReady) {
            setError(t("providerKindsUnavailable"));
            submitting.current = false;
            return;
          }
          const parsedModelIds = parseProviderModelIds(
            formText(form, "modelIds"),
            modelIdsField.maxItems ?? 2_000,
          );
          if (parsedModelIds.exceeded) {
            setError(
              t("providerModelLimitExceeded", {
                max: modelIdsField.maxItems ?? 2_000,
              }),
            );
            submitting.current = false;
            return;
          }
          void onSave({
            type,
            name: submittedName,
            baseUrl: submittedBaseUrl,
            ...(submittedApiKey ? { apiKey: submittedApiKey } : {}),
            modelIds: parsedModelIds.items,
          })
            .catch((caught) =>
              setError(
                safeUserErrorMessage(caught, t("couldNotSaveConnection")),
              ),
            )
            .finally(() => {
              submitting.current = false;
            });
        }}
      >
        {provider === undefined ? (
          <Field id="connection-preset" label={t("quickSetup")}>
            <Select
              name="presetId"
              onValueChange={(value) => {
                setPresetId(value);
                const preset = presets.find((item) => item.id === value);
                if (preset === undefined) return;
                setType(preset.type);
                setName(preset.name);
                setBaseUrl(preset.baseUrl);
              }}
              options={presets
                .filter((preset) =>
                  definitions.some(
                    (definition) => definition.kind === preset.type,
                  ),
                )
                .map((preset) => ({
                  label: preset.label,
                  value: preset.id,
                }))}
              placeholder={t("chooseProviderPreset")}
              value={presetId}
            />
          </Field>
        ) : null}
        <Field id="connection-type" label={t("connectionType")}>
          <Select
            name="type"
            disabled={provider !== undefined || providerKindsQuery.isPending}
            onValueChange={(value) => setType(value as ProviderKind)}
            options={
              typeOptions.length > 0
                ? typeOptions
                : provider === undefined
                  ? []
                  : [{ label: provider.type, value: provider.type }]
            }
            value={type}
          />
        </Field>
        {definition === undefined ? null : (
          <p className="text-sm text-muted" role="status">
            {t("providerDeploymentClassifications", {
              classifications: definition.supportedClassifications
                .map((classification) =>
                  t(
                    classification === "local"
                      ? "providerClassificationLocal"
                      : "providerClassificationExternal",
                  ),
                )
                .join(", "),
            })}
          </p>
        )}
        <Field
          id="connection-name"
          label={t(providerFieldCopyKeys.name)}
          required={nameField?.required === true}
        >
          <Input
            maxLength={nameField?.maxLength}
            name="name"
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="Local Ollama"
            required={nameField?.required === true}
            value={name}
          />
        </Field>
        <Field
          id="connection-url"
          label={t(providerFieldCopyKeys.baseUrl)}
          required={baseUrlField?.required === true}
        >
          <Input
            maxLength={baseUrlField?.maxLength}
            name="baseUrl"
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
            placeholder={
              type === "anthropic"
                ? "https://api.anthropic.com/v1"
                : type === "ollama"
                  ? "http://localhost:11434"
                  : "https://api.openai.com/v1"
            }
            required={baseUrlField?.required === true}
            type="url"
            value={baseUrl}
          />
        </Field>
        <Field
          id="connection-key"
          label={`${t(providerFieldCopyKeys.credentialRef)} ${
            provider?.credentialConfigured
              ? `(${t("keepCurrentCredential")})`
              : credentialRequired
                ? `(${t("providerRequired")})`
                : `(${t("optional")})`
          }`}
          required={credentialRequired}
        >
          <Input
            autoComplete="new-password"
            maxLength={credentialField?.maxLength}
            name="apiKey"
            onChange={(event) => setApiKey(event.currentTarget.value)}
            placeholder={
              provider?.credentialConfigured
                ? t("credentialConfigured")
                : t("encryptedManagedSecret")
            }
            required={credentialRequired}
            type="password"
            value={apiKey}
          />
        </Field>
        <details className="rm-advanced-settings" open={modelIds.length > 0}>
          <summary>{t("advancedModelAccess")}</summary>
          <div className="mt-3 grid gap-2">
            <Field
              description={t("allowedModelsDescription")}
              id="connection-models"
              label={t(providerFieldCopyKeys.modelIds)}
            >
              <Textarea
                maxLength={modelIdsField?.maxLength}
                name="modelIds"
                onChange={(event) => setModelIds(event.currentTarget.value)}
                placeholder={`${t("leaveBlankDiscovery")}\n${
                  type === "ollama"
                    ? "llama3.2:latest\ngemma3:4b"
                    : "gpt-4.1\ngpt-4.1-mini"
                }`}
                rows={5}
                value={modelIds}
              />
            </Field>
          </div>
        </details>
        {providerKindsQuery.isPending ? (
          <p className="text-sm text-muted" role="status">
            {t("providerKindsLoading")}
          </p>
        ) : null}
        {providerKindsQuery.isError ? (
          <InlineError>{t("providerKindsUnavailable")}</InlineError>
        ) : null}
        {error ? <InlineError>{error}</InlineError> : null}
        <Button
          disabled={busy || !schemaReady || !name.trim() || !baseUrl.trim()}
          pending={busy}
          type="submit"
          variant="primary"
        >
          {t("saveConnection")}
        </Button>
      </form>
    </FormDialog>
  );
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
