import { createAdminResource } from "./resources/admin";
import { createAgentResource } from "./resources/agents";
import { createChannelResource } from "./resources/channels";
import { createChatResource } from "./resources/chats";
import { createCollaborationResource } from "./resources/collaboration";
import { createCompatibilityResource } from "./resources/compatibility";
import { createDataConnectorResource } from "./resources/data-connectors";
import { createDelegatedOAuthResource } from "./resources/delegated-oauth";
import { createDeviceAuthorizationResource } from "./resources/device-authorizations";
import { createEvalResource } from "./resources/evals";
import { createFileResource } from "./resources/files";
import { createGovernanceResource } from "./resources/governance";
import { createKnowledgeResource } from "./resources/knowledge";
import { createNotificationResource } from "./resources/notifications";
import { createProviderResource } from "./resources/providers";
import { createScimResource } from "./resources/scim";
import { createSessionResource } from "./resources/sessions";
import { createSystemResource } from "./resources/system";
import { createToolResource } from "./resources/tools";
import { createVoiceResource } from "./resources/voices";
import { createWebhookResource } from "./resources/webhooks";
import { createWorkflowResource } from "./resources/workflows";
import type { ServerSentEvent } from "./sse";
import { RomeoTransport } from "./transport";
import type {
  AddChannelMembersInput,
  AssignChatTagInput,
  ChannelMessageQuery,
  CloneAgentInput,
  CreateAgentInput,
  CreateChannelInput,
  CreateChannelMessageInput,
  CreateChatInput,
  CreateDirectMessageChannelInput,
  CreateFileInput,
  CreateFileResumableUploadSessionInput,
  CreateFileUploadSessionInput,
  CreateManagedSecretInput,
  CreateWorkspaceInput,
  DeleteChatInput,
  ForkChatInput,
  OpenWebUiChannelInput,
  OpenWebUiChannelMessageInput,
  OpenWebUiCreateChatInput,
  OpenWebUiCreateFolderInput,
  OpenWebUiUpdateChatFolderInput,
  OpenWebUiUpdateFolderInput,
  OpenAiChatCompletionInput,
  OpenAiEmbeddingInput,
  CreateProviderInput,
  GenerateRecoveryCodesInput,
  RomeoClientOptions,
  AuthProviderConnectionTestInput,
  ImportAgentInput,
  LdapLoginInput,
  ListChatsInput,
  LocalLoginInput,
  LocalMfaVerifyInput,
  PinChannelMessageInput,
  StartRunInput,
  StartOAuth2LoginInput,
  StartOidcLoginInput,
  StartSamlLoginInput,
  SetLocalPasswordInput,
  TotpConfirmInput,
  TotpDisableInput,
  TotpEnrollmentInput,
  UpdateAuthProviderSettingsInput,
  UpdateMyProfileInput,
  UpdateAgentKnowledgeBindingInput,
  UpdateAgentInput,
  UpdateChannelInput,
  UpdateChatInput,
  UpdateChatLegalHoldInput,
  UpdateMessageFeedbackInput,
} from "./types";

export class RomeoApiClient {
  private readonly transport: RomeoTransport;
  readonly admin: ReturnType<typeof createAdminResource>;
  readonly agent: ReturnType<typeof createAgentResource>;
  readonly channels: ReturnType<typeof createChannelResource>;
  readonly chatApi: ReturnType<typeof createChatResource>;
  readonly collaboration: ReturnType<typeof createCollaborationResource>;
  readonly compatibility: ReturnType<typeof createCompatibilityResource>;
  readonly dataConnectors: ReturnType<typeof createDataConnectorResource>;
  readonly delegatedOAuth: ReturnType<typeof createDelegatedOAuthResource>;
  readonly deviceAuthorizations: ReturnType<
    typeof createDeviceAuthorizationResource
  >;
  readonly evals: ReturnType<typeof createEvalResource>;
  readonly files: ReturnType<typeof createFileResource>;
  readonly governance: ReturnType<typeof createGovernanceResource>;
  readonly knowledge: ReturnType<typeof createKnowledgeResource>;
  readonly notifications: ReturnType<typeof createNotificationResource>;
  readonly provider: ReturnType<typeof createProviderResource>;
  readonly scim: ReturnType<typeof createScimResource>;
  readonly sessions: ReturnType<typeof createSessionResource>;
  readonly system: ReturnType<typeof createSystemResource>;
  readonly tool: ReturnType<typeof createToolResource>;
  readonly voice: ReturnType<typeof createVoiceResource>;
  readonly webhooks: ReturnType<typeof createWebhookResource>;
  readonly workflows: ReturnType<typeof createWorkflowResource>;

