import { describe, expect, it, vi } from "vitest";

import {
  awaitCancellableQuery,
  type CancellableQuery,
} from "./cancellable-query";
import { createDatabaseConnection } from "./client";

function cancellableDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const cancel = vi.fn(() => reject(new Error("database query cancelled")));
  const query: CancellableQuery<T> = Object.assign(promise, { cancel });
  return { cancel, query, resolve };
}

describe("awaitCancellableQuery", () => {
  it("returns a completed query without cancelling it", async () => {
    const deferred = cancellableDeferred<string>();
    const controller = new AbortController();
    const result = awaitCancellableQuery(deferred.query, controller.signal);

    deferred.resolve("complete");

    await expect(result).resolves.toBe("complete");
    expect(deferred.cancel).not.toHaveBeenCalled();
  });

  it("cancels an in-flight query and preserves the abort reason", async () => {
    const deferred = cancellableDeferred<string>();
    const controller = new AbortController();
    const result = awaitCancellableQuery(deferred.query, controller.signal);
    const reason = new DOMException("request closed", "AbortError");

    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(deferred.cancel).toHaveBeenCalledOnce();
  });

  it("does not execute or cancel a query when already aborted", async () => {
    const deferred = cancellableDeferred<string>();
    const controller = new AbortController();
    controller.abort();

    await expect(
      awaitCancellableQuery(deferred.query, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(deferred.cancel).not.toHaveBeenCalled();
  });
});

const conformanceDatabaseUrl =
  process.env.ROMEO_POSTGRES_CONFORMANCE_DATABASE_URL;

describe.runIf(conformanceDatabaseUrl !== undefined)(
  "awaitCancellableQuery PostgreSQL",
  () => {
    it("cancels work on the server and leaves the pool usable", async () => {
      const connection = createDatabaseConnection(conformanceDatabaseUrl!);
      try {
        const controller = new AbortController();
        const query = awaitCancellableQuery(
          connection.db.$client`select pg_sleep(10)`,
          controller.signal,
        );
        setTimeout(() => controller.abort(), 25).unref();

        await expect(query).rejects.toMatchObject({ name: "AbortError" });
        await expect(connection.db.$client`select 1 as value`).resolves.toEqual(
          expect.arrayContaining([expect.objectContaining({ value: 1 })]),
        );
      } finally {
        await connection.close();
      }
    });
  },
);
