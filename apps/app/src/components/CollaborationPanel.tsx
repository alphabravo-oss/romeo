import { Button, Field, Input, Select } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  favoritesQueryOptions,
  folderItemsQueryOptions,
  foldersQueryOptions,
  shareTargetsQueryOptions,
} from "../features/collaboration/query-options";
import { chatsQueryOptions } from "../features/chats/query-options";
import { knowledgeBasesQueryOptions } from "../features/knowledge/query-options";
import {
  addFolderItemMutationOptions,
  createFolderMutationOptions,
  favoriteResourceMutationOptions,
  shareChatMutationOptions,
  shareFolderMutationOptions,
  shareKnowledgeBaseMutationOptions,
} from "../features/collaboration/mutation-options";
import { shareAgentMutationOptions } from "../features/managed-models/mutation-options";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { agentGalleryQueryOptions } from "../lib/api-query-options";
import { useRouterApiClient } from "../lib/router-context";
import type { Agent } from "../features/types";
import { resolveKnowledgeBaseBinding } from "./data-connector-binding";
import { FormDialog } from "./FormDialog";
import { ResourceRow } from "./ResourceRow";
import { Section } from "./console";
import { CollaborationFolderSection } from "./CollaborationFolderSection";
import { CollaborationDiscoverableModels } from "./CollaborationDiscoverableModels";
import { shareTargetKey } from "./collaboration-target";

export function CollaborationPanel({
  activeAgent,
  activeChatId,
  workspaceId,
}: {
  activeAgent: Agent | undefined;
  activeChatId: string | undefined;
  workspaceId: string | undefined;
}) {
  const apiClient = useRouterApiClient();
  const { t } = useLocale();
  const [targetKey, setTargetKey] = useState("");
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] =
    useState<string>();
  const [selectedFolderId, setSelectedFolderId] = useState<string>();
  const [selectedChatId, setSelectedChatId] = useState<string>();
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);

  const targetsQuery = useQuery(
    shareTargetsQueryOptions({ context: "collaboration" }),
  );
  const galleryQuery = useQuery(
    agentGalleryQueryOptions(workspaceId, apiClient),
  );
  const favoritesQuery = useQuery(favoritesQueryOptions());
  const knowledgeBasesQuery = useQuery(knowledgeBasesQueryOptions(workspaceId));
  const foldersQuery = useQuery(foldersQueryOptions(workspaceId));
  const chatsQuery = useQuery(chatsQueryOptions(workspaceId, "collaboration"));
  const shareAgentMutation = useMutation(shareAgentMutationOptions());
  const shareChatMutation = useMutation(shareChatMutationOptions());
  const shareKnowledgeMutation = useMutation(
    shareKnowledgeBaseMutationOptions(),
  );
  const createFolderMutation = useMutation(createFolderMutationOptions());
  const shareFolderMutation = useMutation(shareFolderMutationOptions());
  const addFolderItemMutation = useMutation(addFolderItemMutationOptions());
  const favoriteMutation = useMutation(favoriteResourceMutationOptions());
  const targets = targetsQuery.data ?? [];
  const folders = foldersQuery.data ?? [];
  const chats = chatsQuery.data ?? [];
  const knowledgeBases = knowledgeBasesQuery.data ?? [];
  const gallery = galleryQuery.data ?? [];

  const selectedTarget = targets.find(
    (target) => shareTargetKey(target) === targetKey,
  );
  const activeFolder =
    folders.find((folder) => folder.id === selectedFolderId) ?? folders[0];
  const folderItemsQuery = useQuery(folderItemsQueryOptions(activeFolder?.id));
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
      toast(t("workspaceShared"), "success");
    } catch {
      toast(t("workspaceCouldNotShareChat"), "error");
    }
  }

  async function handleFavoriteAgent() {
    if (!activeAgent || workspaceId === undefined) return;
    try {
      await favoriteMutation.mutateAsync({
        resourceType: "agent",
        resourceId: activeAgent.id,
        workspaceId,
      });
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
      toast(t("workspaceShared"), "success");
    } catch {
      toast(t("workspaceCouldNotShareFolder"), "error");
    }
  }

  async function handleAddFolderItem(
    resourceType: "agent" | "chat" | "knowledge_base",
    resourceId: string | undefined,
  ) {
    if (!activeFolder || resourceId === undefined || workspaceId === undefined)
      return;
    try {
      await addFolderItemMutation.mutateAsync({
        folderId: activeFolder.id,
        folderIds: folders.map((folder) => folder.id),
        resourceType,
        resourceId,
        workspaceId,
      });
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
      <Section
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
      </Section>

      <CollaborationFolderSection
        activeAgent={activeAgent}
        activeFolder={activeFolder}
        addPending={addFolderItemMutation.isPending}
        canShare={canShare}
        catalogs={{ chats, gallery, knowledgeBases }}
        chatId={chatId}
        folderItems={folderItemsQuery.data ?? []}
        foldersQuery={foldersQuery}
        onAddItem={(type, id) => void handleAddFolderItem(type, id)}
        onCreate={() => setFolderDialogOpen(true)}
        onSelect={setSelectedFolderId}
        onShare={() => void handleShareFolder()}
        selectedKnowledgeBaseId={selectedKnowledgeBaseId}
        sharePending={shareFolderMutation.isPending}
      />

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

      <CollaborationDiscoverableModels
        activeAgentId={activeAgent?.id}
        activeFavorite={activeAgentFavorite !== undefined}
        favoritePending={favoriteMutation.isPending}
        galleryQuery={galleryQuery}
        onFavorite={() => void handleFavoriteAgent()}
      />
    </div>
  );
}
