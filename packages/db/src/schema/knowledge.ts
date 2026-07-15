import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

import { agentModels } from "./agents";
import { organizations, workspaces } from "./tenancy";
import { users } from "./users";

export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    knowledgeBasesWorkspaceIdx: index("knowledge_bases_workspace_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  }),
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: text("id").primaryKey(),
    knowledgeBaseId: text("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status").notNull(),
    objectKey: text("object_key"),
    chunkCount: integer("chunk_count"),
    contentHash: text("content_hash"),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    knowledgeSourcesKnowledgeBaseUpdatedIdx: index(
      "knowledge_sources_kb_updated_idx",
    ).on(table.knowledgeBaseId, table.updatedAt),
  }),
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: text("id").primaryKey(),
    knowledgeBaseId: text("knowledge_base_id").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSources.id),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sequence: integer("sequence").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    knowledgeChunksKnowledgeBaseSequenceIdx: index(
      "knowledge_chunks_kb_sequence_idx",
    ).on(table.knowledgeBaseId, table.sequence),
    knowledgeChunksSourceSequenceIdx: uniqueIndex(
      "knowledge_chunks_source_sequence_idx",
    ).on(table.sourceId, table.sequence),
  }),
);

export const knowledgeChunkEmbeddings = pgTable(
  "knowledge_chunk_embeddings",
  {
    id: text("id").notNull(),
    knowledgeBaseId: text("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSources.id),
    chunkId: text("chunk_id")
      .notNull()
      .references(() => knowledgeChunks.id),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    embeddingProvider: text("embedding_provider").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    dimensions: integer("dimensions").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    knowledgeChunkEmbeddingPk: primaryKey({
      name: "knowledge_chunk_embeddings_org_id_id_pk",
      columns: [table.orgId, table.id],
    }),
    knowledgeChunkEmbeddingChunkModelUniqueIdx: uniqueIndex(
      "knowledge_chunk_embeddings_chunk_model_unique_idx",
    ).on(
      table.orgId,
      table.chunkId,
      table.embeddingProvider,
      table.embeddingModel,
    ),
    knowledgeChunkEmbeddingKnowledgeBaseIdx: index(
      "knowledge_chunk_embeddings_kb_idx",
    ).on(table.orgId, table.knowledgeBaseId),
    knowledgeChunkEmbeddingVectorIdx: index(
      "knowledge_chunk_embeddings_vector_hnsw_idx",
    ).using("hnsw", table.embedding.op("vector_cosine_ops")),
    knowledgeChunkEmbeddingKnowledgeBaseFk: foreignKey({
      name: "kb_chunk_embeddings_kb_id_fk",
      columns: [table.knowledgeBaseId],
      foreignColumns: [knowledgeBases.id],
    }),
  }),
);

export const agentKnowledgeBindings = pgTable(
  "agent_knowledge_bindings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentModels.id),
    knowledgeBaseId: text("knowledge_base_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    agentKnowledgeBindingUniqueIdx: uniqueIndex(
      "agent_knowledge_bindings_agent_kb_unique_idx",
    ).on(table.agentId, table.knowledgeBaseId),
    agentKnowledgeBindingKnowledgeBaseFk: foreignKey({
      name: "agent_kb_bindings_kb_id_fk",
      columns: [table.knowledgeBaseId],
      foreignColumns: [knowledgeBases.id],
    }),
  }),
);
