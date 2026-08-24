const storagePrefix = "romeo:table-export-job:v1:";

export function serverTableExportStorageKey(input: {
  parentId?: string;
  resource: string;
  workspaceId: string;
}): string {
  return `${storagePrefix}${encodeURIComponent(
    [input.workspaceId, input.resource, input.parentId ?? ""].join("\0"),
  )}`;
}

export function readPendingTableExport(
  key: string,
  storage = browserStorage(),
): string | undefined {
  if (storage === undefined) return undefined;
  try {
    const value = storage.getItem(key);
    return value !== null && /^[a-zA-Z0-9_.:-]{1,300}$/u.test(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function writePendingTableExport(
  key: string,
  jobId: string | undefined,
  storage = browserStorage(),
): boolean {
  if (storage === undefined) return false;
  try {
    if (jobId === undefined) storage.removeItem(key);
    else storage.setItem(key, jobId);
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
