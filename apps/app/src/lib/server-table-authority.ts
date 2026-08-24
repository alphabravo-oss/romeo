import {
  tableExportsCreate,
  tableExportsDelete,
  tableExportsDownloadArtifact,
  tableViewsRestore,
  tableViewsDelete,
  tableViewsReplace,
  tableViewsSetDefault,
  tableViewsShare,
} from "@romeo/api-client/generated/sdk";
import {
  zServerTableSavedView,
  zTableExportJob,
} from "@romeo/api-client/generated/sdk/zod";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";
import type {
  DataTableAuthority,
  ServerTableAuthorityScope,
  TableSavedView,
} from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { downloadText } from "./download";
import { useLocale } from "./i18n";
import {
  inventoriedTableResourceRegistry,
  type InventoriedTableResourceName,
  tableResourceDefinition,
} from "./inventoried-table-resource-registry";
import {
  serverTableExportJobQueryOptions,
  serverTableViewsQueryOptions,
} from "./server-table-authority-query-options";
import {
  readPendingTableExport,
  serverTableExportStorageKey,
  writePendingTableExport,
} from "./server-table-export-storage";

export function useServerTableAuthority(
  scope: ServerTableAuthorityScope | undefined,
  activeWorkspaceId: string | undefined,
): DataTableAuthority | undefined {
  const { t } = useLocale();
  const workspaceId = scope?.workspaceId ?? activeWorkspaceId;
  const resource = isResource(scope?.resource) ? scope.resource : undefined;
  const definition = resource ? tableResourceDefinition(resource) : undefined;
  const enabled =
    scope !== undefined &&
    workspaceId !== undefined &&
    resource !== undefined &&
    definition?.capabilities.savedViews === true;
  const query = useQuery(
    serverTableViewsQueryOptions(
      workspaceId,
      resource,
      scope?.parentId,
      enabled,
    ),
  );
  const exportStorageKey =
    scope === undefined || workspaceId === undefined || resource === undefined
      ? undefined
      : serverTableExportStorageKey({
          workspaceId,
          resource,
          ...(scope.parentId === undefined ? {} : { parentId: scope.parentId }),
        });
  const [pendingExport, setPendingExport] = useState<{
    jobId?: string;
    storageKey?: string;
  }>(() => pendingExportState(exportStorageKey));
  const [exportFailure, setExportFailure] = useState<string>();
  const claimedDownloads = useRef(new Set<string>());
  const pendingJobId =
    pendingExport.storageKey === exportStorageKey
      ? pendingExport.jobId
      : undefined;
  const exportQuery = useQuery(
    serverTableExportJobQueryOptions(
      pendingJobId,
      enabled && definition?.capabilities.export === true,
    ),
  );

  useEffect(() => {
    setExportFailure(undefined);
    setPendingExport(pendingExportState(exportStorageKey));
  }, [exportStorageKey]);

  useEffect(() => {
    const job = exportQuery.data;
    if (
      pendingJobId === undefined ||
      exportStorageKey === undefined ||
      job === undefined
    )
      return;
    if (job.state === "failed" || job.state === "expired") {
      writePendingTableExport(exportStorageKey, undefined);
      setPendingExport((current) =>
        current.storageKey === exportStorageKey &&
        current.jobId === pendingJobId
          ? { storageKey: exportStorageKey }
          : current,
      );
      setExportFailure(
        job.state === "expired"
          ? t("tableExportExpired")
          : t("tableExportFailed"),
      );
      return;
    }
    if (
      job.state !== "artifact_ready" ||
      claimedDownloads.current.has(pendingJobId)
    )
      return;
    claimedDownloads.current.add(pendingJobId);
    void downloadCompletedExport({
      jobId: pendingJobId,
      resource: resource!,
    })
      .then(() => {
        writePendingTableExport(exportStorageKey, undefined);
        setPendingExport((current) =>
          current.storageKey === exportStorageKey &&
          current.jobId === pendingJobId
            ? { storageKey: exportStorageKey }
            : current,
        );
      })
      .catch(() => {
        setExportFailure(t("tableExportDownloadFailed"));
      });
  }, [exportQuery.data, exportStorageKey, pendingJobId, resource, t]);

  return useMemo(() => {
    if (scope === undefined || definition === undefined) return undefined;
    if (workspaceId === undefined) {
      return unavailableAuthority(t("tableWorkspaceRequired"));
    }
    if (!definition.capabilities.savedViews) return undefined;
    const refresh = () => query.refetch().then(() => undefined);
    const mutationScope = {
      workspaceId,
      resource: resource!,
      ...(scope.parentId === undefined ? {} : { parentId: scope.parentId }),
    };
    const savedViews = (query.data ?? []).map((view) =>
      toTableSavedView(view, definition.sortFieldByColumnId),
    );
    const statusMessage =
      exportFailure === undefined
        ? exportStatusMessage(exportQuery.data, t)
        : undefined;
    return {
      mode: "server",
      status:
        query.isError || exportQuery.isError || exportFailure !== undefined
          ? "error"
          : query.data === undefined
            ? "loading"
            : "ready",
      ...(query.isError || exportQuery.isError || exportFailure !== undefined
        ? {
            error:
              exportFailure ??
              (exportQuery.isError
                ? t("tableExportFailed")
                : t("tableServerAuthorityUnavailable")),
          }
        : {}),
      pending:
        exportFailure === undefined &&
        pendingJobId !== undefined &&
        (exportQuery.data === undefined ||
          exportQuery.data.state === "queued" ||
          exportQuery.data.state === "running" ||
          exportQuery.data.state === "artifact_ready"),
      ...(statusMessage === undefined ? {} : { statusMessage }),
      savedViews,
      saveView: async (view) => {
        configureBrowserApiClients();
        await tableViewsReplace({
          body: {
            ...mutationScope,
            name: view.name,
            ...(view.globalFilter === ""
              ? {}
              : { globalFilter: view.globalFilter }),
            pageSize: view.pageSize,
            density: view.density,
            columnVisibility: view.columnVisibility,
            sorting: view.sorting,
            filters: view.filters ?? [],
            ...(view.id === undefined ? {} : { viewId: view.id }),
            ...(view.version === undefined
              ? {}
              : { expectedVersion: view.version }),
            ...(view.visibility === undefined
              ? {}
              : { visibility: view.visibility }),
            ...(view.isDefault === undefined
              ? {}
              : { isDefault: view.isDefault }),
          },
          throwOnError: true,
        });
        await refresh();
      },
      deleteView: async (view) => {
        if (view.id === undefined) throw new Error("Server view id is missing");
        configureBrowserApiClients();
        const response = await tableViewsDelete({
          body: {
            ...mutationScope,
            ...(view.version === undefined
              ? {}
              : { expectedVersion: view.version }),
          },
          path: { viewId: view.id },
          throwOnError: true,
        });
        await refresh();
        const receipt = response.data.data;
        if (
          !receipt.deleted ||
          receipt.undoToken === undefined ||
          receipt.version === undefined
        )
          return undefined;
        return {
          restore: async () => {
            configureBrowserApiClients();
            await tableViewsRestore({
              body: {
                ...mutationScope,
                undoToken: receipt.undoToken!,
                expectedVersion: receipt.version!,
              },
              path: { viewId: view.id! },
              throwOnError: true,
            });
            await refresh();
          },
        };
      },
      setDefaultView: async (view, isDefault) => {
        if (view.id === undefined) throw new Error("Server view id is missing");
        configureBrowserApiClients();
        await tableViewsSetDefault({
          body: {
            ...mutationScope,
            isDefault,
            ...(view.version === undefined
              ? {}
              : { expectedVersion: view.version }),
          },
          path: { viewId: view.id },
          throwOnError: true,
        });
        await refresh();
      },
      setViewVisibility: async (view, visibility) => {
        if (view.id === undefined) throw new Error("Server view id is missing");
        configureBrowserApiClients();
        await tableViewsShare({
          body: {
            ...mutationScope,
            visibility,
            ...(view.version === undefined
              ? {}
              : { expectedVersion: view.version }),
          },
          path: { viewId: view.id },
          throwOnError: true,
        });
        await refresh();
      },
      exportView: async (view, estimatedRows) => {
        configureBrowserApiClients();
        const createdResponse = await tableExportsCreate({
          body: {
            ...mutationScope,
            ...(scope.parentId === undefined
              ? {}
              : { parentId: scope.parentId }),
            mode: "async_artifact",
            estimatedRows,
            ...(view.globalFilter.trim() === ""
              ? {}
              : { search: view.globalFilter.trim() }),
            sort: view.sorting.flatMap((sort) => {
              const field = definition.sortFieldByColumnId[sort.id];
              return field === undefined
                ? []
                : [
                    {
                      field,
                      direction: sort.desc
                        ? ("desc" as const)
                        : ("asc" as const),
                    },
                  ];
            }),
            filters: view.filters ?? [],
          },
          throwOnError: true,
        });
        const created = zTableExportJob.parse(createdResponse.data.data);
        if (created.outcome !== "accepted" || created.jobId === undefined)
          throw new Error(created.code ?? "Table export was denied");
        setExportFailure(undefined);
        if (exportStorageKey !== undefined)
          writePendingTableExport(exportStorageKey, created.jobId);
        setPendingExport({
          ...(exportStorageKey === undefined
            ? {}
            : { storageKey: exportStorageKey }),
          jobId: created.jobId,
        });
      },
    };
  }, [
    definition,
    exportFailure,
    exportQuery,
    exportStorageKey,
    pendingJobId,
    query,
    resource,
    scope,
    t,
    workspaceId,
  ]);
}

