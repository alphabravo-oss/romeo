import type {
  DelegatedOAuthConnection,
  DelegatedOAuthProviderId,
} from "./delegated-oauth";
import type { DataConnectorType } from "./data-connectors";
import type {
  Chat,
  ChatComment,
  ChatTag,
  ChatTagAssignment,
  CollaborationChannel,
  CollaborationChannelMember,
  DataConnector,
  DataConnectorSync,
  FileObject,
  KnowledgeBase,
  KnowledgeChunk,
  KnowledgeChunkEmbedding,
  KnowledgeChunkEmbeddingSearchHit,
  KnowledgeSource,
  Message,
  MessagePart,
  NotificationDelivery,
  NotificationDeliveryChannel,
  QueuedChatTurn,
  UserNotification,
  VoiceProfile,
} from "./entities";
import type {
  AuthorizedChatCatalogQuery,
  AuthorizedFileCatalogQuery,
  CancelQueuedChatTurnInput,
  ClaimQueuedChatTurnInput,
  FinishQueuedChatTurnLeaseInput,
  RenewQueuedChatTurnLeaseInput,
  RomeoRepository,
} from "./repository";

export interface RepositoryContentCapability {
  listChats(workspaceId: string): Promise<Chat[]>;
  listAuthorizedChatsPage(input: AuthorizedChatCatalogQuery): Promise<{
    items: Chat[];
    total: number;
  }>;
  searchChatContent(
    workspaceId: string,
    query: string,
  ): Promise<Array<{ chatId: string; messageId?: string; snippet: string }>>;
  createChat(chat: Chat): Promise<Chat>;
  updateChat(chat: Chat): Promise<Chat>;
  getChat(chatId: string): Promise<Chat | undefined>;
  listQueuedChatTurns(chatId: string): Promise<QueuedChatTurn[]>;
  getQueuedChatTurn(turnId: string): Promise<QueuedChatTurn | undefined>;
  getQueuedChatTurnByIdempotency(
    orgId: string,
    chatId: string,
    idempotencyKey: string,
  ): Promise<QueuedChatTurn | undefined>;
  createQueuedChatTurn(turn: QueuedChatTurn): Promise<QueuedChatTurn>;
  claimNextQueuedChatTurn(
    input: ClaimQueuedChatTurnInput,
  ): Promise<QueuedChatTurn | undefined>;
  renewQueuedChatTurnLease(
    input: RenewQueuedChatTurnLeaseInput,
  ): Promise<QueuedChatTurn | undefined>;
  cancelQueuedChatTurn(
    input: CancelQueuedChatTurnInput,
  ): Promise<QueuedChatTurn | undefined>;
  finishQueuedChatTurnLease(
    input: FinishQueuedChatTurnLeaseInput,
  ): Promise<QueuedChatTurn | undefined>;
  updateQueuedChatTurn(turn: QueuedChatTurn): Promise<QueuedChatTurn>;
  listMessages(chatId: string): Promise<Message[]>;
  getMessage(messageId: string): Promise<Message | undefined>;
  createMessage(message: Message): Promise<Message>;
  deleteMessage(messageId: string): Promise<void>;
  listMessageParts(messageId: string): Promise<MessagePart[]>;
  getMessagePart(messagePartId: string): Promise<MessagePart | undefined>;
  createMessageParts(parts: MessagePart[]): Promise<MessagePart[]>;
  updateMessagePart(part: MessagePart): Promise<MessagePart>;
  listChatComments(chatId: string): Promise<ChatComment[]>;
  createChatComment(comment: ChatComment): Promise<ChatComment>;
  listFileObjects(orgId: string, workspaceId?: string): Promise<FileObject[]>;
  listAuthorizedFileObjectsPage(input: AuthorizedFileCatalogQuery): Promise<{
    items: FileObject[];
    total: number;
  }>;
  getFileObject(fileId: string): Promise<FileObject | undefined>;
  createFileObject(file: FileObject): Promise<FileObject>;
  updateFileObject(file: FileObject): Promise<FileObject>;
  listChatTags(orgId: string, userId: string): Promise<ChatTag[]>;
  listChatTagsForChat(
    orgId: string,
    userId: string,
    chatId: string,
  ): Promise<ChatTag[]>;
  listChatIdsByTag(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<string[]>;
  upsertChatTag(tag: ChatTag): Promise<ChatTag>;
  createChatTagAssignment(
    assignment: ChatTagAssignment,
  ): Promise<ChatTagAssignment>;
  deleteChatTagAssignment(
    orgId: string,
    userId: string,
    chatId: string,
    slug: string,
  ): Promise<ChatTagAssignment | undefined>;
  countChatTagAssignments(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<number>;
  deleteChatTag(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<ChatTag | undefined>;
  listCollaborationChannels(orgId: string): Promise<CollaborationChannel[]>;
  getCollaborationChannel(
    channelId: string,
  ): Promise<CollaborationChannel | undefined>;
  createCollaborationChannel(
    channel: CollaborationChannel,
  ): Promise<CollaborationChannel>;
  updateCollaborationChannel(
    channel: CollaborationChannel,
  ): Promise<CollaborationChannel>;
  deleteCollaborationChannel(
    channelId: string,
  ): Promise<CollaborationChannel | undefined>;
  listCollaborationChannelMembers(
    orgId: string,
    channelId?: string,
    userId?: string,
  ): Promise<CollaborationChannelMember[]>;
  getCollaborationChannelMember(
    channelId: string,
    userId: string,
  ): Promise<CollaborationChannelMember | undefined>;
  createCollaborationChannelMember(
    member: CollaborationChannelMember,
  ): Promise<CollaborationChannelMember>;
  updateCollaborationChannelMember(
    member: CollaborationChannelMember,
  ): Promise<CollaborationChannelMember>;
  deleteCollaborationChannelMembers(
    channelId: string,
    userIds: string[],
  ): Promise<CollaborationChannelMember[]>;
  listUserNotifications(
    orgId: string,
    userId: string,
  ): Promise<UserNotification[]>;
  createUserNotification(
    notification: UserNotification,
  ): Promise<UserNotification>;
  updateUserNotification(
    notification: UserNotification,
  ): Promise<UserNotification>;
  listNotificationDeliveryChannels(
    orgId: string,
    userId: string,
  ): Promise<NotificationDeliveryChannel[]>;
  createNotificationDeliveryChannel(
    channel: NotificationDeliveryChannel,
  ): Promise<NotificationDeliveryChannel>;
  listNotificationDeliveries(
    orgId: string,
    userId: string,
  ): Promise<NotificationDelivery[]>;
  listFailedNotificationDeliveries(
    orgId: string,
    limit: number,
  ): Promise<NotificationDelivery[]>;
  createNotificationDelivery(
    delivery: NotificationDelivery,
  ): Promise<NotificationDelivery>;
  updateNotificationDelivery(
    delivery: NotificationDelivery,
  ): Promise<NotificationDelivery>;
  listKnowledgeBases(workspaceId: string): Promise<KnowledgeBase[]>;
  createKnowledgeBase(knowledgeBase: KnowledgeBase): Promise<KnowledgeBase>;
  updateKnowledgeBase(knowledgeBase: KnowledgeBase): Promise<KnowledgeBase>;
  getKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBase | undefined>;
  listKnowledgeSources(knowledgeBaseId: string): Promise<KnowledgeSource[]>;
  createKnowledgeSource(source: KnowledgeSource): Promise<KnowledgeSource>;
  updateKnowledgeSource(source: KnowledgeSource): Promise<KnowledgeSource>;
  deleteKnowledgeSource(sourceId: string): Promise<KnowledgeSource | undefined>;
  listKnowledgeChunks(knowledgeBaseId: string): Promise<KnowledgeChunk[]>;
  createKnowledgeChunks(chunks: KnowledgeChunk[]): Promise<KnowledgeChunk[]>;
  deleteKnowledgeChunksForSource(sourceId: string): Promise<void>;
  listKnowledgeChunkEmbeddings(
    knowledgeBaseId: string,
  ): Promise<KnowledgeChunkEmbedding[]>;
  searchKnowledgeChunkEmbeddings(input: {
    orgId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    embeddingProvider: string;
    embeddingModel: string;
    dimensions: number;
    queryEmbedding: number[];
    maxResults: number;
  }): Promise<KnowledgeChunkEmbeddingSearchHit[]>;
  upsertKnowledgeChunkEmbeddings(
    embeddings: KnowledgeChunkEmbedding[],
  ): Promise<KnowledgeChunkEmbedding[]>;
  deleteKnowledgeChunkEmbeddingsForSource(sourceId: string): Promise<void>;
  listDataConnectors(
    orgId: string,
    workspaceId?: string,
  ): Promise<DataConnector[]>;
  getDataConnector(connectorId: string): Promise<DataConnector | undefined>;
  createDataConnector(connector: DataConnector): Promise<DataConnector>;
  updateDataConnector(connector: DataConnector): Promise<DataConnector>;
  listDataConnectorSyncs(
    orgId: string,
    connectorId?: string,
  ): Promise<DataConnectorSync[]>;
  createDataConnectorSync(sync: DataConnectorSync): Promise<DataConnectorSync>;
  updateDataConnectorSync(sync: DataConnectorSync): Promise<DataConnectorSync>;
  listDelegatedOAuthConnections(
    orgId: string,
    workspaceId?: string,
    userId?: string,
  ): Promise<DelegatedOAuthConnection[]>;
  getDelegatedOAuthConnection(
    connectionId: string,
  ): Promise<DelegatedOAuthConnection | undefined>;
  getDelegatedOAuthConnectionByProviderAccount(input: {
    connectorType: DataConnectorType;
    orgId: string;
    providerAccountId: string;
    providerId: DelegatedOAuthProviderId;
    userId: string;
    workspaceId: string;
  }): Promise<DelegatedOAuthConnection | undefined>;
  createDelegatedOAuthConnection(
    connection: DelegatedOAuthConnection,
  ): Promise<DelegatedOAuthConnection>;
  updateDelegatedOAuthConnection(
    connection: DelegatedOAuthConnection,
  ): Promise<DelegatedOAuthConnection>;
  withDelegatedOAuthConnectionRefreshLock<T>(
    connectionId: string,
    work: (repository: RomeoRepository) => Promise<T>,
  ): Promise<T>;
  listVoiceProfiles(orgId: string): Promise<VoiceProfile[]>;
  getVoiceProfile(voiceProfileId: string): Promise<VoiceProfile | undefined>;
  createVoiceProfile(voiceProfile: VoiceProfile): Promise<VoiceProfile>;
}