  constructor(options: RomeoClientOptions) {
    this.transport = new RomeoTransport(options);
    this.admin = createAdminResource(this.transport);
    this.agent = createAgentResource(this.transport);
    this.channels = createChannelResource(this.transport);
    this.chatApi = createChatResource(this.transport);
    this.collaboration = createCollaborationResource(this.transport);
    this.compatibility = createCompatibilityResource(this.transport);
    this.dataConnectors = createDataConnectorResource(this.transport);
    this.delegatedOAuth = createDelegatedOAuthResource(this.transport);
    this.deviceAuthorizations = createDeviceAuthorizationResource(
      this.transport,
    );
    this.evals = createEvalResource(this.transport);
    this.files = createFileResource(this.transport);
    this.governance = createGovernanceResource(this.transport);
    this.knowledge = createKnowledgeResource(this.transport);
    this.notifications = createNotificationResource(this.transport);
    this.provider = createProviderResource(this.transport);
    this.scim = createScimResource(this.transport);
    this.sessions = createSessionResource(this.transport);
    this.system = createSystemResource(this.transport);
    this.tool = createToolResource(this.transport);
    this.voice = createVoiceResource(this.transport);
    this.webhooks = createWebhookResource(this.transport);
    this.workflows = createWorkflowResource(this.transport);
  }

  me() {
    return this.system.me();
  }

  updateMyProfile(input: UpdateMyProfileInput) {
    return this.system.updateMyProfile(input);
  }

  organizations() {
    return this.system.organizations();
  }

  workspaces() {
    return this.system.workspaces();
  }

  createWorkspace(input: CreateWorkspaceInput) {
    return this.system.createWorkspace(input);
  }

  listFiles(workspaceId?: string) {
    return this.files.list(workspaceId);
  }

  createFile(input: CreateFileInput) {
    return this.files.create(input);
  }

  createFileUploadSession(input: CreateFileUploadSessionInput) {
    return this.files.createUploadSession(input);
  }

  createFileResumableUploadSession(
    input: CreateFileResumableUploadSessionInput,
  ) {
    return this.files.createResumableUploadSession(input);
  }

  fileResumableUploadSession(fileId: string) {
    return this.files.resumableUploadSession(fileId);
  }

  completeFileResumableUploadSession(fileId: string) {
    return this.files.completeResumableUploadSession(fileId);
  }

  cancelFileResumableUploadSession(fileId: string) {
    return this.files.cancelResumableUploadSession(fileId);
  }

  fileUploadSession(fileId: string) {
    return this.files.uploadSession(fileId);
  }

  completeFileUploadSession(fileId: string) {
    return this.files.completeUploadSession(fileId);
  }

  cancelFileUploadSession(fileId: string) {
    return this.files.cancelUploadSession(fileId);
  }

  file(fileId: string) {
    return this.files.get(fileId);
  }

  fileContent(fileId: string) {
    return this.files.content(fileId);
  }

  deleteFile(fileId: string) {
    return this.files.delete(fileId);
  }

  archiveWorkspace(workspaceId: string) {
    return this.system.archiveWorkspace(workspaceId);
  }

  exportWorkspace(workspaceId: string) {
    return this.system.exportWorkspace(workspaceId);
  }

  providers() {
    return this.provider.list();
  }

  createProvider(input: CreateProviderInput) {
    return this.provider.create(input);
  }

  models() {
    return this.provider.models();
  }

  openAiModels() {
    return this.compatibility.models();
  }

  openAiModel(model: string) {
    return this.compatibility.model(model);
  }

  openWebUiConfig() {
    return this.compatibility.openWebUiConfig();
  }

  openWebUiSessionUser() {
    return this.compatibility.openWebUiSessionUser();
  }

