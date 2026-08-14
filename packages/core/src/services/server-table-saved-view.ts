export const SAVED_VIEW_SCHEMA = "romeo.server-table-saved-view.v2";

export interface LocalSavedViewV1 {
  name: string;
  globalFilter?: string;
  pageSize?: number;
  density?: "comfortable" | "compact";
  columnVisibility?: Record<string, boolean>;
  sorting?: Array<{ id: string; desc: boolean }>;
}

export interface ServerTableSavedView {
  schema: typeof SAVED_VIEW_SCHEMA;
  id: string;
  orgId: string;
  workspaceId: string;
  ownerUserId: string;
  resource: string;
  name: string;
  query: {
    sort: Array<{ field: string; direction: "asc" | "desc" }>;
    filters: Array<{ field: string; operator: string }>;
    search?: string;
    pageSize: number;
  };
  presentation: {
    columnVisibility: Record<string, boolean>;
    density: "comfortable" | "compact";
  };
  source: "server" | "local_fallback";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function migrateLocalSavedView(input: {
  local: LocalSavedViewV1;
  orgId: string;
  workspaceId: string;
  ownerUserId: string;
  resource: string;
  allowedFields: ReadonlySet<string>;
  now: string;
}): ServerTableSavedView | { outcome: "rejected"; code: "saved_view_invalid" } {
  const name = input.local.name.trim().slice(0, 80);
  if (name.length === 0) return { outcome: "rejected", code: "saved_view_invalid" };
  const search = normalizeSavedSearch(input.local.globalFilter);
  if (search === "rejected")
    return { outcome: "rejected", code: "saved_view_invalid" };
  const pageSize = [10, 25, 50, 100].includes(input.local.pageSize ?? 25)
    ? (input.local.pageSize ?? 25)
    : 25;
  return {
    schema: SAVED_VIEW_SCHEMA,
    id: `saved_view_local_${input.resource}_${slug(name)}`,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    resource: input.resource,
    name,
    query: {
      sort: (input.local.sorting ?? []).flatMap((sort) =>
        input.allowedFields.has(sort.id)
          ? [
              {
                field: sort.id,
                direction: sort.desc ? ("desc" as const) : ("asc" as const),
              },
            ]
          : [],
      ),
      filters: [],
      ...(search === undefined ? {} : { search }),
      pageSize,
    },
    presentation: {
      columnVisibility: Object.fromEntries(
        Object.entries(input.local.columnVisibility ?? {}).filter(
          ([field, visible]) =>
            input.allowedFields.has(field) && typeof visible === "boolean",
        ),
      ),
      density:
        input.local.density === "compact" ? "compact" : "comfortable",
    },
    source: "local_fallback",
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function mergeSavedViews(input: {
  server: ServerTableSavedView[];
  localFallback: ServerTableSavedView[];
}): ServerTableSavedView[] {
  const byName = new Map<string, ServerTableSavedView>();
  for (const view of input.localFallback) byName.set(view.name, view);
  for (const view of input.server) byName.set(view.name, view);
  return [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function normalizeSavedSearch(value: string | undefined): string | undefined | "rejected" {
  if (value === undefined) return undefined;
  const search = value.trim().slice(0, 300);
  if (search.length === 0) return undefined;
  if (/(api[_-]?key|bearer\s|secret|password|token=)/i.test(search))
    return "rejected";
  return search;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
