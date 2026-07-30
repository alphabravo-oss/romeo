import { Button, IconButton, StatusBadge, Switch } from "@romeo/ui";
import { Link } from "@tanstack/react-router";
import Pencil from "lucide-react/dist/esm/icons/pencil.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import { useMemo } from "react";

import type { Agent } from "../features/managed-models/types";
import type { BaseModel, Provider } from "../features/providers/types";
import { useLocale } from "../lib/i18n";
import { LocalizedTokens } from "../lib/locale-format";
import { createColumnHelper, DataTable } from "./DataTable";

const modelColumn = createColumnHelper<BaseModel>();

export function ProviderModelsTable({
  deletingModelId,
  dependentAgents,
  isUpdating,
  models,
  onDeleteModel,
  onToggleModel,
  provider,
}: {
  deletingModelId: string | undefined;
  dependentAgents: Agent[];
  isUpdating: boolean;
  models: BaseModel[];
  onDeleteModel: (providerId: string, model: BaseModel) => Promise<void>;
  onToggleModel: (model: BaseModel, enabled: boolean) => Promise<void>;
  provider: Provider;
}) {
  const { t } = useLocale();
  const columns = useMemo(
    () => [
      modelColumn.accessor("displayName", {
        header: t("models"),
        cell: ({ row }) => (
          <Link
            className="block min-w-0 hover:underline"
            search={{
              model: row.original.id,
              provider: provider.id,
              section: "providers",
              view: "base-models",
            }}
            to="/admin"
          >
            <strong className="block truncate">
              {row.original.displayName}
            </strong>
            <small className="block truncate font-mono text-muted">
              {row.original.name}
            </small>
          </Link>
        ),
      }),
      modelColumn.accessor((model) => (model.available === false ? 0 : 1), {
        id: "availability",
        header: t("availability"),
        cell: ({ row }) => (
          <StatusBadge
            tone={row.original.available === false ? "danger" : "success"}
          >
            {row.original.available === false
              ? t("unavailable")
              : t("available")}
          </StatusBadge>
        ),
      }),
      modelColumn.accessor("contextWindow", {
        header: t("context"),
        cell: ({ getValue }) => <LocalizedTokens value={getValue()} />,
      }),
      modelColumn.accessor(
        (model) =>
          [
            model.capabilities.toolCalling ? t("tools") : undefined,
            model.capabilities.vision ? t("vision") : undefined,
            model.capabilities.reasoning ? t("reasoning") : undefined,
            model.capabilities.imageGeneration
              ? t("imageGeneration")
              : undefined,
          ]
            .filter(Boolean)
            .join(", ") || t("chat"),
        {
          id: "capabilities",
          header: t("capabilities"),
          enableSorting: false,
          cell: ({ getValue }) => (
            <span className="text-xs text-muted">{getValue()}</span>
          ),
        },
      ),
      modelColumn.accessor(
        (model) =>
          dependentAgents.filter((agent) => agent.baseModelId === model.id)
            .length,
        {
          id: "dependents",
          header: t("modelDependentAssistants"),
        },
      ),
      modelColumn.accessor("enabled", {
        header: t("enabled"),
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={isUpdating}
            label={t("enabled")}
            onCheckedChange={(checked) =>
              void onToggleModel(row.original, checked === true)
            }
          />
        ),
      }),
      modelColumn.display({
        id: "actions",
        header: t("managedModelActions"),
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button asChild size="sm" variant="ghost">
              <Link
                search={{
                  model: row.original.id,
                  provider: provider.id,
                  section: "providers",
                  view: "base-models",
                }}
                to="/admin"
              >
                <Pencil aria-hidden size={14} />
                {t("configure")}
              </Link>
            </Button>
            {provider.type === "ollama" ? (
              <IconButton
                aria-label={`${t("deleteOllamaModel")} ${row.original.name}`}
                disabled={deletingModelId === row.original.id}
                onClick={() => void onDeleteModel(provider.id, row.original)}
                size="sm"
                variant="ghost"
              >
                <Trash2 aria-hidden size={14} />
              </IconButton>
            ) : null}
          </div>
        ),
        enableHiding: false,
        enableSorting: false,
      }),
    ],
    [
      deletingModelId,
      dependentAgents,
      isUpdating,
      onDeleteModel,
      onToggleModel,
      provider,
      t,
    ],
  );

  return (
    <DataTable
      columns={columns}
      data={models}
      getRowId={(model) => model.id}
      minTableWidth={920}
      preferenceKey={`provider-models-${provider.id}`}
      searchVisibility="always"
    />
  );
}
