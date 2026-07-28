import { Input, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  addFolderItem,
  createFolder,
  favoriteResource,
  listFavorites,
  listFolderItems,
  listFolders,
  listKnowledgeBases,
  shareChat,
  shareFolder,
  shareKnowledgeBase,
} from "../features";
import { listAgentGallery, shareAgent } from "../features/managed-models";
import { useLocale, type MessageKey } from "../lib/i18n";
import { toast } from "../lib/toast";
import type { Agent } from "../features/types";

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
  const [principalId, setPrincipalId] = useState("group_reviewers");
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
  const shareAgentMutation = useMutation({ mutationFn: shareAgent });
  const shareChatMutation = useMutation({ mutationFn: shareChat });
  const shareKnowledgeMutation = useMutation({
    mutationFn: shareKnowledgeBase,
  });
  const createFolderMutation = useMutation({ mutationFn: createFolder });
  const shareFolderMutation = useMutation({ mutationFn: shareFolder });
  const addFolderItemMutation = useMutation({ mutationFn: addFolderItem });
  const favoriteMutation = useMutation({ mutationFn: favoriteResource });
  const firstKnowledgeBase = knowledgeBasesQuery.data?.[0];
  const activeFolder = foldersQuery.data?.[0];
  const folderItemsQuery = useQuery({
    queryKey: ["folderItems", activeFolder?.id],
    queryFn: () => listFolderItems(activeFolder!.id),
    enabled: activeFolder !== undefined,
  });
  const activeAgentFavorite = (favoritesQuery.data ?? []).find(
    (favorite) =>
      favorite.resourceType === "agent" &&
      favorite.resourceId === activeAgent?.id,
  );

  async function handleShareAgent() {
    if (!activeAgent) return;
    try {
      await shareAgentMutation.mutateAsync({
        agentId: activeAgent.id,
        principalId,
      });
      await queryClient.invalidateQueries({ queryKey: ["auditLogs"] });
      toast(t("workspaceShared"), "success");
    } catch {
      toast(t("workspaceCouldNotShareAgent"), "error");
    }
  }

  async function handleShareKnowledgeBase() {
    if (!firstKnowledgeBase) return;
    try {
      await shareKnowledgeMutation.mutateAsync({
        knowledgeBaseId: firstKnowledgeBase.id,
        principalId,
      });
      await queryClient.invalidateQueries({ queryKey: ["auditLogs"] });
      toast(t("workspaceShared"), "success");
    } catch {
      toast(t("workspaceCouldNotShareKnowledge"), "error");
    }
  }

  async function handleShareChat() {
    if (!activeChatId) return;
    try {
      await shareChatMutation.mutateAsync({
        chatId: activeChatId,
        principalId,
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
    if (!activeFolder) return;
    try {
      await shareFolderMutation.mutateAsync({
        folderId: activeFolder.id,
        principalId,
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
        await createFolderMutation.mutateAsync({
          workspaceId,
          name: value.name.trim(),
        });
        await queryClient.invalidateQueries({
          queryKey: ["folders", workspaceId],
        });
        toast(t("workspaceFolderCreated"), "success");
      } catch {
        toast(t("workspaceCouldNotCreateFolder"), "error");
      }
    },
  });

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">{t("workspaceCollaboration")}</div>
      <div className="grid gap-2 text-sm">
        <Input
          aria-label={t("workspaceSharePrincipal")}
          onChange={(event) => setPrincipalId(event.currentTarget.value)}
          value={principalId}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            disabled={!activeAgent || shareAgentMutation.isPending}
            onClick={() => void handleShareAgent()}
            type="button"
          >
            {t("workspaceShareAgent")}
          </Button>
          <Button
            disabled={!activeChatId || shareChatMutation.isPending}
            onClick={() => void handleShareChat()}
            type="button"
          >
            {t("workspaceShareChat")}
          </Button>
          <Button
            disabled={!firstKnowledgeBase || shareKnowledgeMutation.isPending}
            onClick={() => void handleShareKnowledgeBase()}
            type="button"
          >
            {t("workspaceShareKnowledge")}
          </Button>
        </div>
        <Button
          disabled={
            !activeAgent ||
            favoriteMutation.isPending ||
            activeAgentFavorite !== undefined
          }
          onClick={() => void handleFavoriteAgent()}
          type="button"
        >
          {activeAgentFavorite
            ? t("workspaceFavorited")
            : t("workspaceFavoriteAgent")}
        </Button>
      </div>
      <form
        className="mt-4 grid gap-2 text-sm"
        data-testid="folder-controls"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void folderForm.handleSubmit();
        }}
      >
        <div className="text-xs font-medium uppercase tracking-wide text-muted">
          {t("workspaceFolders")}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <folderForm.Field
            name="name"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("workspaceNameRequired") : undefined,
            }}
          >
            {(field) => (
              <>
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
              </>
            )}
          </folderForm.Field>
          <folderForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                data-testid="folder-create"
                disabled={
                  !canSubmit ||
                  isSubmitting ||
                  !workspaceId ||
                  createFolderMutation.isPending
                }
                type="submit"
              >
                {t("workspaceCreateFolder")}
              </Button>
            )}
          </folderForm.Subscribe>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            data-testid="folder-share"
            disabled={!activeFolder || shareFolderMutation.isPending}
            onClick={() => void handleShareFolder()}
            type="button"
          >
            {t("workspaceShareFolder")}
          </Button>
          <Button
            data-testid="folder-add-chat"
            disabled={
              !activeFolder || !activeChatId || addFolderItemMutation.isPending
            }
            onClick={() => void handleAddFolderItem("chat", activeChatId)}
            type="button"
          >
            {t("workspaceAddChat")}
          </Button>
          <Button
            data-testid="folder-add-agent"
            disabled={
              !activeFolder || !activeAgent || addFolderItemMutation.isPending
            }
            onClick={() => void handleAddFolderItem("agent", activeAgent?.id)}
            type="button"
          >
            {t("workspaceAddAgent")}
          </Button>
          <Button
            data-testid="folder-add-kb"
            disabled={
              !activeFolder ||
              !firstKnowledgeBase ||
              addFolderItemMutation.isPending
            }
            onClick={() =>
              void handleAddFolderItem("knowledge_base", firstKnowledgeBase?.id)
            }
            type="button"
          >
            {t("workspaceAddKnowledge")}
          </Button>
        </div>
        {activeFolder ? (
          <div className="text-muted">{activeFolder.name}</div>
        ) : null}
        <div className="grid gap-2">
          {(folderItemsQuery.data ?? []).slice(0, 4).map((item) => (
            <div className="rounded-md border border-border p-2" key={item.id}>
              <div className="font-medium">
                {t(resourceTypeMessageKey(item.resourceType))}
              </div>
              <div className="break-all text-muted">{item.resourceId}</div>
            </div>
          ))}
        </div>
      </form>
      <div className="mt-4 grid gap-2 text-sm">
        {(galleryQuery.data ?? []).slice(0, 4).map((agent) => (
          <div className="rounded-md border border-border p-2" key={agent.id}>
            <div className="font-medium">{agent.name}</div>
            <div className="text-muted">
              {agent.favorite
                ? t("workspaceFavorite")
                : t("workspaceDiscoverable")}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function resourceTypeMessageKey(
  resourceType: "agent" | "chat" | "knowledge_base",
): MessageKey {
  if (resourceType === "agent") return "workspaceResourceAgent";
  if (resourceType === "chat") return "workspaceResourceChat";
  return "workspaceResourceKnowledge";
}
