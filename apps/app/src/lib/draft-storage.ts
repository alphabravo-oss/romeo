const draftPrefix = "romeo:draft:v2:";
const legacyDraftPrefix = "romeo:draft:";
const draftTtlMs = 24 * 60 * 60 * 1_000;

interface StoredDraft {
  expiresAt: number;
  value: string;
}

export interface WorkspaceDraftState {
  key?: string;
  value: string;
}

export function workspaceDraftKey(input: {
  chatId?: string;
  subjectId?: string;
  workspaceId?: string;
}): string | undefined {
  if (input.subjectId === undefined || input.workspaceId === undefined)
    return undefined;
  const target =
    input.chatId === undefined
      ? "new"
      : `chat:${encodeURIComponent(input.chatId)}`;
  return `${draftPrefix}${encodeURIComponent(input.subjectId)}:${encodeURIComponent(input.workspaceId)}:${target}`;
}

/**
 * A keyed state prevents the previous chat's value from being shown or saved
 * during the render before the new key's load effect runs.
 */
export function visibleWorkspaceDraft(
  state: WorkspaceDraftState,
  key: string | undefined,
): string {
  return key !== undefined && state.key === key ? state.value : "";
}

export function readWorkspaceDraft(
  storage: Storage | undefined,
  key: string,
  now = Date.now(),
): string {
  if (storage === undefined) return "";
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return "";
  }
  if (raw === null) return "";
  try {
    const stored = JSON.parse(raw) as Partial<StoredDraft>;
    if (
      typeof stored.value !== "string" ||
      typeof stored.expiresAt !== "number" ||
      !Number.isFinite(stored.expiresAt) ||
      stored.expiresAt <= now
    ) {
      safelyRemove(storage, key);
      return "";
    }
    return stored.value;
  } catch {
    safelyRemove(storage, key);
    return "";
  }
}

export function writeWorkspaceDraft(
  storage: Storage | undefined,
  key: string,
  value: string,
  now = Date.now(),
): void {
  if (storage === undefined) return;
  if (value.length === 0) {
    safelyRemove(storage, key);
    return;
  }
  const stored: StoredDraft = { expiresAt: now + draftTtlMs, value };
  try {
    storage.setItem(key, JSON.stringify(stored));
  } catch {
    // Storage can be disabled, full, or blocked by browser privacy policy.
    // Draft persistence is optional and must never break the composer.
  }
}

export function purgeWorkspaceDrafts(storage: Storage | undefined): void {
  purgeStoragePrefix(storage, draftPrefix);
}

/** Discard v1 localStorage drafts rather than exposing them to a new subject. */
export function purgeLegacyWorkspaceDrafts(storage: Storage | undefined): void {
  purgeStoragePrefix(storage, legacyDraftPrefix);
}

export function browserSessionStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function browserLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Best-effort cleanup used when the current browser session ends. */
export function purgeBrowserWorkspaceDrafts(): void {
  purgeWorkspaceDrafts(browserSessionStorage());
  purgeLegacyWorkspaceDrafts(browserLocalStorage());
}

function purgeStoragePrefix(
  storage: Storage | undefined,
  prefix: string,
): void {
  if (storage === undefined) return;
  let keys: Array<string | null>;
  try {
    keys = Array.from({ length: storage.length }, (_, index) =>
      storage.key(index),
    );
  } catch {
    return;
  }
  for (const key of keys) {
    if (key?.startsWith(prefix) === true) safelyRemove(storage, key);
  }
}

function safelyRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // See writeWorkspaceDraft: cleanup is best effort under blocked storage.
  }
}
