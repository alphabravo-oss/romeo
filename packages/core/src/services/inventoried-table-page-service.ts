import { assertScope, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import {
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
  type PageCursorCodec,
} from "./page-cursor";

const defaultTableCursorSecret = "romeo-development-table-page-cursor-secret-v1";

export interface InventoriedTablePageRequest extends InventoriedTableQuery {
  parentId?: string;
  resource: string;
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
    if (resource.requiresParent && (parentId === undefined || parentId.length === 0)) {
      return emptyPage(resource, request);
    }
    if (
      resource.requiresWorkspace &&
      (workspaceId === undefined || workspaceId.length === 0)
    ) {
      return emptyPage(resource, request);
    }
    const loaded = await resource.load({
      repository: this.repository,
      subject,
      ...(parentId === undefined || parentId.length === 0
        ? {}
        : { parentId }),
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
    ...(body.workspaceId === undefined ? {} : { workspaceId: body.workspaceId }),
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
