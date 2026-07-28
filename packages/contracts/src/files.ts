import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();
const nullableTimestamp = z.union([timestamp, z.null()]);
const nullableString = z.union([z.string(), z.null()]);
const filePurpose = z.enum([
  "browser_artifact",
  "chat_attachment",
  "connector_import",
  "export_bundle",
  "general",
  "generated_image",
  "knowledge_source",
  "memory",
  "note",
  "web_source",
  "voice_artifact",
]);

export const FileExtractionSchema = z
  .strictObject({
    status: z.enum([
      "failed",
      "not_applicable",
      "pending",
      "processing",
      "succeeded",
    ]),
    quality: z.enum(["high", "medium", "unknown"]),
    method: nullableString,
    attempts: z.number().int().nonnegative(),
    attemptedAt: nullableTimestamp,
    completedAt: nullableTimestamp,
    characterCount: z.union([z.number().int().nonnegative(), z.null()]),
    failureCode: nullableString,
    provider: nullableString,
    pageCount: z.union([z.number().int().positive(), z.null()]),
    confidence: z.union([z.number().min(0).max(1), z.null()]),
  })
  .openapi("FileExtraction");

export const FileObjectSchema = z
  .strictObject({
    id: identifier,
    workspaceId: identifier,
    ownerType: z.enum(["service_account", "user"]),
    ownerId: identifier,
    fileName: z.string().min(1).max(160),
    mimeType: z.string().min(1).max(200),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string(),
    purpose: filePurpose,
    status: z.enum(["available", "deleted", "uploading"]),
    metadata: z.record(z.string(), z.unknown()),
    extraction: FileExtractionSchema,
    contentUrl: z.union([z.string(), z.null()]),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: timestamp.optional(),
  })
  .openapi("FileObject");

const uploadDescriptor = z.strictObject({
  url: z.string().min(1),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresAt: timestamp,
});

export const FileUploadSessionSchema = z
  .strictObject({
    file: FileObjectSchema,
    upload: uploadDescriptor.extend({ maxBytes: z.number().int().positive() }),
  })
  .openapi("FileUploadSession");

export const FileResumableUploadSessionSchema = z
  .strictObject({
    file: FileObjectSchema,
    upload: z.strictObject({
      mode: z.literal("resumable_backend_composed"),
      partCount: z.number().int().positive(),
      partSizeBytes: z.number().int().positive(),
      maxBytes: z.number().int().positive(),
      parts: z.array(
        z.strictObject({
          partNumber: z.number().int().positive(),
          sizeBytes: z.number().int().positive(),
          upload: uploadDescriptor,
        }),
      ),
    }),
  })
  .openapi("FileResumableUploadSession");

const fileMetadataInput = {
  workspaceId: identifier,
  fileName: z.string().min(1).max(160),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
  purpose: filePurpose.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

export const CreateFileSchema = z
  .strictObject({
    ...fileMetadataInput,
    sizeBytes: z.number().int().positive().max(25_000_000),
    dataBase64: z.string().min(1).max(34_000_000),
  })
  .openapi("CreateFileRequest");

export const CreateFileUploadSessionSchema = z
  .strictObject({
    ...fileMetadataInput,
    sizeBytes: z.number().int().positive().max(1_000_000_000),
    sha256: z.string().regex(/^[A-Fa-f0-9]{64}$/u),
  })
  .openapi("CreateFileUploadSessionRequest");

export const CreateFileResumableUploadSessionSchema =
  CreateFileUploadSessionSchema.extend({
    partSizeBytes: z.number().int().positive().max(100_000_000).optional(),
  }).openapi("CreateFileResumableUploadSessionRequest");

const metadata = { tags: ["Files"], security: authenticationSecurity };
const errors = {
  400: standardErrorResponses[400],
  401: standardErrorResponses[401],
  403: standardErrorResponses[403],
  404: standardErrorResponses[404],
  409: standardErrorResponses[409],
  500: standardErrorResponses[500],
} as const;
const filePath = z.strictObject({ fileId: identifier });
const pageMeta = z.strictObject({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export const listFilesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/files",
  operationId: "files.list",
  summary: "List authorized reusable files",
  request: {
    query: z.strictObject({
      workspaceId: identifier.optional(),
      q: z.string().max(1_000).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      "Authorized file metadata",
      z.strictObject({
        data: z.array(FileObjectSchema),
        meta: pageMeta.optional(),
      }),
    ),
    ...errors,
  },
});

export const createFileRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/files",
  operationId: "files.create",
  summary: "Upload a bounded file",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateFileSchema } },
    },
  },
  responses: {
    201: jsonResponse("Created file", dataEnvelope(FileObjectSchema)),
    ...errors,
  },
});