  openWebUiChats(
    input: {
      includeFolders?: boolean;
      includePinned?: boolean;
      page?: number;
    } = {},
  ) {
    return this.compatibility.openWebUiChats(input);
  }

  openWebUiCreateChat(input: OpenWebUiCreateChatInput) {
    return this.compatibility.openWebUiCreateChat(input);
  }

  openWebUiPinnedChats() {
    return this.compatibility.openWebUiPinnedChats();
  }

  openWebUiChatPinnedStatus(chatId: string) {
    return this.compatibility.openWebUiChatPinnedStatus(chatId);
  }

  openWebUiToggleChatPinned(chatId: string) {
    return this.compatibility.openWebUiToggleChatPinned(chatId);
  }

  openWebUiSearchChats(text: string, page?: number) {
    return this.compatibility.openWebUiSearchChats(text, page);
  }

  openWebUiArchivedChats(page?: number) {
    return this.compatibility.openWebUiArchivedChats(page);
  }

  openWebUiAllArchivedChats() {
    return this.compatibility.openWebUiAllArchivedChats();
  }

  openWebUiAllTags() {
    return this.compatibility.openWebUiAllTags();
  }

  openWebUiChatsByTag(name: string) {
    return this.compatibility.openWebUiChatsByTag(name);
  }

  openWebUiChatTags(chatId: string) {
    return this.compatibility.openWebUiChatTags(chatId);
  }

  openWebUiAddChatTag(chatId: string, name: string) {
    return this.compatibility.openWebUiAddChatTag(chatId, name);
  }

  openWebUiDeleteChatTag(chatId: string, name: string) {
    return this.compatibility.openWebUiDeleteChatTag(chatId, name);
  }

  openWebUiFolderChats(folderId: string) {
    return this.compatibility.openWebUiFolderChats(folderId);
  }

  openWebUiFolderChatList(folderId: string, page?: number) {
    return this.compatibility.openWebUiFolderChatList(folderId, page);
  }

  openWebUiUpdateChatFolder(
    chatId: string,
    input: OpenWebUiUpdateChatFolderInput,
  ) {
    return this.compatibility.openWebUiUpdateChatFolder(chatId, input);
  }

  openWebUiFolders() {
    return this.compatibility.openWebUiFolders();
  }

  openWebUiCreateFolder(input: OpenWebUiCreateFolderInput) {
    return this.compatibility.openWebUiCreateFolder(input);
  }

  openWebUiFolder(folderId: string) {
    return this.compatibility.openWebUiFolder(folderId);
  }

  openWebUiUpdateFolder(folderId: string, input: OpenWebUiUpdateFolderInput) {
    return this.compatibility.openWebUiUpdateFolder(folderId, input);
  }

  openWebUiUpdateFolderExpanded(folderId: string, isExpanded: boolean) {
    return this.compatibility.openWebUiUpdateFolderExpanded(
      folderId,
      isExpanded,
    );
  }

  openWebUiUpdateFolderParent(folderId: string, parentId?: string | null) {
    return this.compatibility.openWebUiUpdateFolderParent(folderId, parentId);
  }

  openWebUiDeleteFolder(folderId: string, deleteContents = false) {
    return this.compatibility.openWebUiDeleteFolder(folderId, deleteContents);
  }

  openWebUiChannels() {
    return this.compatibility.openWebUiChannels();
  }

  openWebUiCreateChannel(input: OpenWebUiChannelInput) {
    return this.compatibility.openWebUiCreateChannel(input);
  }

  openWebUiDmChannelForUser(userId: string) {
    return this.compatibility.openWebUiDmChannelForUser(userId);
  }

  openWebUiChannel(channelId: string) {
    return this.compatibility.openWebUiChannel(channelId);
  }

  openWebUiChannelMembers(channelId: string) {
    return this.compatibility.openWebUiChannelMembers(channelId);
  }

  openWebUiChannelEvents(channelId: string): AsyncIterable<ServerSentEvent> {
    return this.compatibility.openWebUiChannelEvents(channelId);
  }

  openWebUiChannelMessages(
    channelId: string,
    input: { skip?: number; limit?: number } = {},
  ) {
    return this.compatibility.openWebUiChannelMessages(channelId, input);
  }

