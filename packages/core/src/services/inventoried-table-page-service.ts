import { assertScope, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import {
  nativeInventoriedTableResources,
  type NativeInventoriedTableResource,
} from "../domain/inventoried-table-repository";
import { ApiError, notFound } from "../errors";
import {
  normalizeInventoriedTableQuery,
  pageInventoriedTable,
  type InventoriedTableFilter,
  type InventoriedTablePageResult,
  type InventoriedTableQuery,
  type InventoriedTableRow,
} from "./inventoried-table-page";
import {
  inventoriedTableResource,
  type InventoriedTableResource,
} from "./inventoried-table-resources";
import {
  createPageCursorCodec,
  derivePageCursorSecret,
  InvalidPageCursorError,
  type PageCursorCodec,
} from "./page-cursor";

const defaultTableCursorSecret =
  "romeo-development-table-page-cursor-secret-v1";

export interface InventoriedTablePageRequest extends InventoriedTableQuery {
  parentId?: string;
  resource: string;
  snapshotAt?: string;
  workspaceId?: string;
}

export interface InventoriedTablePage extends InventoriedTablePageResult {
  resource: string;
  summary?: Record<string, number>;
}

export class InventoriedTablePageService {
  private readonly pageCursor: PageCursorCodec;

  constructor(
    private readonly repository: RomeoRepository,
    options: { cursorSecrets?: readonly [string, ...string[]] } = {},
  ) {
    this.pageCursor = createPageCursorCodec({
      maxAgeSeconds: 24 * 60 * 60,
      resource: "inventoried_tables",
      secrets: options.cursorSecrets ?? [defaultTableCursorSecret],
    });
  }

  async query(
    subject: AuthSubject,
    request: InventoriedTablePageRequest,
  ): Promise<InventoriedTablePage> {
    const resource = inventoriedTableResource(request.resource);
    if (resource === undefined) throw notFound("Table resource");
    assertScope(subject, resource.scope);
    const parentId = request.parentId?.trim();
    const workspaceId = request.workspaceId?.trim();
    if (
      resource.requiresParent &&
      (parentId === undefined || parentId.length === 0)
    ) {
      return emptyPage(resource, request);
    }
    if (
      resource.requiresWorkspace &&
      (workspaceId === undefined || workspaceId.length === 0)
    ) {
      return emptyPage(resource, request);
    }
    if (resource.nativePagination === true) {
      return this.queryNativePage(
        subject,
        resource,
        request,
        parentId,
        workspaceId,
      );
    }
    if (resource.load === undefined)
      throw new Error("inventoried_table_resource_strategy_missing");
    const loaded = await resource.load({
      repository: this.repository,
      subject,
      ...(parentId === undefined || parentId.length === 0 ? {} : { parentId }),
      ...(workspaceId === undefined || workspaceId.length === 0
        ? {}
        : { workspaceId }),
    });
    const page = pageInventoriedTable({
      codec: this.pageCursor,
      policy: resource.policy,
      query: request,
      rows: loaded,
      tenant: {
        orgId: subject.orgId,
        ...(parentId === undefined || parentId.length === 0
          ? {}
          : { parentId }),
        ...(workspaceId === undefined || workspaceId.length === 0
          ? {}
          : { workspaceId }),
      },
    });
    const summary = resource.summarize?.(loaded);
    return {
      ...page,
      resource: resource.id,
      ...(summary === undefined ? {} : { summary }),
    };
  }

  private async queryNativePage(
    subject: AuthSubject,
    resource: InventoriedTableResource,
    request: InventoriedTablePageRequest,
    parentId: string | undefined,
    workspaceId: string | undefined,
  ): Promise<InventoriedTablePage> {
    const normalized = normalizeInventoriedTableQuery(request, resource.policy);
    const cursorContext = tableCursorContext({
      filters: normalized.filters,
      orgId: subject.orgId,
      ...(parentId === undefined ? {} : { parentId }),
      ...(normalized.search === undefined ? {} : { search: normalized.search }),
      sort: normalized.sort,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(request.snapshotAt === undefined
        ? {}
        : { snapshotAt: request.snapshotAt }),
    });
    const position =
      request.cursor === undefined
        ? undefined
        : decodeNativeCursor(this.pageCursor, request.cursor, cursorContext);
    const queried = await this.repository.queryInventoriedTableRows({
      actorId: subject.id,
      actorType: subject.type,
      filters: normalized.filters,
      includeTotals: position === undefined,
      limit: normalized.limit + 1,
      orgId: subject.orgId,
      ...(parentId === undefined ? {} : { parentId }),
      ...(position === undefined
        ? {}
        : { position: { id: position.id, value: position.value } }),
      resource: nativeResourceId(resource.id),
      ...(normalized.search === undefined ? {} : { search: normalized.search }),
      searchFields: resource.policy.searchFields,
      ...(request.snapshotAt === undefined
        ? {}
        : { snapshotAt: request.snapshotAt }),
      sort: normalized.sort,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
    const hasMore = queried.items.length > normalized.limit;
    const items = queried.items.slice(0, normalized.limit);
    const total = queried.total ?? position?.total;
    if (total === undefined) throw new Error("inventoried_table_total_missing");
    const summary = queried.summary ?? position?.summary;
    const last = items.at(-1);
    return {
      applied: { filters: normalized.filters, sort: [normalized.sort] },
      items,
      page: {
        estimatedTotal: total,
        limit: normalized.limit,
        nextCursor:
          hasMore && last !== undefined
            ? this.pageCursor.encode({
                ...cursorContext,
                position: {
                  id: last.id,
                  value: cursorCell(last[normalized.sort.field]),
                  total,
                  ...(summary === undefined ? {} : { summary }),
                },
              })
            : null,
        previousCursor: null,
      },
      resource: resource.id,
      ...(summary === undefined ? {} : { summary }),
    };
  }
}

interface NativeTableCursorPosition {
  id: string;
  summary?: Record<string, number>;
  total: number;
  value: number | string | null;
}

function tableCursorContext(input: {
  filters: InventoriedTableFilter[];
  orgId: string;
  parentId?: string;
  search?: string;
  snapshotAt?: string;
  sort: { direction: "asc" | "desc"; field: string };
  workspaceId?: string;
}) {
  const { sort, ...filter } = input;
  return { filter, sort };
}

function decodeNativeCursor(
  codec: PageCursorCodec,
  cursor: string,
  context: ReturnType<typeof tableCursorContext>,
): NativeTableCursorPosition {
  try {
    return codec.decode(cursor, context, nativeCursorPosition);
  } catch (error) {
    if (error instanceof InvalidPageCursorError)
      throw new ApiError(error.code, "Page cursor is invalid or expired.", 400);
    throw error;
  }
}

function nativeCursorPosition(
  value: unknown,
): NativeTableCursorPosition | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Partial<NativeTableCursorPosition>;
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length < 1 ||
    candidate.id.length > 300 ||
    !Number.isSafeInteger(candidate.total) ||
    (candidate.total ?? -1) < 0 ||
    !(
      candidate.value === null ||
      typeof candidate.value === "string" ||
      (typeof candidate.value === "number" && Number.isFinite(candidate.value))
    ) ||
    (candidate.summary !== undefined &&
      (candidate.summary === null ||
        typeof candidate.summary !== "object" ||
        Array.isArray(candidate.summary) ||
        Object.values(candidate.summary).some(
          (count) => !Number.isSafeInteger(count) || count < 0,
        )))
  )
    return undefined;
  return candidate as NativeTableCursorPosition;
}

function nativeResourceId(value: string): NativeInventoriedTableResource {
  if (
    nativeInventoriedTableResources.includes(
      value as NativeInventoriedTableResource,
    )
  )
    return value as NativeInventoriedTableResource;
  throw new Error("inventoried_table_native_registry_mismatch");
}

function cursorCell(value: unknown): number | string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("inventoried_table_sort_value_invalid");
}

