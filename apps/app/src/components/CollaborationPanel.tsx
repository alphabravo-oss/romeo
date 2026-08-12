import { Button, Field, Input, Select, StatusBadge } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  addFolderItem,
  createFolder,
  favoriteResource,
  listChats,
  listFavorites,
  listFolderItems,
  listFolders,
  listKnowledgeBases,
  listShareTargets,
  shareChat,
  shareFolder,
  shareKnowledgeBase,
  type ShareTarget,
} from "../features";
import { listAgentGallery, shareAgent } from "../features/managed-models";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import type { Agent } from "../features/types";
import { AddButton } from "./AddButton";
import { resolveKnowledgeBaseBinding } from "./data-connector-binding";
import { FormDialog } from "./FormDialog";
import { ResourceRow } from "./ResourceRow";
import { SettingsSection } from "./SettingsSection";

export function CollaborationPanel({
  activeAgent,
  activeChatId,
  workspaceId,
}: {
  activeAgent: Agent | undefined;
  activeChatId: string | undefined;
  workspaceId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const [targetKey, setTargetKey] = useState("");
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] =
    useState<string>();
  const [selectedFolderId, setSelectedFolderId] = useState<string>();
  const [selectedChatId, setSelectedChatId] = useState<string>();
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);

  const targetsQuery = useQuery({
    queryKey: ["shareTargets", "collaboration"],
    queryFn: () => listShareTargets(),
  });
  const galleryQuery = useQuery({
    queryKey: ["agentGallery", workspaceId],
    queryFn: () => listAgentGallery(workspaceId),
    enabled: workspaceId !== undefined,
  });
  const favoritesQuery = useQuery({
    queryKey: ["favorites"],
    queryFn: listFavorites,
  });
  const knowledgeBasesQuery = useQuery({
    queryKey: ["knowledgeBases", workspaceId],
    queryFn: () => listKnowledgeBases(workspaceId!),
    enabled: workspaceId !== undefined,
  });
  const foldersQuery = useQuery({
    queryKey: ["folders", workspaceId],
    queryFn: () => listFolders(workspaceId!),
    enabled: workspaceId !== undefined,
  });
  const chatsQuery = useQuery({
    queryKey: ["chats", workspaceId, "collaboration"],
    queryFn: () => listChats(workspaceId!),
    enabled: workspaceId !== undefined,
  });

  const shareAgentMutation = useMutation({ mutationFn: shareAgent });
  const shareChatMutation = useMutation({ mutationFn: shareChat });
  const shareKnowledgeMutation = useMutation({
    mutationFn: shareKnowledgeBase,
  });
  const createFolderMutation = useMutation({ mutationFn: createFolder });
  const shareFolderMutation = useMutation({ mutationFn: shareFolder });
  const addFolderItemMutation = useMutation({ mutationFn: addFolderItem });
  const favoriteMutation = useMutation({ mutationFn: favoriteResource });

  const targets = targetsQuery.data ?? [];
  const folders = foldersQuery.data ?? [];
  const chats = chatsQuery.data ?? [];
  const knowledgeBases = knowledgeBasesQuery.data ?? [];
  const gallery = galleryQuery.data ?? [];

  const selectedTarget = useMemo(
    () => targets.find((target) => shareTargetKey(target) === targetKey),
    [targetKey, targets],
  );
  const activeFolder =
    folders.find((folder) => folder.id === selectedFolderId) ?? folders[0];
  const folderItemsQuery = useQuery({
    queryKey: ["folderItems", activeFolder?.id],
    queryFn: () => listFolderItems(activeFolder!.id),
    enabled: activeFolder !== undefined,
  });
  const chatId = selectedChatId ?? activeChatId ?? chats[0]?.id;
  const selectedChat = chats.find((chat) => chat.id === chatId);
  const activeAgentFavorite = (favoritesQuery.data ?? []).find(
    (favorite) =>
      favorite.resourceType === "agent" &&
      favorite.resourceId === activeAgent?.id,
  );

  async function handleShareAgent() {
    if (!activeAgent || selectedTarget === undefined) return;
    try {
      await shareAgentMutation.mutateAsync({
        agentId: activeAgent.id,
        principalId: selectedTarget.principalId,
        principalType: selectedTarget.principalType,
      });
      await queryClient.invalidateQueries({ queryKey: ["auditLogs"] });
      toast(t("workspaceShared"), "success");
    } catch {
      toast(t("workspaceCouldNotShareAgent"), "error");
    }
  }

  async function handleShareKnowledgeBase() {
    const binding = resolveKnowledgeBaseBinding({
      selectedKnowledgeBaseId,
      availableIds: knowledgeBases.map((base) => base.id),
    });
    if (!binding.ok || selectedTarget === undefined) return;
    try {
      await shareKnowledgeMutation.mutateAsync({
        knowledgeBaseId: binding.knowledgeBaseId,
        principalId: selectedTarget.principalId,
        principalType: selectedTarget.principalType,
      });
      await queryClient.invalidateQueries({ queryKey: ["auditLogs"] });
      toast(t("workspaceShared"), "success");
    } catch {
      toast(t("workspaceCouldNotShareKnowledge"), "error");
    }
  }

  async function handleShareChat() {
    if (chatId === undefined || selectedTarget === undefined) return;
    try {
      await shareChatMutation.mutateAsync({
        chatId,
        principalId: selectedTarget.principalId,
        principalType: selectedTarget.principalType,
      });
      await queryClient.invalidateQueries({ queryKey: ["auditLogs"] });
      toast(t("workspaceShared"), "success");
    } catch {
      toast(t("workspaceCouldNotShareChat"), "error");
    }
  }

  async function handleFavoriteAgent() {
    if (!activeAgent) return;
    try {
      await favoriteMutation.mutateAsync({
        resourceType: "agent",
        resourceId: activeAgent.id,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["favorites"] }),
        queryClient.invalidateQueries({
          queryKey: ["agentGallery", workspaceId],
        }),
      ]);
      toast(t("workspaceFavorited"), "success");
    } catch {
      toast(t("workspaceCouldNotFavoriteAgent"), "error");
    }
  }

  async function handleShareFolder() {
    if (!activeFolder || selectedTarget === undefined) return;
    try {
      await shareFolderMutation.mutateAsync({
        folderId: activeFolder.id,
        principalId: selectedTarget.principalId,
        principalType: selectedTarget.principalType,
      });
      await queryClient.invalidateQueries({ queryKey: ["auditLogs"] });
      toast(t("workspaceShared"), "success");
    } catch {
      toast(t("workspaceCouldNotShareFolder"), "error");
    }
  }

  async function handleAddFolderItem(
    resourceType: "agent" | "chat" | "knowledge_base",
    resourceId: string | undefined,
  ) {
    if (!activeFolder || resourceId === undefined) return;
    try {
      await addFolderItemMutation.mutateAsync({
        folderId: activeFolder.id,
        resourceType,
        resourceId,
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["folderItems", activeFolder.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["auditLogs"] }),
      ]);
      toast(t("workspaceAdded"), "success");
    } catch {
      toast(t("workspaceCouldNotAddItem"), "error");
    }
  }

  const folderForm = useForm({
    defaultValues: { name: t("workspaceReviewPack") },
    onSubmit: async ({ value }) => {
      if (!workspaceId) return;
      try {
        const folder = await createFolderMutation.mutateAsync({
          workspaceId,
          name: value.name.trim(),
        });
        await queryClient.invalidateQueries({
          queryKey: ["folders", workspaceId],
        });
        setSelectedFolderId(folder.id);
        setFolderDialogOpen(false);
        folderForm.reset();
        toast(t("workspaceFolderCreated"), "success");
      } catch {
        toast(t("workspaceCouldNotCreateFolder"), "error");
      }
    },
  });

  const canShare = selectedTarget !== undefined;
  const selectedKnowledgeBase = knowledgeBases.find(
    (base) => base.id === selectedKnowledgeBaseId,
  );

  return (
    <div className="rm-console-page">
      <SettingsSection
        description={t("workspaceShareSectionHelp")}
        title={t("workspaceShareSection")}
      >
        <Field label={t("personOrGroup")}>
          <Select
            onValueChange={setTargetKey}
            options={targets.map((target) => ({
              label: `${target.label} (${target.principalType})`,
              value: shareTargetKey(target),
            }))}
            placeholder={t("selectShareTarget")}
            {...(targetKey === "" ? {} : { value: targetKey })}
          />
        </Field>
        {!targetsQuery.isPending && targets.length === 0 ? (
          <p className="rm-list-empty">{t("workspaceShareNoTargets")}</p>
        ) : null}

        <div className="rm-resource-list">
          <ResourceRow
            actions={
              <Button
                disabled={
                  !activeAgent || !canShare || shareAgentMutation.isPending
                }
                onClick={() => void handleShareAgent()}
                size="sm"
                type="button"
              >
                {t("workspaceShare")}
              </Button>
            }
            disabled={!activeAgent}
            meta={
              activeAgent
                ? t("workspaceShareSelectedModel")
                : t("workspaceShareSelectModel")
            }
            title={activeAgent?.name ?? t("workspaceAgent")}
          />
          <ResourceRow
            actions={
              <Button
                disabled={
                  chatId === undefined ||
                  !canShare ||
                  shareChatMutation.isPending
                }
                onClick={() => void handleShareChat()}
                size="sm"
                type="button"
              >
                {t("workspaceShare")}
              </Button>
            }
            disabled={chats.length === 0}
            meta={
              chats.length === 0
                ? t("workspaceShareNoChats")
                : t("workspaceShareRecentChat")
            }
            title={selectedChat?.title ?? t("workspaceShareChat")}
          />
          {chats.length > 1 ? (
            <Field label={t("workspaceRecentChats")}>
              <Select
                onValueChange={setSelectedChatId}
                options={chats.slice(0, 12).map((chat) => ({
                  label: chat.title,
                  value: chat.id,
                }))}
                {...(chatId === undefined ? {} : { value: chatId })}
              />
            </Field>
          ) : null}
          <PanelState
            empty={t("dataConnectorNeedsKb")}
            emptyAction={
              <Button asChild variant="primary">
                <Link search={{ section: "knowledge" }} to="/workspace">
                  {t("knowledgeAddBase")}
                </Link>
              </Button>
            }
            query={knowledgeBasesQuery}
          >
            {(bases) => (
              <>
                <Field label={t("knowledgeBase")}>
                  <Select
                    onValueChange={setSelectedKnowledgeBaseId}
                    options={bases.map((base) => ({
                      label: base.name,
                      value: base.id,
                    }))}
                    placeholder={t("knowledgeBase")}
                    {...(selectedKnowledgeBaseId === undefined
                      ? {}
                      : { value: selectedKnowledgeBaseId })}
                  />
                </Field>
                <ResourceRow
                  actions={
                    <Button
                      disabled={
                        selectedKnowledgeBaseId === undefined ||
                        !canShare ||
                        shareKnowledgeMutation.isPending
                      }
                      onClick={() => void handleShareKnowledgeBase()}
                      size="sm"
                      type="button"
                    >
                      {t("workspaceShare")}
                    </Button>
                  }
                  disabled={selectedKnowledgeBaseId === undefined}
                  meta={
                    selectedKnowledgeBase
                      ? t("workspaceShareSelectedKnowledge")
                      : t("workspaceShareSelectKnowledge")
                  }
                  title={
                    selectedKnowledgeBase?.name ?? t("workspaceShareKnowledge")
                  }
                />
              </>
            )}
          </PanelState>
        </div>
      </SettingsSection>

      <SettingsSection
        actions={
          <AddButton onClick={() => setFolderDialogOpen(true)}>
            {t("workspaceNewFolder")}
          </AddButton>
        }
        description={t("workspaceFoldersHelp")}
        title={t("workspaceFolders")}
      >
        <PanelState
          empty={t("workspaceNoFolders")}
          emptyAction={
            <Button
              onClick={() => setFolderDialogOpen(true)}
              type="button"
              variant="primary"
            >
              {t("workspaceNewFolder")}
            </Button>
          }
          query={foldersQuery}
        >
          {(allFolders) => (
            <div className="rm-resource-list">
              {allFolders.map((folder) => (
                <ResourceRow
                  actions={
                    folder.id === activeFolder?.id ? (
                      <Button
                        data-testid="folder-share"
                        disabled={!canShare || shareFolderMutation.isPending}
                        onClick={() => void handleShareFolder()}
                        size="sm"
                        type="button"
                      >
                        {t("workspaceShare")}
                      </Button>
                    ) : null
                  }
                  key={folder.id}
                  meta={
                    folder.id === activeFolder?.id
                      ? t("workspaceFolderSelected")
                      : t("workspaceFolderOpen")
                  }
                  onSelect={() => setSelectedFolderId(folder.id)}
                  selected={folder.id === activeFolder?.id}
                  title={folder.name}
                />
              ))}
            </div>
          )}
        </PanelState>
        {activeFolder ? (
          <div className="grid gap-3" data-testid="folder-controls">
            <div className="rm-resource-row__actions rm-resource-row__actions--start">
              <Button
                data-testid="folder-add-chat"
                disabled={
                  chatId === undefined || addFolderItemMutation.isPending
                }
                onClick={() => void handleAddFolderItem("chat", chatId)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("workspaceAddChat")}
              </Button>
              <Button
                data-testid="folder-add-agent"
                disabled={!activeAgent || addFolderItemMutation.isPending}
                onClick={() =>
                  void handleAddFolderItem("agent", activeAgent?.id)
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("workspaceAddAgent")}
              </Button>
              <Button
                data-testid="folder-add-kb"
                disabled={
                  selectedKnowledgeBaseId === undefined ||
                  addFolderItemMutation.isPending
                }
                onClick={() =>
                  void handleAddFolderItem(
                    "knowledge_base",
                    selectedKnowledgeBaseId,
                  )
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("workspaceAddKnowledge")}
              </Button>
            </div>
            {(folderItemsQuery.data ?? []).length === 0 ? (
              <p className="rm-list-empty">{t("workspaceFolderEmpty")}</p>
            ) : (
              <div className="rm-resource-list">
                {(folderItemsQuery.data ?? []).map((item) => (
                  <ResourceRow
                    key={item.id}
                    meta={resolveFolderItemName(item, {
                      chats,
                      gallery,
                      knowledgeBases,
                    })}
                    title={t(resourceTypeMessageKey(item.resourceType))}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </SettingsSection>

      <FormDialog
        description={t("workspaceFoldersHelp")}
        onClose={() => setFolderDialogOpen(false)}
        open={folderDialogOpen}
        title={t("workspaceNewFolder")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void folderForm.handleSubmit();
          }}
        >
          <folderForm.Field
            name="name"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("workspaceNameRequired") : undefined,
            }}
          >
            {(field) => (
              <Field label={t("workspaceFolderName")} required>
                <Input
                  name="name"
                  aria-label={t("workspaceFolderName")}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </Field>
            )}
          </folderForm.Field>
          <folderForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <div className="rm-form-actions">
                <Button
                  onClick={() => setFolderDialogOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  {t("cancel")}
                </Button>
                <Button
                  data-testid="folder-create"
                  disabled={
                    !canSubmit ||
                    isSubmitting ||
                    !workspaceId ||
                    createFolderMutation.isPending
                  }
                  type="submit"
                  variant="primary"
                >
                  {t("workspaceCreateFolder")}
                </Button>
              </div>
            )}
          </folderForm.Subscribe>
        </form>
      </FormDialog>

      <SettingsSection
        description={t("workspaceDiscoverableHelp")}
        title={t("workspaceDiscoverableModels")}
      >
        <PanelState empty={t("workspaceNoDiscoverable")} query={galleryQuery}>
          {(agents) => (
            <div className="rm-resource-list">
              {agents.map((agent) => {
                const isActiveFavorite =
                  agent.id === activeAgent?.id &&
                  activeAgentFavorite !== undefined;
                return (
                  <ResourceRow
                    actions={
                      agent.id === activeAgent?.id ? (
                        <Button
                          disabled={
                            favoriteMutation.isPending || isActiveFavorite
                          }
                          onClick={() => void handleFavoriteAgent()}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          {isActiveFavorite
                            ? t("workspaceFavorited")
                            : t("workspaceFavoriteAgent")}
                        </Button>
                      ) : null
                    }
                    badge={
                      <StatusBadge
                        tone={agent.favorite ? "success" : "neutral"}
                      >
                        {agent.favorite
                          ? t("workspaceFavorite")
                          : t("workspaceDiscoverable")}
                      </StatusBadge>
                    }
                    key={agent.id}
                    title={agent.name}
                  />
                );
              })}
            </div>
          )}
        </PanelState>
      </SettingsSection>
    </div>
  );
}

function shareTargetKey(target: ShareTarget): string {
  return `${target.principalType}:${target.principalId}`;
}

function resolveFolderItemName(
  item: {
    resourceType: "agent" | "chat" | "knowledge_base";
    resourceId: string;
  },
  catalogs: {
    chats: Array<{ id: string; title: string }>;
    gallery: Array<{ id: string; name: string }>;
    knowledgeBases: Array<{ id: string; name: string }>;
  },
): string {
  if (item.resourceType === "agent") {
    return (
      catalogs.gallery.find((agent) => agent.id === item.resourceId)?.name ??
      item.resourceId
    );
  }
  if (item.resourceType === "chat") {
    return (
      catalogs.chats.find((chat) => chat.id === item.resourceId)?.title ??
      item.resourceId
    );
  }
  return (
    catalogs.knowledgeBases.find((base) => base.id === item.resourceId)?.name ??
    item.resourceId
  );
}

function resourceTypeMessageKey(
  resourceType: "agent" | "chat" | "knowledge_base",
): MessageKey {
  if (resourceType === "agent") return "workspaceResourceAgent";
  if (resourceType === "chat") return "workspaceResourceChat";
  return "workspaceResourceKnowledge";
}
