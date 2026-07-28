import { useRef, useState } from "react";
import { Button, Field, InlineError, Input, Select, Textarea } from "@romeo/ui";

import type { Provider, ProviderKind } from "../features/providers/types";
import { useLocale } from "../lib/i18n";
import { FormDialog } from "./FormDialog";

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
          void onSave({
            type,
            name: submittedName,
            baseUrl: submittedBaseUrl,
            ...(submittedApiKey ? { apiKey: submittedApiKey } : {}),
            modelIds: parseModelIds(formText(form, "modelIds")),
          })
            .catch((caught) =>
              setError(
                caught instanceof Error
                  ? caught.message
                  : t("couldNotSaveConnection"),
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
              options={presets.map((preset) => ({
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
            disabled={provider !== undefined}
            onValueChange={(value) => setType(value as ProviderKind)}
            options={[
              { label: "Anthropic", value: "anthropic" },
              { label: "OpenAI-compatible", value: "openai-compatible" },
              {
                label: "OpenAI Responses-compatible",
                value: "openai-responses-compatible",
              },
              { label: "Ollama", value: "ollama" },
            ]}
            value={type}
          />
        </Field>
        <Field id="connection-name" label={t("name")} required>
          <Input
            name="name"
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="Local Ollama"
            required
            value={name}
          />
        </Field>
        <Field id="connection-url" label={t("apiBaseUrl")} required>
          <Input
            name="baseUrl"
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
            placeholder={
              type === "anthropic"
                ? "https://api.anthropic.com/v1"
                : type === "ollama"
                  ? "http://localhost:11434"
                  : "https://api.openai.com/v1"
            }
            required
            type="url"
            value={baseUrl}
          />
        </Field>
        <Field
          id="connection-key"
          label={`${t("apiKey")} ${
            provider?.credentialConfigured
              ? `(${t("keepCurrentCredential")})`
              : `(${t("optional")})`
          }`}
        >
          <Input
            autoComplete="new-password"
            name="apiKey"
            onChange={(event) => setApiKey(event.currentTarget.value)}
            placeholder={
              provider?.credentialConfigured
                ? t("credentialConfigured")
                : t("encryptedManagedSecret")
            }
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
              label={t("allowedModelIds")}
            >
              <Textarea
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
        {error ? <InlineError>{error}</InlineError> : null}
        <Button
          disabled={busy || !name.trim() || !baseUrl.trim()}
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

function parseModelIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/u)
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