  openWebUiPinnedChannelMessages(channelId: string, page?: number) {
    return this.compatibility.openWebUiPinnedChannelMessages(channelId, page);
  }

  openWebUiChannelMessage(channelId: string, messageId: string) {
    return this.compatibility.openWebUiChannelMessage(channelId, messageId);
  }

  openWebUiChannelMessageData(channelId: string, messageId: string) {
    return this.compatibility.openWebUiChannelMessageData(channelId, messageId);
  }

  openWebUiChannelThreadMessages(
    channelId: string,
    messageId: string,
    input: { skip?: number; limit?: number } = {},
  ) {
    return this.compatibility.openWebUiChannelThreadMessages(
      channelId,
      messageId,
      input,
    );
  }

  openWebUiPostChannelMessage(
    channelId: string,
    input: OpenWebUiChannelMessageInput,
  ) {
    return this.compatibility.openWebUiPostChannelMessage(channelId, input);
  }

  openWebUiPinChannelMessage(
    channelId: string,
    messageId: string,
    isPinned: boolean,
  ) {
    return this.compatibility.openWebUiPinChannelMessage(
      channelId,
      messageId,
      isPinned,
    );
  }

  openWebUiUpdateChannelMessage(
    channelId: string,
    messageId: string,
    input: OpenWebUiChannelMessageInput,
  ) {
    return this.compatibility.openWebUiUpdateChannelMessage(
      channelId,
      messageId,
      input,
    );
  }

  openWebUiAddChannelMessageReaction(
    channelId: string,
    messageId: string,
    name: string,
  ) {
    return this.compatibility.openWebUiAddChannelMessageReaction(
      channelId,
      messageId,
      name,
    );
  }

  openWebUiRemoveChannelMessageReaction(
    channelId: string,
    messageId: string,
    name: string,
  ) {
    return this.compatibility.openWebUiRemoveChannelMessageReaction(
      channelId,
      messageId,
      name,
    );
  }

  openWebUiDeleteChannelMessage(channelId: string, messageId: string) {
    return this.compatibility.openWebUiDeleteChannelMessage(
      channelId,
      messageId,
    );
  }

  openWebUiMarkChannelRead(channelId: string) {
    return this.compatibility.openWebUiMarkChannelRead(channelId);
  }

  openWebUiUpdateChannelMemberActive(channelId: string, isActive: boolean) {
    return this.compatibility.openWebUiUpdateChannelMemberActive(
      channelId,
      isActive,
    );
  }

  openWebUiAddChannelMembers(
    channelId: string,
    input: Pick<OpenWebUiChannelInput, "group_ids" | "user_ids">,
  ) {
    return this.compatibility.openWebUiAddChannelMembers(channelId, input);
  }

  openWebUiRemoveChannelMembers(
    channelId: string,
    input: Pick<OpenWebUiChannelInput, "user_ids">,
  ) {
    return this.compatibility.openWebUiRemoveChannelMembers(channelId, input);
  }

  openWebUiUpdateChannel(channelId: string, input: OpenWebUiChannelInput) {
    return this.compatibility.openWebUiUpdateChannel(channelId, input);
  }

  openWebUiDeleteChannel(channelId: string) {
    return this.compatibility.openWebUiDeleteChannel(channelId);
  }

  openWebUiVersion() {
    return this.compatibility.openWebUiVersion();
  }

  openWebUiVersionUpdates() {
    return this.compatibility.openWebUiVersionUpdates();
  }

  agents(workspaceId?: string) {
    return this.agent.list(workspaceId);
  }

  agentById(agentId: string) {
    return this.agent.get(agentId);
  }

  createAgent(input: CreateAgentInput) {
    return this.agent.create(input);
  }

  updateAgent(agentId: string, input: UpdateAgentInput) {
    return this.agent.update(agentId, input);
  }

  cloneAgent(agentId: string, input: CloneAgentInput = {}) {
    return this.agent.clone(agentId, input);
  }

  exportAgent(agentId: string) {
    return this.agent.exportAgent(agentId);
  }

  importAgent(input: ImportAgentInput) {
    return this.agent.importAgent(input);
  }

  agentKnowledgeBindings(agentId: string) {
    return this.agent.knowledgeBindings(agentId);
  }

