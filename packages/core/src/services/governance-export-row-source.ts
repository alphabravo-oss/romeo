import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  DataExportCounts,
  DataExportResolvedRequest,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import {
  exportBackgroundJob,
  exportFileObjectBytes,
  exportKnowledgeSourceBytes,
  exportWorkspace,
  safeObject,
  selectedWorkspaces,
} from "./data-export-support";
import type { InventoriedTablePageService } from "./inventoried-table-page-service";

const pageSize = 100;

export type GovernanceExportCountKey = Exclude<
  keyof DataExportCounts,
  "fileObjectBytesIncluded" | "knowledgeSourceBytesIncluded"
>;

export interface GovernanceExportRowPage {
  countKey: GovernanceExportCountKey;
  dataset: string;
  records: Array<Record<string, unknown>>;
  fileObjectBytesIncluded?: number;
  knowledgeSourceBytesIncluded?: number;
}

export async function* governanceExportRowPages(input: {
  repository: RomeoRepository;
  tablePages: InventoriedTablePageService;
  objectStore: ObjectStore;
  subject: AuthSubject;
  request: DataExportResolvedRequest;
  snapshotAt: string;
}): AsyncGenerator<GovernanceExportRowPage> {
  const workspaces = await selectedWorkspaces(input);
  const objectBudget = { totalIncludedBytes: 0 };
  yield* batches(
    "workspaces",
    "workspaces",
    workspaces.map((row) => exportWorkspace(row, input.request.includeContent)),
  );

  for (const workspace of workspaces) {
    const agents = await input.repository.listAgents(workspace.id);
    yield* batches("agents", "agents", sanitizeRows(agents, input.request));
    const templates = await input.repository.listPromptTemplates(
      input.subject.orgId,
      workspace.id,
    );
    yield* batches(
      "promptTemplates",
      "prompt_templates",
      sanitizeRows(templates, input.request),
    );
    yield* chatPages(input, workspace.id);
    yield* knowledgePages(input, workspace.id, objectBudget);
    yield* filePages(input, workspace.id, objectBudget);

    const connectors = await input.repository.listDataConnectors(
      input.subject.orgId,
      workspace.id,
    );
    yield* batches(
      "dataConnectors",
      "data_connectors",
      sanitizeRows(connectors, input.request),
    );
    for (const connector of connectors)
      yield* nativePages(input, {
        countKey: "dataConnectorSyncs",
        dataset: "data_connector_syncs",
        parentId: connector.id,
        resource: "data_connector_sync_runs",
        workspaceId: workspace.id,
      });
  }

  yield* nativePages(input, {
    countKey: "usageEvents",
    dataset: "usage_events",
    resource: "usage_events",
    ...(input.request.workspaceId === undefined
      ? {}
      : { workspaceId: input.request.workspaceId }),
  });
  yield* nativePages(input, {
    countKey: "backgroundJobs",
    dataset: "background_jobs",
    resource: "background_jobs",
    ...(input.request.workspaceId === undefined
      ? {}
      : { workspaceId: input.request.workspaceId }),
  });
}

async function* chatPages(
  input: Parameters<typeof governanceExportRowPages>[0],
  workspaceId: string,
): AsyncGenerator<GovernanceExportRowPage> {
  let offset = 0;
  while (true) {
    const page = await input.repository.listAuthorizedChatsPage({
      archived: "all",
      groupIds: input.subject.groupIds,
      isAdmin: input.subject.isAdmin === true,
      limit: pageSize,
      now: input.snapshotAt,
      offset,
      orgId: input.subject.orgId,
      principalId: input.subject.id,
      principalType: input.subject.type,
      workspaceId,
    });
    const chats = page.items.filter((row) => atSnapshot(row, input.snapshotAt));
    yield* batches("chats", "chats", sanitizeRows(chats, input.request));
    for (const chat of chats) {
      let cursor: { createdAt: string; id: string } | undefined;
      do {
        const messages = await input.repository.queryAuthorizedMessagesPage({
          chatId: chat.id,
          limit: pageSize,
          mode: "linear",
          orgId: input.subject.orgId,
          transcriptVersion: chat.transcriptVersion ?? "0",
          workspaceId,
          ...(cursor === undefined ? {} : { linearCursor: cursor }),
        });
        const rows = messages.items.filter((row) =>
          atSnapshot(row, input.snapshotAt),
        );
        yield* batches(
          "messages",
          "messages",
          sanitizeRows(rows, input.request),
        );
        const parts = await input.repository.listMessagePartsForMessages(
          rows.map((row) => row.id),
        );
        yield* batches(
          "messageParts",
          "message_parts",
          sanitizeRows(parts, input.request),
        );
        cursor =
          messages.nextPosition?.mode === "linear"
            ? {
                createdAt: messages.nextPosition.createdAt,
                id: messages.nextPosition.id,
              }
            : undefined;
      } while (cursor !== undefined);
      const comments = await input.repository.listChatComments(chat.id);
      yield* batches(
        "chatComments",
        "chat_comments",
        sanitizeRows(
          comments.filter((row) => atSnapshot(row, input.snapshotAt)),
          input.request,
        ),
      );
    }
    offset += page.items.length;
    if (page.items.length < pageSize) break;
  }
}