export function inventoriedTablePageCursorSecrets(input: {
  current: string;
  previous?: string;
}): [string, ...string[]] {
  const secrets: [string, ...string[]] = [
    input.current.length >= 16
      ? derivePageCursorSecret(input.current, "inventoried-table-pages")
      : defaultTableCursorSecret,
  ];
  if (input.previous !== undefined && input.previous.length >= 16) {
    secrets.push(
      derivePageCursorSecret(input.previous, "inventoried-table-pages"),
    );
  }
  return secrets;
}

export function parseInventoriedTablePageRequest(body: {
  cursor?: string | undefined;
  filters?: InventoriedTableFilter[] | undefined;
  limit?: number | undefined;
  parentId?: string | undefined;
  resource: string;
  search?: string | undefined;
  sort?: Array<{ direction: "asc" | "desc"; field: string }> | undefined;
  workspaceId?: string | undefined;
}): InventoriedTablePageRequest {
  if (body.resource.trim().length === 0) {
    throw new ApiError("invalid_request", "Table resource is required.", 400);
  }
  return {
    filters: body.filters ?? [],
    limit: body.limit ?? 25,
    resource: body.resource,
    sort: body.sort ?? [],
    ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
    ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
    ...(body.search === undefined ? {} : { search: body.search }),
    ...(body.workspaceId === undefined
      ? {}
      : { workspaceId: body.workspaceId }),
  };
}

function emptyPage(
  resource: InventoriedTableResource,
  request: InventoriedTablePageRequest,
): InventoriedTablePage {
  return {
    applied: {
      filters: request.filters,
      sort: [resource.policy.defaultSort],
    },
    items: [] as InventoriedTableRow[],
    page: {
      estimatedTotal: 0,
      limit: request.limit,
      nextCursor: null,
      previousCursor: null,
    },
    resource: resource.id,
  };
}
