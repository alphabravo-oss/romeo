// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  persistCachedLocale,
  readCachedLocale,
  resetLocaleStorageCacheForTests,
  subscribeToStoredLocale,
} from "./locale-storage";

afterEach(() => resetLocaleStorageCacheForTests());

describe("locale storage", () => {
  it("survives blocked reads and quota failures through its memory cache", () => {
    const blocked = {
      getItem: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("quota", "QuotaExceededError");
      }),
    } as unknown as Storage;

    expect(readCachedLocale("fr", blocked)).toBe("fr");
    expect(persistCachedLocale("es", blocked)).toBe(false);
    expect(readCachedLocale("en", blocked)).toBe("es");
  });

  it("rejects invalid stored values and accepts valid cross-tab changes", () => {
    const storage = {
      getItem: vi.fn(() => "de"),
    } as unknown as Storage;
    expect(readCachedLocale("fr", storage)).toBe("fr");

    const onLocale = vi.fn();
    const unsubscribe = subscribeToStoredLocale(onLocale);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "romeo:locale", newValue: "xx" }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "romeo:locale", newValue: "es" }),
    );
    expect(onLocale).toHaveBeenCalledOnce();
    expect(onLocale).toHaveBeenCalledWith("es");
    unsubscribe();
  });

  it("mirrors the preference into the SSR locale cookie", () => {
    expect(persistCachedLocale("fr")).toBe(true);
    expect(document.cookie).toContain("romeo_locale=fr");
  });
});