  updateAgentKnowledgeBinding(
    agentId: string,
    knowledgeBaseId: string,
    input: UpdateAgentKnowledgeBindingInput,
  ) {
    return this.agent.updateKnowledgeBinding(agentId, knowledgeBaseId, input);
  }

  agentVersions(agentId: string) {
    return this.agent.versions(agentId);
  }

  publishAgent(agentId: string) {
    return this.agent.publish(agentId);
  }

  diffAgentVersions(
    agentId: string,
    leftVersionId: string,
    rightVersionId: string,
  ) {
    return this.agent.diffVersions(agentId, leftVersionId, rightVersionId);
  }

  rollbackAgent(agentId: string, versionId: string) {
    return this.agent.rollback(agentId, versionId);
  }

  chats(input?: string | ListChatsInput) {
    return this.chatApi.list(input);
  }

  createChat(input: CreateChatInput) {
    return this.chatApi.create(input);
  }

  chatCompletions(input: OpenAiChatCompletionInput) {
    return this.compatibility.chatCompletions(input);
  }

  embeddings(input: OpenAiEmbeddingInput) {
    return this.compatibility.embeddings(input);
  }

  chat(chatId: string) {
    return this.chatApi.get(chatId);
  }

  updateChat(chatId: string, input: UpdateChatInput) {
    return this.chatApi.update(chatId, input);
  }

  archiveChat(chatId: string) {
    return this.chatApi.archive(chatId);
  }

  chatTags() {
    return this.chatApi.tags();
  }

  taggedChats(
    tagSlug: string,
    input: { archived?: "active" | "all" | "archived" } = {},
  ) {
    return this.chatApi.taggedChats(tagSlug, input);
  }

  chatTagAssignments(chatId: string) {
    return this.chatApi.tagAssignments(chatId);
  }

  assignChatTag(chatId: string, input: AssignChatTagInput) {
    return this.chatApi.assignTag(chatId, input);
  }

  removeChatTag(chatId: string, tagSlug: string) {
    return this.chatApi.removeTag(chatId, tagSlug);
  }

  deleteChatPreview(chatId: string) {
    return this.chatApi.deletePreview(chatId);
  }

  deleteChat(chatId: string, input: DeleteChatInput) {
    return this.chatApi.delete(chatId, input);
  }

  listChannels() {
    return this.channels.list();
  }

  createChannel(input: CreateChannelInput) {
    return this.channels.create(input);
  }

  directMessageChannel(input: CreateDirectMessageChannelInput) {
    return this.channels.directMessage(input);
  }

  channel(channelId: string) {
    return this.channels.get(channelId);
  }

  updateChannel(channelId: string, input: UpdateChannelInput) {
    return this.channels.update(channelId, input);
  }

  deleteChannel(channelId: string) {
    return this.channels.delete(channelId);
  }

  channelMembers(channelId: string) {
    return this.channels.members(channelId);
  }

  addChannelMembers(channelId: string, input: AddChannelMembersInput) {
    return this.channels.addMembers(channelId, input);
  }

  removeChannelMember(channelId: string, userId: string) {
    return this.channels.removeMember(channelId, userId);
  }

  channelMessages(channelId: string, query: ChannelMessageQuery = {}) {
    return this.channels.messages(channelId, query);
  }

  postChannelMessage(channelId: string, input: CreateChannelMessageInput) {
    return this.channels.postMessage(channelId, input);
  }

  channelMessage(channelId: string, messageId: string) {
    return this.channels.message(channelId, messageId);
  }

  updateChannelMessage(
    channelId: string,
    messageId: string,
    input: CreateChannelMessageInput,
  ) {
    return this.channels.updateMessage(channelId, messageId, input);
  }

  deleteChannelMessage(channelId: string, messageId: string) {
    return this.channels.deleteMessage(channelId, messageId);
  }

  threadChannelMessages(
    channelId: string,
    messageId: string,
    query: ChannelMessageQuery = {},
  ) {
    return this.channels.threadMessages(channelId, messageId, query);
  }

  pinnedChannelMessages(channelId: string, page?: number) {
    return this.channels.pinnedMessages(channelId, page);
  }