export const createFileUploadSessionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/files/uploads",
  operationId: "files.createUploadSession",
  summary: "Create a direct upload session",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: CreateFileUploadSessionSchema },
      },
    },
  },
  responses: {
    201: jsonResponse(
      "Created upload session",
      dataEnvelope(FileUploadSessionSchema),
    ),
    ...errors,
  },
});

export const createResumableUploadSessionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/files/uploads/resumable",
  operationId: "files.createResumableUploadSession",
  summary: "Create a resumable upload session",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateFileResumableUploadSessionSchema,
        },
      },
    },
  },
  responses: {
    201: jsonResponse(
      "Created resumable upload session",
      dataEnvelope(FileResumableUploadSessionSchema),
    ),
    ...errors,
  },
});

export const getResumableUploadSessionRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/files/uploads/resumable/{fileId}",
  operationId: "files.getResumableUploadSession",
  summary: "Refresh a resumable upload session",
  request: { params: filePath },
  responses: {
    200: jsonResponse(
      "Resumable upload session",
      dataEnvelope(FileResumableUploadSessionSchema),
    ),
    ...errors,
  },
});

export const getFileUploadSessionRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/files/uploads/{fileId}",
  operationId: "files.getUploadSession",
  summary: "Refresh a direct upload session",
  request: { params: filePath },
  responses: {
    200: jsonResponse("Upload session", dataEnvelope(FileUploadSessionSchema)),
    ...errors,
  },
});

export const getFileRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/files/{fileId}",
  operationId: "files.get",
  summary: "Get authorized file metadata",
  request: { params: filePath },
  responses: {
    200: jsonResponse("File metadata", dataEnvelope(FileObjectSchema)),
    ...errors,
  },
});

export const completeResumableUploadSessionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/files/uploads/resumable/{fileId}/complete",
  operationId: "files.completeResumableUploadSession",
  summary: "Complete a resumable upload session",
  request: { params: filePath },
  responses: {
    200: jsonResponse("Completed file", dataEnvelope(FileObjectSchema)),
    ...errors,
  },
});

export const cancelResumableUploadSessionRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/files/uploads/resumable/{fileId}",
  operationId: "files.cancelResumableUploadSession",
  summary: "Cancel a resumable upload session",
  request: { params: filePath },
  responses: {
    200: jsonResponse("Cancelled upload", dataEnvelope(FileObjectSchema)),
    ...errors,
  },
});

export const completeFileUploadSessionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/files/uploads/{fileId}/complete",
  operationId: "files.completeUploadSession",
  summary: "Complete a direct upload session",
  request: { params: filePath },
  responses: {
    200: jsonResponse("Completed file", dataEnvelope(FileObjectSchema)),
    ...errors,
  },
});

export const cancelFileUploadSessionRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/files/uploads/{fileId}",
  operationId: "files.cancelUploadSession",
  summary: "Cancel a direct upload session",
  request: { params: filePath },
  responses: {
    200: jsonResponse("Cancelled upload", dataEnvelope(FileObjectSchema)),
    ...errors,
  },
});

export const retryFileExtractionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/files/{fileId}/extraction/retry",
  operationId: "files.retryExtraction",
  summary: "Retry authorized file text extraction",
  request: { params: filePath },
  responses: {
    200: jsonResponse("Updated file", dataEnvelope(FileObjectSchema)),
    ...errors,
  },
});

export const deleteFileRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/files/{fileId}",
  operationId: "files.delete",
  summary: "Delete an authorized file",
  request: { params: filePath },
  responses: {
    200: jsonResponse("Deleted file", dataEnvelope(FileObjectSchema)),
    ...errors,
  },
});

export const readFileContentRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/files/{fileId}/content",
  operationId: "files.readContent",
  summary: "Read authorized file bytes",
  request: { params: filePath },
  responses: {
    200: {
      description: "File bytes",
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ format: "binary" }),
        },
      },
    },
    ...errors,
  },
});

export const fileRoutes = [
  listFilesRoute,
  createFileRoute,
  createFileUploadSessionRoute,
  createResumableUploadSessionRoute,
  getResumableUploadSessionRoute,
  completeResumableUploadSessionRoute,
  cancelResumableUploadSessionRoute,
  getFileUploadSessionRoute,
  completeFileUploadSessionRoute,
  cancelFileUploadSessionRoute,
  getFileRoute,
  retryFileExtractionRoute,
  readFileContentRoute,
  deleteFileRoute,
] as const;
