import { z } from "@hono/zod-openapi";

export const chatIdentifier = z.string().trim().min(1).max(300);
export const chatTimestamp = z.iso.datetime();
export const chatRole = z.enum(["system", "user", "assistant", "tool"]);

export const ChatSchema = z
  .strictObject({
    id: chatIdentifier,
    orgId: chatIdentifier,
    workspaceId: chatIdentifier,
    title: z.string().min(1).max(200),
    modelId: chatIdentifier.optional(),
    temporary: z.boolean().optional(),
    expiresAt: chatTimestamp.optional(),
    createdBy: chatIdentifier,
    archivedAt: chatTimestamp.optional(),
    legalHoldUntil: chatTimestamp.optional(),
    legalHoldReason: z.string().max(500).optional(),
    updatedAt: chatTimestamp,
  })
  .openapi("Chat");

export const MessageCitationSchema = z
  .strictObject({
    chunkId: chatIdentifier,
    documentId: chatIdentifier,
    title: z.string().min(1).max(1_000),
    sourceUri: z.string().optional(),
    sourceType: z.string().max(100).optional(),
    provider: z.string().max(100).optional(),
    retrievedAt: chatTimestamp.optional(),
    accessedAt: chatTimestamp.optional(),
    publishedAt: chatTimestamp.optional(),
  })
  .openapi("MessageCitation");

export const MessageAttachmentSchema = z
  .strictObject({
    id: chatIdentifier,
    messageId: chatIdentifier,
    fileName: z.string().min(1).max(160),
    mimeType: z.string().min(1).max(200),
    sizeBytes: z.number().int().nonnegative(),
    kind: z.enum(["document", "image"]),
    retainedInContext: z.boolean(),
    previewUrl: z.string().optional(),
  })
  .openapi("MessageAttachment");

export const MessageSchema = z
  .strictObject({
    id: chatIdentifier,
    chatId: chatIdentifier,
    role: chatRole,
    content: z.string(),
    citations: z.array(MessageCitationSchema).max(100).optional(),
    attachments: z.array(MessageAttachmentSchema).max(100).optional(),
    createdAt: chatTimestamp,
  })
  .openapi("Message");

export const MessageFeedbackStateSchema = z
  .strictObject({
    chatId: chatIdentifier,
    messageId: chatIdentifier,
    configured: z.boolean(),
    rating: z.enum(["positive", "negative"]).optional(),
    reasonCode: z.string().max(80).optional(),
    createdAt: chatTimestamp.optional(),
    updatedAt: chatTimestamp.optional(),
    redaction: z.strictObject({
      freeTextReturned: z.literal(false),
      messageContentReturned: z.literal(false),
      rawUsageMetadataReturned: z.literal(false),
      reviewerIdentityReturned: z.literal(false),
    }),
  })
  .openapi("MessageFeedbackState");

export const ChatCommentSchema = z
  .strictObject({
    id: chatIdentifier,
    orgId: chatIdentifier,
    chatId: chatIdentifier,
    authorId: chatIdentifier,
    body: z.string().min(1).max(5_000),
    mentionedUserIds: z.array(chatIdentifier),
    createdAt: chatTimestamp,
  })
  .openapi("ChatComment");

export const deletionCounts = z
  .strictObject({
    chats: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    messageParts: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative(),
    runSteps: z.number().int().nonnegative(),
    runEvents: z.number().int().nonnegative(),
    chatComments: z.number().int().nonnegative(),
    userNotifications: z.number().int().nonnegative(),
    notificationDeliveries: z.number().int().nonnegative(),
    runLinkedToolCalls: z.number().int().nonnegative(),
    usageEvents: z.number().int().nonnegative(),
    resourceGrants: z.number().int().nonnegative(),
    resourceFavorites: z.number().int().nonnegative(),
    workspaceFolderItems: z.number().int().nonnegative(),
    fileObjects: z.number().int().nonnegative(),
    knowledgeSources: z.number().int().nonnegative(),
    knowledgeChunks: z.number().int().nonnegative(),
    knowledgeEmbeddings: z.number().int().nonnegative(),
    objectStoreObjects: z.number().int().nonnegative(),
    objectStoreBytes: z.number().int().nonnegative(),
  })
  .openapi("DataDeletionCounts");

