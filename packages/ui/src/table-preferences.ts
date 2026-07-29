export type TableDensity = "comfortable" | "compact";

export interface TablePreferences {
  columnVisibility: Record<string, boolean>;
  density: TableDensity;
  pageSize: number;
}

interface StoredTablePreferences extends TablePreferences {
  version: 1;
}

export interface TablePreferenceStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export const tablePageSizes = [10, 25, 50, 100] as const;
const storagePrefix = "romeo:table-view:v1:";

export function defaultTablePreferences(pageSize = 25): TablePreferences {
  return {
    columnVisibility: {},
    density: "comfortable",
    pageSize: normalizePageSize(pageSize, 25),
  };
}

export function tablePreferenceIdentity(
  columnIds: readonly string[],
  route: { pathname: string; search: string } | undefined = browserRoute(),
): string {
  const params = new URLSearchParams(route?.search ?? "");
  const routeContext = ["section", "tab", "view"]
    .flatMap((key) => {
      const value = params.get(key);
      return value ? [`${key}=${value}`] : [];
    })
    .join("&");
  const locationPart = `${route?.pathname ?? "ssr"}?${routeContext}`;
  return `${locationPart}|${columnIds.join(",")}`;
}

export function tablePreferenceStorageKey(identity: string): string {
  return `${storagePrefix}${encodeURIComponent(identity)}`;
}

export function readTablePreferences(
  key: string,
  validColumnIds: ReadonlySet<string>,
  fallbackPageSize = 25,
  storage = browserStorage(),
): TablePreferences {
  const fallback = defaultTablePreferences(fallbackPageSize);
  if (storage === undefined) return fallback;

  try {
    const raw = storage.getItem(tablePreferenceStorageKey(key));
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1) return fallback;

    const density =
      parsed.density === "compact" || parsed.density === "comfortable"
        ? parsed.density
        : fallback.density;
    const pageSize = normalizePageSize(parsed.pageSize, fallback.pageSize);
    const columnVisibility = isRecord(parsed.columnVisibility)
      ? Object.fromEntries(
          Object.entries(parsed.columnVisibility).filter(
            (entry): entry is [string, boolean] =>
              validColumnIds.has(entry[0]) && typeof entry[1] === "boolean",
          ),
        )
      : {};
    return { columnVisibility, density, pageSize };
  } catch {
    return fallback;
  }
}

export function writeTablePreferences(
  key: string,
  preferences: TablePreferences,
  storage = browserStorage(),
): void {
  if (storage === undefined) return;
  const value: StoredTablePreferences = { version: 1, ...preferences };
  try {
    storage.setItem(tablePreferenceStorageKey(key), JSON.stringify(value));
  } catch {
    // Private browsing and storage quotas must never break table rendering.
  }
}

export function removeTablePreferences(
  key: string,
  storage = browserStorage(),
): void {
  try {
    storage?.removeItem(tablePreferenceStorageKey(key));
  } catch {
    // Storage can be blocked by policy; resetting the in-memory state is enough.
  }
}

function normalizePageSize(value: unknown, fallback: number): number {
  return typeof value === "number" &&
    (tablePageSizes as readonly number[]).includes(value)
    ? value
    : fallback;
}

function browserRoute(): { pathname: string; search: string } | undefined {
  return typeof location === "undefined"
    ? undefined
    : { pathname: location.pathname, search: location.search };
}

function browserStorage(): TablePreferenceStorage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