  pinChannelMessage(
    channelId: string,
    messageId: string,
    input: PinChannelMessageInput,
  ) {
    return this.channels.pinMessage(channelId, messageId, input);
  }

  addChannelReaction(channelId: string, messageId: string, name: string) {
    return this.channels.addReaction(channelId, messageId, name);
  }

  removeChannelReaction(channelId: string, messageId: string, name: string) {
    return this.channels.removeReaction(channelId, messageId, name);
  }

  markChannelRead(channelId: string) {
    return this.channels.markRead(channelId);
  }

  async *channelEvents(channelId: string): AsyncIterable<ServerSentEvent> {
    yield* this.channels.events(channelId);
  }

  forkChat(chatId: string, input: ForkChatInput = {}) {
    return this.chatApi.fork(chatId, input);
  }

  unarchiveChat(chatId: string) {
    return this.chatApi.unarchive(chatId);
  }

  updateChatLegalHold(chatId: string, input: UpdateChatLegalHoldInput) {
    return this.chatApi.updateLegalHold(chatId, input);
  }

  messages(chatId: string) {
    return this.chatApi.messages(chatId);
  }

  messageFeedbackList(chatId: string) {
    return this.chatApi.messageFeedbackList(chatId);
  }

  messageFeedback(chatId: string, messageId: string) {
    return this.chatApi.messageFeedback(chatId, messageId);
  }

  updateMessageFeedback(
    chatId: string,
    messageId: string,
    input: UpdateMessageFeedbackInput,
  ) {
    return this.chatApi.updateMessageFeedback(chatId, messageId, input);
  }

  chatComments(chatId: string) {
    return this.chatApi.comments(chatId);
  }

  startRun(input: StartRunInput) {
    return this.chatApi.startRun(input);
  }

  run(runId: string) {
    return this.chatApi.run(runId);
  }

  cancelRun(runId: string) {
    return this.chatApi.cancelRun(runId);
  }

  async *runEvents(runId: string): AsyncIterable<ServerSentEvent> {
    yield* this.transport.events(
      `/api/v1/runs/${encodeURIComponent(runId)}/events`,
    );
  }

  startOidcLogin(input: StartOidcLoginInput = {}) {
    return this.sessions.startOidcLogin(input);
  }

  startOAuth2Login(input: StartOAuth2LoginInput) {
    return this.sessions.startOAuth2Login(input);
  }

  startSamlLogin(input: StartSamlLoginInput = {}) {
    return this.sessions.startSamlLogin(input);
  }

  authProviderCatalog() {
    return this.admin.authProviderCatalog();
  }

  authProviderSettings() {
    return this.admin.authProviderSettings();
  }

  updateAuthProviderSettings(input: UpdateAuthProviderSettingsInput) {
    return this.admin.updateAuthProviderSettings(input);
  }

  testAuthProviderConnection(input: AuthProviderConnectionTestInput) {
    return this.admin.testAuthProviderConnection(input);
  }

  createManagedSecret(input: CreateManagedSecretInput) {
    return this.admin.createManagedSecret(input);
  }

  identityLifecyclePolicy() {
    return this.governance.identityLifecyclePolicy();
  }

  localLogin(input: LocalLoginInput) {
    return this.sessions.localLogin(input);
  }

  ldapLogin(input: LdapLoginInput) {
    return this.sessions.ldapLogin(input);
  }

  verifyLocalMfa(input: LocalMfaVerifyInput) {
    return this.sessions.verifyLocalMfa(input);
  }

  localAuthStatus() {
    return this.sessions.localAuthStatus();
  }

  setLocalPassword(input: SetLocalPasswordInput) {
    return this.sessions.setLocalPassword(input);
  }

  startTotpEnrollment(input: TotpEnrollmentInput = {}) {
    return this.sessions.startTotpEnrollment(input);
  }

  confirmTotpEnrollment(input: TotpConfirmInput) {
    return this.sessions.confirmTotpEnrollment(input);
  }

  generateRecoveryCodes(input: GenerateRecoveryCodesInput) {
    return this.sessions.generateRecoveryCodes(input);
  }

  disableMfaFactor(factorId: string, input: TotpDisableInput = {}) {
    return this.sessions.disableMfaFactor(factorId, input);
  }
}