export const deletionPlan = {
  orgId: chatIdentifier,
  workspaceId: chatIdentifier,
  resourceType: z.enum(["chat", "file_object", "knowledge_source"]),
  resourceId: chatIdentifier,
  knowledgeBaseId: chatIdentifier.optional(),
  legalHold: z
    .strictObject({ until: chatTimestamp, reason: z.string().optional() })
    .optional(),
  counts: deletionCounts,
};

export const DataDeletionPreviewSchema = z
  .strictObject({
    schema: z.literal("romeo.data-deletion-preview.v1"),
    ...deletionPlan,
    previewedAt: chatTimestamp,
  })
  .openapi("DataDeletionPreview");

export const DataDeletionResultSchema = z
  .strictObject({
    schema: z.literal("romeo.data-deletion-result.v1"),
    ...deletionPlan,
    deletedAt: chatTimestamp,
  })
  .openapi("DataDeletionResult");

export const CreateChatSchema = z
  .strictObject({
    workspaceId: chatIdentifier,
    title: z.string().min(1).max(200),
    temporary: z.boolean().optional(),
    expiresAt: chatTimestamp.optional(),
  })
  .openapi("CreateChatRequest");

export const UpdateChatSchema = z
  .strictObject({
    title: z.string().min(1).max(200).optional(),
    modelId: z.union([chatIdentifier, z.null()]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one chat field is required.",
  })
  .openapi("UpdateChatRequest");

export const importAttachment = z.strictObject({
  id: chatIdentifier.optional(),
  messageId: chatIdentifier.optional(),
  dataBase64: z.string().min(1).max(34_000_000),
  fileName: z.string().min(1).max(160),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive().max(25_000_000),
  retainedInContext: z.boolean().optional(),
  kind: z.enum(["document", "image"]).optional(),
  previewUrl: z.string().optional(),
});

export const importMessage = z.strictObject({
  id: chatIdentifier.optional(),
  chatId: chatIdentifier.optional(),
  role: chatRole,
  content: z.string().max(1_000_000),
  citations: z.array(MessageCitationSchema).max(100).optional(),
  attachments: z.array(importAttachment).max(8).optional(),
  createdAt: chatTimestamp.optional(),
});

export const ImportChatSchema = z
  .strictObject({
    workspaceId: chatIdentifier,
    title: z.string().trim().min(1).max(200).optional(),
    modelId: chatIdentifier.optional(),
    messages: z.array(importMessage).max(10_000),
  })
  .openapi("ImportChatRequest");

export const exportedAttachment = MessageAttachmentSchema.extend({
  dataBase64: z.string().min(1),
});
export const exportedMessage = MessageSchema.omit({ attachments: true }).extend(
  {
    attachments: z.array(exportedAttachment).optional(),
  },
);
export const ChatExportSchema = z
  .strictObject({
    schema: z.literal("romeo.chat-export.v1"),
    exportedAt: chatTimestamp,
    chat: ChatSchema,
    messages: z.array(exportedMessage),
  })
  .openapi("ChatExport");

export const ForkChatSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    throughMessageId: chatIdentifier.optional(),
    includeAttachments: z.boolean().optional(),
  })
  .openapi("ForkChatRequest");

export const UpdateMessageFeedbackSchema = z
  .strictObject({
    rating: z.enum(["positive", "negative", "none"]),
    reasonCode: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_.:-]+$/u)
      .optional(),
  })
  .refine(
    (value) => value.rating !== "none" || value.reasonCode === undefined,
    { message: "reasonCode is only valid with a recorded rating." },
  )
  .openapi("UpdateMessageFeedbackRequest");

export const UpdateAttachmentRetentionSchema = z
  .strictObject({ retainedInContext: z.boolean() })
  .openapi("UpdateAttachmentRetentionRequest");

export const UpdateChatLegalHoldSchema = z
  .strictObject({
    legalHoldUntil: z.union([chatTimestamp, z.null()]).optional(),
    legalHoldReason: z.string().max(500).optional(),
  })
  .openapi("UpdateChatLegalHoldRequest");

export const CreateChatCommentSchema = z
  .strictObject({ body: z.string().min(1).max(5_000) })
  .openapi("CreateChatCommentRequest");