function pendingExportState(storageKey: string | undefined): {
  jobId?: string;
  storageKey?: string;
} {
  if (storageKey === undefined) return {};
  const jobId = readPendingTableExport(storageKey);
  return {
    storageKey,
    ...(jobId === undefined ? {} : { jobId }),
  };
}

async function downloadCompletedExport(input: {
  jobId: string;
  resource: string;
}) {
  configureBrowserApiClients();
  const artifact = await tableExportsDownloadArtifact({
    path: { jobId: input.jobId },
    throwOnError: true,
  });
  if (
    typeof artifact.data !== "string" ||
    !downloadText(
      artifact.data,
      `romeo-${input.resource}-${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv;charset=utf-8",
    )
  )
    throw new Error("table_export_download_failed");
  await tableExportsDelete({
    path: { jobId: input.jobId },
    throwOnError: true,
  });
}

function exportStatusMessage(
  job: ReturnType<typeof zTableExportJob.parse> | undefined,
  t: ReturnType<typeof useLocale>["t"],
) {
  if (job?.state === "queued") return t("tableExportQueued");
  if (job?.state === "running")
    return t("tableExportProgress", { percent: job.percent ?? 0 });
  if (job?.state === "artifact_ready") return t("tableExportDownloading");
  return undefined;
}

function toTableSavedView(
  view: ReturnType<typeof zServerTableSavedView.parse>,
  sortFieldByColumnId: Readonly<Record<string, string>>,
): TableSavedView {
  const columnIdByField = new Map(
    Object.entries(sortFieldByColumnId).map(([columnId, field]) => [
      field,
      columnId,
    ]),
  );
  return {
    id: view.id,
    canEdit: view.canEdit,
    columnVisibility: view.presentation.columnVisibility,
    density: view.presentation.density,
    filters: view.query.filters,
    globalFilter: view.query.search ?? "",
    isDefault: view.isDefault,
    name: view.name,
    pageSize: view.query.pageSize,
    schemaVersion: view.schemaVersion,
    source: view.source,
    sorting: view.query.sort.flatMap((sort) => {
      const id = columnIdByField.get(sort.field);
      return id === undefined ? [] : [{ id, desc: sort.direction === "desc" }];
    }),
    visibility: view.visibility,
    version: view.version,
  };
}

function unavailableAuthority(error: string): DataTableAuthority {
  const unavailable = async () => {
    throw new Error(error);
  };
  return {
    mode: "server",
    status: "error",
    error,
    savedViews: [],
    saveView: unavailable,
    deleteView: unavailable,
    setDefaultView: unavailable,
    setViewVisibility: unavailable,
    exportView: unavailable,
  };
}

function isResource(
  value: string | undefined,
): value is InventoriedTableResourceName {
  return value !== undefined && value in inventoriedTableResourceRegistry;
}