async function* knowledgePages(
  input: Parameters<typeof governanceExportRowPages>[0],
  workspaceId: string,
  objectBudget: { totalIncludedBytes: number },
): AsyncGenerator<GovernanceExportRowPage> {
  const bases = await input.repository.listKnowledgeBases(workspaceId);
  yield* batches(
    "knowledgeBases",
    "knowledge_bases",
    sanitizeRows(bases, input.request),
  );
  for (const base of bases) {
    const sources = await input.repository.listKnowledgeSources(base.id);
    for (const page of chunk(sources, pageSize)) {
      let included = 0;
      const records = [];
      for (const source of page) {
        const objectBytes = await exportKnowledgeSourceBytes({
          source,
          objectStore: input.objectStore,
          request: input.request,
          objectBudget,
        });
        if (objectBytes.included) included += objectBytes.sizeBytes ?? 0;
        records.push({
          ...sanitizeRow(source, input.request),
          objectBytes,
        });
      }
      yield {
        countKey: "knowledgeSources",
        dataset: "knowledge_sources",
        records,
        knowledgeSourceBytesIncluded: included,
      };
    }
    const chunks = await input.repository.listKnowledgeChunks(base.id);
    yield* batches(
      "knowledgeChunks",
      "knowledge_chunks",
      sanitizeRows(chunks, input.request),
    );
  }
}

async function* filePages(
  input: Parameters<typeof governanceExportRowPages>[0],
  workspaceId: string,
  objectBudget: { totalIncludedBytes: number },
): AsyncGenerator<GovernanceExportRowPage> {
  let offset = 0;
  while (true) {
    const page = await input.repository.listAuthorizedFileObjectsPage({
      accessMode: "workspace_content",
      groupIds: input.subject.groupIds,
      isAdmin: input.subject.isAdmin === true,
      limit: pageSize,
      offset,
      orgId: input.subject.orgId,
      principalId: input.subject.id,
      principalType: input.subject.type,
      workspaceId,
    });
    const records = [];
    let included = 0;
    for (const file of page.items.filter((row) =>
      atSnapshot(row, input.snapshotAt),
    )) {
      const objectBytes = await exportFileObjectBytes({
        file,
        objectStore: input.objectStore,
        request: input.request,
        objectBudget,
      });
      if (objectBytes.included) included += objectBytes.sizeBytes ?? 0;
      records.push({ ...sanitizeRow(file, input.request), objectBytes });
    }
    if (records.length > 0)
      yield {
        countKey: "fileObjects",
        dataset: "file_objects",
        records,
        fileObjectBytesIncluded: included,
      };
    offset += page.items.length;
    if (page.items.length < pageSize) break;
  }
}

async function* nativePages(
  input: Parameters<typeof governanceExportRowPages>[0],
  pageInput: {
    countKey: GovernanceExportCountKey;
    dataset: string;
    parentId?: string;
    resource: string;
    workspaceId?: string;
  },
): AsyncGenerator<GovernanceExportRowPage> {
  let cursor: string | undefined;
  do {
    const page = await input.tablePages.query(input.subject, {
      resource: pageInput.resource,
      limit: pageSize,
      filters: [],
      sort: [],
      snapshotAt: input.snapshotAt,
      ...(pageInput.parentId === undefined
        ? {}
        : { parentId: pageInput.parentId }),
      ...(pageInput.workspaceId === undefined
        ? {}
        : { workspaceId: pageInput.workspaceId }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    const records = page.items.map((row) =>
      pageInput.dataset === "background_jobs"
        ? exportBackgroundJob(row as never)
        : sanitizeRow(row, input.request),
    );
    if (records.length > 0)
      yield {
        countKey: pageInput.countKey,
        dataset: pageInput.dataset,
        records,
      };
    cursor = page.page.nextCursor ?? undefined;
  } while (cursor !== undefined);
}

function* batches(
  countKey: GovernanceExportCountKey,
  dataset: string,
  records: Array<Record<string, unknown>>,
): Generator<GovernanceExportRowPage> {
  for (const page of chunk(records, pageSize))
    if (page.length > 0) yield { countKey, dataset, records: page };
}

function chunk<T>(values: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    pages.push(values.slice(index, index + size));
  return pages;
}

function sanitizeRows<T extends object>(
  rows: T[],
  request: DataExportResolvedRequest,
): Array<Record<string, unknown>> {
  return rows.map((row) => sanitizeRow(row, request));
}

function sanitizeRow(
  value: object,
  request: DataExportResolvedRequest,
): Record<string, unknown> {
  const safe = safeObject(value) as Record<string, unknown>;
  return redactContent(safe, request.includeContent);
}

function redactContent(
  value: Record<string, unknown>,
  includeContent: boolean,
): Record<string, unknown> {
  const contentKeys = new Set([
    "body",
    "content",
    "description",
    "fileName",
    "name",
    "systemPrompt",
    "text",
    "title",
  ]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "objectKey" && key !== "payload")
      .map(([key, nested]) => [
        key,
        !includeContent && contentKeys.has(key)
          ? { included: false, reason: "not_requested" }
          : nested,
      ]),
  );
}

function atSnapshot(
  value: { createdAt?: string; updatedAt?: string },
  snapshotAt: string,
): boolean {
  const boundary = value.createdAt ?? value.updatedAt;
  return boundary === undefined || boundary <= snapshotAt;
}
