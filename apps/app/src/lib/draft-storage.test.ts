import { afterEach, describe, expect, it, vi } from "vitest";

import {
  purgeBrowserWorkspaceDrafts,
  purgeLegacyWorkspaceDrafts,
  purgeWorkspaceDrafts,
  readWorkspaceDraft,
  visibleWorkspaceDraft,
  workspaceDraftKey,
  writeWorkspaceDraft,
} from "./draft-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("workspace draft storage", () => {
  it("does not create an unscoped key", () => {
    expect(workspaceDraftKey({ workspaceId: "workspace-a" })).toBeUndefined();
    expect(workspaceDraftKey({ subjectId: "user-a" })).toBeUndefined();
  });

  it("isolates drafts by subject, workspace, and chat", () => {
    const storage = memoryStorage();
    const first = workspaceDraftKey({
      subjectId: "user-a",
      workspaceId: "workspace-a",
      chatId: "chat-a",
    });
    const second = workspaceDraftKey({
      subjectId: "user-b",
      workspaceId: "workspace-a",
      chatId: "chat-a",
    });
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    writeWorkspaceDraft(storage, first!, "private draft", 100);
    expect(readWorkspaceDraft(storage, first!, 101)).toBe("private draft");
    expect(readWorkspaceDraft(storage, second!, 101)).toBe("");
  });

  it("encodes key segments so identifiers cannot collide", () => {
    const first = workspaceDraftKey({
      subjectId: "user:a",
      workspaceId: "workspace/a",
      chatId: "chat:a/b",
    });
    const second = workspaceDraftKey({
      subjectId: "user",
      workspaceId: "a:workspace/a",
      chatId: "chat:a/b",
    });
    expect(first).not.toBe(second);
    expect(first).toContain("user%3Aa:workspace%2Fa:chat:chat%3Aa%2Fb");
  });

  it("hides the previous chat value until the next scoped draft is loaded", () => {
    const first = workspaceDraftKey({
      subjectId: "user-a",
      workspaceId: "workspace-a",
      chatId: "chat-a",
    })!;
    const second = workspaceDraftKey({
      subjectId: "user-a",
      workspaceId: "workspace-a",
      chatId: "chat-b",
    })!;
    const state = { key: first, value: "chat A private draft" };

    expect(visibleWorkspaceDraft(state, first)).toBe("chat A private draft");
    expect(visibleWorkspaceDraft(state, second)).toBe("");
    expect(visibleWorkspaceDraft(state, undefined)).toBe("");
  });

  it("expires and removes stale or malformed drafts", () => {
    const storage = memoryStorage();
    const key = workspaceDraftKey({
      subjectId: "user-a",
      workspaceId: "workspace-a",
    })!;
    writeWorkspaceDraft(storage, key, "draft", 0);
    expect(readWorkspaceDraft(storage, key, 24 * 60 * 60 * 1_000 + 1)).toBe("");
    storage.setItem(key, "not-json");
    expect(readWorkspaceDraft(storage, key)).toBe("");
    expect(storage.getItem(key)).toBeNull();
  });

  it("removes a stored draft when its value is cleared", () => {
    const storage = memoryStorage();
    const key = workspaceDraftKey({
      subjectId: "user-a",
      workspaceId: "workspace-a",
    })!;
    writeWorkspaceDraft(storage, key, "draft");
    writeWorkspaceDraft(storage, key, "");
    expect(storage.getItem(key)).toBeNull();
  });

  it("purges Romeo drafts without removing unrelated session data", () => {
    const storage = memoryStorage();
    const key = workspaceDraftKey({
      subjectId: "user-a",
      workspaceId: "workspace-a",
    })!;
    writeWorkspaceDraft(storage, key, "draft");
    storage.setItem("unrelated", "keep");
    purgeWorkspaceDrafts(storage);
    expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("purges legacy localStorage drafts without removing unrelated data", () => {
    const storage = memoryStorage();
    storage.setItem("romeo:draft:chat-a", "legacy draft");
    storage.setItem("romeo:draft:new:workspace-a", "legacy new draft");
    storage.setItem("unrelated", "keep");

    purgeLegacyWorkspaceDrafts(storage);

    expect(storage.getItem("romeo:draft:chat-a")).toBeNull();
    expect(storage.getItem("romeo:draft:new:workspace-a")).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("purges only the Romeo draft namespace when the browser session ends", () => {
    const sessionStorage = memoryStorage();
    const localStorage = memoryStorage();
    const key = workspaceDraftKey({
      subjectId: "user-a",
      workspaceId: "workspace-a",
    })!;
    writeWorkspaceDraft(sessionStorage, key, "current draft");
    localStorage.setItem("romeo:draft:chat-a", "legacy draft");
    sessionStorage.setItem("unrelated-session", "keep");
    localStorage.setItem("unrelated-local", "keep");
    vi.stubGlobal("window", { localStorage, sessionStorage });

    purgeBrowserWorkspaceDrafts();

    expect(sessionStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem("romeo:draft:chat-a")).toBeNull();
    expect(sessionStorage.getItem("unrelated-session")).toBe("keep");
    expect(localStorage.getItem("unrelated-local")).toBe("keep");
  });

  it("degrades safely when browser storage is unavailable", () => {
    const unavailableStorage = {
      get length(): number {
        throw new DOMException("blocked", "SecurityError");
      },
      clear(): void {
        throw new DOMException("blocked", "SecurityError");
      },
      getItem(): string | null {
        throw new DOMException("blocked", "SecurityError");
      },
      key(): string | null {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem(): void {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem(): void {
        throw new DOMException("blocked", "QuotaExceededError");
      },
    } satisfies Storage;
    const key = workspaceDraftKey({
      subjectId: "user-a",
      workspaceId: "workspace-a",
    })!;

    expect(readWorkspaceDraft(unavailableStorage, key)).toBe("");
    expect(() =>
      writeWorkspaceDraft(unavailableStorage, key, "draft"),
    ).not.toThrow();
    expect(() =>
      writeWorkspaceDraft(unavailableStorage, key, ""),
    ).not.toThrow();
    expect(() => purgeWorkspaceDrafts(unavailableStorage)).not.toThrow();
    expect(() => purgeLegacyWorkspaceDrafts(unavailableStorage)).not.toThrow();
    expect(readWorkspaceDraft(undefined, key)).toBe("");
    expect(() => writeWorkspaceDraft(undefined, key, "draft")).not.toThrow();
  });
});
