import { QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRomeoQueryClient } from "../lib/query-client";
import {
  auditLogTableQueryOptions,
  buildAuditExportFilter,
  buildAuditTableRequest,
  isInvalidAuditCursorError,
} from "./audit-table-query";

const bounds = {
  from: new Date("2026-08-01T00:00:00.000Z"),
  to: new Date("2026-08-14T00:00:00.000Z"),
};

afterEach(() => vi.unstubAllGlobals());

describe("audit server table query", () => {
  it("maps equivalent table and CSV filters to their respective contracts", () => {
    const input = {
      bounds,
      category: "security" as const,
      includeNoise: true,
      outcome: "failure" as const,
      search: "  credential rotated  ",
    };
    const table = buildAuditTableRequest({
      ...input,
      cursor: "opaque-cursor",
      pageSize: 100,
      sortDirection: "asc",
    });
    const csv = buildAuditExportFilter(input);

    expect(table).toMatchObject({
      cursor: "opaque-cursor",
      limit: 100,
      search: "credential rotated",
      sort: [{ field: "createdAt", direction: "asc" }],
    });
    expect(table.filters).toEqual(
      expect.arrayContaining([
        { field: "category", operator: "eq", value: "security" },
        { field: "outcome", operator: "eq", value: "failure" },
        { field: "includeNoise", operator: "eq", value: true },
        {
          field: "createdAt",
          operator: "gte",
          value: bounds.from.toISOString(),
        },
      ]),
    );
    expect(csv).toEqual({
      category: "security",
      from: bounds.from.toISOString(),
      includeNoise: "true",
      outcome: "failure",
      q: "credential rotated",
      to: bounds.to.toISOString(),
    });
  });

  it("classifies only the stable cursor error code for automatic recovery", () => {
    expect(
      isInvalidAuditCursorError(
        new RomeoApiError("untrusted server text", 400, {
          error: {
            code: "invalid_page_cursor",
            message: "untrusted server text",
            request_id: "request-1",
          },
        }),
      ),
    ).toBe(true);
    expect(isInvalidAuditCursorError(new Error("invalid cursor"))).toBe(false);
  });

  it("does not send one- or two-character searches to table or CSV APIs", () => {
    const input = {
      bounds,
      category: "" as const,
      includeNoise: false,
      outcome: "" as const,
      search: " ab ",
    };
    const table = buildAuditTableRequest({
      ...input,
      pageSize: 50,
      sortDirection: "desc",
    });

    expect(table).not.toHaveProperty("search");
    expect(buildAuditExportFilter(input)).not.toHaveProperty("q");
  });

  it("aborts a superseded debounced query without retrying or committing it", async () => {
    let firstSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      const body = JSON.parse(String(init?.body)) as { search?: string };
      if (body.search === "first") {
        firstSignal = init?.signal ?? undefined;
        markStarted();
        return new Promise<Response>((_resolve, reject) => {
          firstSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return Promise.resolve(
        Response.json({
          data: {
            applied: { filters: [], sort: [] },
            items: [],
            page: {
              limit: 50,
              nextCursor: null,
              previousCursor: null,
            },
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const first = auditLogTableQueryOptions(
      buildAuditTableRequest({
        bounds,
        category: "",
        includeNoise: false,
        outcome: "",
        pageSize: 50,
        search: "first",
        sortDirection: "desc",
      }),
    );
    const second = auditLogTableQueryOptions(
      buildAuditTableRequest({
        bounds,
        category: "",
        includeNoise: false,
        outcome: "",
        pageSize: 50,
        search: "second",
        sortDirection: "desc",
      }),
    );
    const queryClient = createRomeoQueryClient();
    const observer = new QueryObserver(queryClient, first);
    let resolveSecond!: () => void;
    const secondCompleted = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    const unsubscribe = observer.subscribe((result) => {
      if (result.status === "success") resolveSecond();
    });

    await started;
    observer.setOptions(second);
    await secondCompleted;

    expect(firstSignal?.aborted).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([, init]) =>
        String(init?.body).includes('"search":"first"'),
      ),
    ).toHaveLength(1);
    expect(queryClient.getQueryData(first.queryKey)).toBeUndefined();
    expect(queryClient.getQueryData(second.queryKey)).toMatchObject({
      items: [],
    });
    unsubscribe();
    queryClient.clear();
  });
});
import { RomeoApiError } from "@romeo/api-client";
