import { describe, expect, it, vi } from "vitest";

import { BoundedQdrantSdkClientPool } from "./qdrant-sdk-client";

describe("BoundedQdrantSdkClientPool", () => {
  it("reuses a process client without exposing credential material in its key", () => {
    const factory = vi.fn(() => ({
      delete: vi.fn(),
      getCollection: vi.fn(),
      query: vi.fn(),
      scroll: vi.fn(),
      upsert: vi.fn(),
    }));
    const pool = new BoundedQdrantSdkClientPool(factory, 2);
    const first = pool.client({
      apiKey: "tenant-a-secret",
      timeoutMs: 1_000,
      url: "https://qdrant.test",
    });
    const same = pool.client({
      apiKey: "tenant-a-secret",
      timeoutMs: 1_000,
      url: "https://qdrant.test",
    });
    const rotated = pool.client({
      apiKey: "tenant-a-secret-rotated",
      timeoutMs: 1_000,
      url: "https://qdrant.test",
    });

    expect(same).toBe(first);
    expect(rotated).not.toBe(first);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("bounds tenant and rotation cardinality with LRU eviction", () => {
    const factory = vi.fn(() => ({
      delete: vi.fn(),
      getCollection: vi.fn(),
      query: vi.fn(),
      scroll: vi.fn(),
      upsert: vi.fn(),
    }));
    const pool = new BoundedQdrantSdkClientPool(factory, 2);
    const client = (apiKey: string) =>
      pool.client({ apiKey, timeoutMs: 1_000, url: "https://qdrant.test" });
    client("tenant-a");
    client("tenant-b");
    client("tenant-a");
    client("tenant-c");
    client("tenant-b");

    expect(factory).toHaveBeenCalledTimes(4);
  });

  it("closes idempotently and rejects post-shutdown use", () => {
    const pool = new BoundedQdrantSdkClientPool(() => ({
      delete: vi.fn(),
      getCollection: vi.fn(),
      query: vi.fn(),
      scroll: vi.fn(),
      upsert: vi.fn(),
    }));
    pool.close();
    pool.close();

    expect(() =>
      pool.client({
        apiKey: "post-shutdown",
        timeoutMs: 1_000,
        url: "https://qdrant.test",
      }),
    ).toThrow("qdrant_client_pool_closed");
  });
});
