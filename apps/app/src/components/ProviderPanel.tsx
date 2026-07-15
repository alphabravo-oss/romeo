import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { toast } from "../lib/toast";
import type {
  Provider,
  ProviderKind,
  ProviderOperationalSummary,
} from "../api/types";
import { FormDialog } from "./FormDialog";
import { PanelStats } from "./PanelStats";

export function ProviderPanel({
  isCreating,
  syncingProviderId,
  onCreateProvider,
  onSyncProvider,
  operationalSummary,
  providers,
}: {
  isCreating: boolean;
  syncingProviderId: string | undefined;
  onCreateProvider: (input: {
    type: ProviderKind;
    name: string;
    baseUrl: string;
  }) => void;
  onSyncProvider: (providerId: string) => void;
  operationalSummary: ProviderOperationalSummary | undefined;
  providers: Provider[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const form = useForm({
    defaultValues: {
      type: "openai-compatible" as ProviderKind,
      name: "",
      baseUrl: "",
    },
    onSubmit: async ({ value }) => {
      try {
        onCreateProvider({
          type: value.type,
          name: value.name,
          baseUrl: value.baseUrl,
        });
        toast("Provider added", "success");
        setAddOpen(false);
      } catch {
        toast("Could not add provider", "error");
      }
    },
  });

  function handleSync(providerId: string) {
    try {
      onSyncProvider(providerId);
      toast("Provider synced", "success");
    } catch {
      toast("Could not sync provider", "error");
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="rm-card-title">Providers</div>
        <button
          className="rm-button primary"
          onClick={() => setAddOpen(true)}
          type="button"
        >
          + Add provider
        </button>
      </div>
      {operationalSummary !== undefined && (
        <div className="mb-3 grid gap-2 rounded-md border border-border p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Operational state</span>
            <span className="font-medium">{operationalSummary.status}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-muted">Alerts</div>
              <div className="font-medium">
                {operationalSummary.alerts.length}
              </div>
            </div>
            <div>
              <div className="text-muted">Fallback</div>
              <div className="font-medium">
                {fallbackLabel(operationalSummary)}
              </div>
            </div>
            <div>
              <div className="text-muted">Kill switches</div>
              <div className="font-medium">
                {operationalSummary.policy.disabledProviderIds.length}
              </div>
            </div>
          </div>
          {operationalSummary.alerts.length > 0 && (
            <div className="grid gap-1">
              {operationalSummary.alerts.slice(0, 3).map((alert) => (
                <div
                  className="flex items-center justify-between gap-2"
                  key={alert.id}
                >
                  <span className="truncate">{alert.code}</span>
                  <span className="text-muted">{alert.severity}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="grid gap-4">
        <PanelStats
          items={[
            { label: "Total providers", value: providers.length },
            {
              label: "Enabled",
              value: providers.filter((provider) => provider.enabled).length,
            },
          ]}
        />
        {providers.length === 0 ? (
          <div className="rm-empty-state">
            <p className="rm-empty-state-text">No providers yet.</p>
            <button
              className="rm-button primary"
              onClick={() => setAddOpen(true)}
              type="button"
            >
              + Add provider
            </button>
          </div>
        ) : (
      <div className="grid gap-2 text-sm">
        {providers.map((provider) => (
          <div
            className="rounded-md border border-border p-3"
            key={provider.id}
          >
            <div className="font-medium">{provider.name}</div>
            <div className="break-words text-muted">{provider.type}</div>
            {operationalSummary?.providers.find(
              (item) => item.providerId === provider.id,
            ) !== undefined && (
              <div className="mt-1 text-xs text-muted">
                {providerStatusLabel(operationalSummary, provider.id)}
              </div>
            )}
            <button
              className="rm-button mt-2"
              disabled={syncingProviderId === provider.id}
              onClick={() => handleSync(provider.id)}
              type="button"
            >
              {syncingProviderId === provider.id ? "Syncing" : "Sync models"}
            </button>
          </div>
        ))}
      </div>
        )}
      </div>
      <FormDialog
        open={addOpen}
        title="New provider"
        onClose={() => setAddOpen(false)}
      >
      <form
        className="mt-4 grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <label className="text-sm text-muted" htmlFor="provider-type">
          Type
        </label>
        <form.Field name="type">
          {(field) => (
            <select
              className="rm-input"
              id="provider-type"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value as ProviderKind)
              }
              value={field.state.value}
            >
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="openai-responses-compatible">
                OpenAI Responses-compatible
              </option>
              <option value="ollama">Ollama</option>
            </select>
          )}
        </form.Field>
        <label className="text-sm text-muted" htmlFor="provider-name">
          Name
        </label>
        <form.Field
          name="name"
          validators={{
            onChange: ({ value }: { value: string }) =>
              !value?.trim() ? "Name is required" : undefined,
          }}
        >
          {(field) => (
            <>
              <input
                className="rm-input"
                id="provider-name"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder="OpenAI-compatible"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">
                  {field.state.meta.errors.join(", ")}
                </div>
              ) : null}
            </>
          )}
        </form.Field>
        <label className="text-sm text-muted" htmlFor="provider-url">
          Base URL
        </label>
        <form.Field name="baseUrl">
          {(field) => (
            <input
              className="rm-input"
              id="provider-url"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value)
              }
              placeholder="https://api.openai.com/v1"
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <button
              className="rm-button"
              disabled={isCreating || !canSubmit || isSubmitting}
              type="submit"
            >
              {isCreating ? "Adding" : "Add provider"}
            </button>
          )}
        </form.Subscribe>
      </form>
      </FormDialog>
    </section>
  );
}

function fallbackLabel(summary: ProviderOperationalSummary): string {
  if (!summary.fallback.configured) return "off";
  return summary.fallback.available ? "ready" : "unavailable";
}

function providerStatusLabel(
  summary: ProviderOperationalSummary,
  providerId: string,
): string {
  const provider = summary.providers.find(
    (item) => item.providerId === providerId,
  );
  if (provider === undefined) return "unknown";
  const circuit =
    provider.circuit.state === "closed"
      ? ""
      : `, circuit ${provider.circuit.state}`;
  return `${provider.status}, ${provider.enabledModelCount}/${provider.modelCount} models${circuit}`;
}
