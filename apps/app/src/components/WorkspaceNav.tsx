import { useMutation, useQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import {
  collaborationListFolderItemsBatchOptions,
  folderItemGroupsById,
  chatSearchQueryOptions,
  chatTagsQueryOptions,
  chatsByTagQueryOptions,
  favoritesQueryOptions,
  folderItemsQueryOptions,
  foldersQueryOptions,
  shouldLoadFolderItemsOverflow,
} from "../features";
import {
  addFolderItemMutationOptions,
  deleteFavoriteMutationOptions,
  deleteFolderItemMutationOptions,
  deleteFolderMutationOptions,
  favoriteResourceMutationOptions,
} from "../features/collaboration/mutation-options";
import { importWorkspaceChatMutationOptions } from "../features/chats/mutation-options";
import type { Chat } from "../features/types";
import { catalogPage } from "../lib/catalog-page";
import { useDebouncedValue } from "../lib/debounce";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { groupChatsForSidebar } from "./chat-list-sections";
import { useConfirm } from "./ConfirmDialog";
import { SidebarBrand, SidebarFrame } from "./SidebarFrame";
import { SidebarResizer } from "./SidebarResizer";
import type { WorkspaceNavDialog } from "./WorkspaceNavDialogs";
import { LazyWorkspaceNavDialogs } from "./workspace-lazy-components";
import { parsePortableChat } from "./workspace-nav-portability";
import { resolveSidebarQueryState } from "./sidebar-query-state";
import {
  WorkspaceNavChatList,
  WorkspaceNavCreateControls,
  WorkspaceNavFilters,
  WorkspaceNavFolderList,
  WorkspaceNavFooter,
} from "./WorkspaceNavViews";

export interface WorkspaceNavProps {
  activeChatId: string | undefined;
  chats: Chat[];
  chatsTotal: number;
  hasMoreChats: boolean;
  isAdmin: boolean;
  isLoadingMoreChats: boolean;
  onDeleteChat: (chatId: string) => void;
  onLoadMoreChats: () => void;
  onNewChat: () => void;
  onNewTemporaryChat: () => void;
  onRenameChat: (chatId: string, title: string) => void;
  onSelectChat: (chatId: string) => void;
  workspaceId: string | undefined;
}

export function WorkspaceNav(props: WorkspaceNavProps) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const [chatPage, setChatPage] = useState(0);
  const [selectedTag, setSelectedTag] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [dropTargetFolder, setDropTargetFolder] = useState("");
  const [dialog, setDialog] = useState<WorkspaceNavDialog>(null);
  const [importError, setImportError] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const { ask, dialog: confirmDialog } = useConfirm();
  const addFolderItemMutation = useMutation(addFolderItemMutationOptions());
  const deleteFolderMutation = useMutation(deleteFolderMutationOptions());
  const deleteFolderItemMutation = useMutation(
    deleteFolderItemMutationOptions(),
  );
  const normalizedInput = search.trim();
  const debouncedSearch = useDebouncedValue(normalizedInput, 250);
  const committedSearch =
    normalizedInput.length < 2 ? "" : debouncedSearch.trim();
  const searchPending =
    normalizedInput.length >= 2 && normalizedInput !== committedSearch;
  const favoritesQuery = useQuery(favoritesQueryOptions());
  const favoriteMutation = useMutation(favoriteResourceMutationOptions());
  const deleteFavoriteMutation = useMutation(deleteFavoriteMutationOptions());
  const importChatMutation = useMutation(importWorkspaceChatMutationOptions());
  const tagsQuery = useQuery(chatTagsQueryOptions());
  const taggedChatsQuery = useQuery(chatsByTagQueryOptions(selectedTag));
  const searchQuery = useQuery(
    chatSearchQueryOptions(props.workspaceId, committedSearch),
  );
  const foldersQuery = useQuery(foldersQueryOptions(props.workspaceId));
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data]);
  const folderIds = useMemo(
    () => folders.map((folder) => folder.id),
    [folders],
  );
  const folderItemsBatchQuery = useQuery(
    collaborationListFolderItemsBatchOptions(
      props.workspaceId ?? "",
      folderIds,
      props.workspaceId !== undefined && folderIds.length > 0,
    ),
  );
  const folderGroups = useMemo(
    () => folderItemGroupsById(folderItemsBatchQuery.data ?? []),
    [folderItemsBatchQuery.data],
  );
  const selectedFolderGroup = folderGroups.get(selectedFolder);
  const shouldLoadSelectedFolderOverflow = shouldLoadFolderItemsOverflow(
    selectedFolder,
    selectedFolderGroup,
  );
  const selectedFolderItemsQuery = useQuery(
    folderItemsQueryOptions(
      selectedFolder || undefined,
      shouldLoadSelectedFolderOverflow,
    ),
  );

  const chatFavorites = useMemo(
    () =>
      new Map(
        (favoritesQuery.data ?? [])
          .filter((item) => item.resourceType === "chat")
          .map((item) => [item.resourceId, item]),
      ),
    [favoritesQuery.data],
  );
  const chatFolderMembership = useMemo(() => {
    const map = new Map<
      string,
      Array<{ folderId: string; itemId: string; folderName: string }>
    >();
    for (const folder of folders) {
      const group = folderGroups.get(folder.id);
      const items =
        folder.id === selectedFolder &&
        selectedFolderItemsQuery.data !== undefined
          ? selectedFolderItemsQuery.data
          : (group?.items ?? []);
      for (const item of items) {
        if (item.resourceType !== "chat") continue;
        const list = map.get(item.resourceId) ?? [];
        list.push({
          folderId: folder.id,
          itemId: item.id,
          folderName: folder.name,
        });
        map.set(item.resourceId, list);
      }
    }
    return map;
  }, [folderGroups, folders, selectedFolder, selectedFolderItemsQuery.data]);
  const folderChatIds = useMemo(() => {
    if (selectedFolder.length === 0) return new Set<string>();
    const ids = new Set<string>();
    for (const [chatId, memberships] of chatFolderMembership) {
      if (memberships.some((entry) => entry.folderId === selectedFolder)) {
        ids.add(chatId);
      }
    }
    return ids;
  }, [chatFolderMembership, selectedFolder]);
  const visibleChats = useMemo(() => {
    const source =
      committedSearch.length >= 2
        ? (searchQuery.data ?? [])
        : selectedTag
          ? (taggedChatsQuery.data ?? [])
          : props.chats;
    return source
      .filter((chat) => !selectedFolder || folderChatIds.has(chat.id))
      .slice()
      .sort(
        (left, right) =>
          Number(chatFavorites.has(right.id)) -
            Number(chatFavorites.has(left.id)) ||
          right.updatedAt.localeCompare(left.updatedAt),
      );
  }, [
    chatFavorites,
    folderChatIds,
    committedSearch,
    props.chats,
    searchQuery.data,
    selectedFolder,
    selectedTag,
    taggedChatsQuery.data,
  ]);
  const groupByDate = committedSearch.length < 2;
  const pinnedIds = useMemo(
    () => new Set(chatFavorites.keys()),
    [chatFavorites],
  );
  const chatCatalog = catalogPage(visibleChats, {
    page: chatPage,
    pageSize: 50,
  });
  const chatSections = useMemo(
    () =>
      groupChatsForSidebar(chatCatalog.items, {
        pinnedIds,
        groupByDate,
      }),
    [chatCatalog.items, groupByDate, pinnedIds],
  );

  useEffect(
    () => setChatPage(0),
    [committedSearch, props.workspaceId, selectedFolder, selectedTag],
  );
  useEffect(() => {
    if (
      tagsQuery.data !== undefined &&
      selectedTag !== "" &&
      !tagsQuery.data.some((tag) => tag.slug === selectedTag)
    ) {
      setSelectedTag("");
    }
  }, [selectedTag, tagsQuery.data]);
  useEffect(() => {
    if (
      foldersQuery.data !== undefined &&
      selectedFolder !== "" &&
      !foldersQuery.data.some((folder) => folder.id === selectedFolder)
    ) {
      setSelectedFolder("");
    }
  }, [foldersQuery.data, selectedFolder]);

  const sourceQuery =
    committedSearch.length >= 2
      ? searchQuery
      : selectedTag
        ? taggedChatsQuery
        : selectedFolder.length > 0
          ? shouldLoadSelectedFolderOverflow
            ? selectedFolderItemsQuery
            : folderItemsBatchQuery
          : undefined;
  const sourceState =
    sourceQuery === undefined
      ? "ready"
      : resolveSidebarQueryState({
          hasData: sourceQuery.data !== undefined,
          isError: sourceQuery.isError,
          isFetching: sourceQuery.isFetching,
          isPending: sourceQuery.isPending,
        });
  const filterMetadataUnavailable =
    (tagsQuery.isError && tagsQuery.data === undefined) ||
    (foldersQuery.isError && foldersQuery.data === undefined) ||
    (folderItemsBatchQuery.isError && folderItemsBatchQuery.data === undefined);

  async function retrySidebarSource() {
    await sourceQuery?.refetch();
  }

  async function confirmDeleteChat(chat: Chat) {
    const confirmed = await ask({
      title: t("deleteChatTitle"),
      body: `${t("deleteChatBodyPrefix")} "${chat.title}"${t("deleteChatBodySuffix")}`,
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (confirmed) props.onDeleteChat(chat.id);
  }

  async function dropChatOnFolder(folderId: string, chatId: string) {
    if (chatId.length === 0 || props.workspaceId === undefined) return;
    try {
      await addFolderItemMutation.mutateAsync({
        folderId,
        folderIds,
        resourceType: "chat",
        resourceId: chatId,
        workspaceId: props.workspaceId,
      });
      toast(t("chatAddedToFolder"), "success");
      setSelectedFolder(folderId);
    } catch {
      toast(t("chatAddToFolderFailed"), "error");
    }
  }

  async function removeChatFromFolder(chatId: string) {
    if (props.workspaceId === undefined) return;
    const workspaceId = props.workspaceId;
    const memberships = chatFolderMembership.get(chatId) ?? [];
    const targets =
      selectedFolder.length > 0
        ? memberships.filter((entry) => entry.folderId === selectedFolder)
        : memberships;
    if (targets.length === 0) return;
    try {
      await Promise.all(
        targets.map((entry) =>
          deleteFolderItemMutation.mutateAsync({
            folderId: entry.folderId,
            folderIds,
            itemId: entry.itemId,
            workspaceId,
          }),
        ),
      );
      toast(t("chatRemovedFromFolder"), "success");
    } catch {
      toast(t("chatRemoveFromFolderFailed"), "error");
    }
  }

  async function confirmDeleteFolder(folder: { id: string; name: string }) {
    const confirmed = await ask({
      title: t("deleteFolderTitle"),
      body: t("deleteFolderBody", { name: folder.name }),
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      if (props.workspaceId === undefined) return;
      await deleteFolderMutation.mutateAsync({
        folderId: folder.id,
        folderIds,
        workspaceId: props.workspaceId,
      });
      if (selectedFolder === folder.id) setSelectedFolder("");
      toast(t("folderDeleted"), "success");
    } catch {
      toast(t("folderDeleteFailed"), "error");
    }
  }

  async function toggleChatPin(chatId: string) {
    if (props.workspaceId === undefined) return;
    const favorite = chatFavorites.get(chatId);
    if (favorite === undefined) {
      await favoriteMutation.mutateAsync({
        resourceType: "chat",
        resourceId: chatId,
        workspaceId: props.workspaceId,
      });
    } else {
      await deleteFavoriteMutation.mutateAsync({
        favoriteId: favorite.id,
        workspaceId: props.workspaceId,
      });
    }
  }

  async function importConversation(file: File) {
    if (props.workspaceId === undefined) return;
    const payload = await parsePortableChat(file);
    const chat = await importChatMutation.mutateAsync({
      workspaceId: props.workspaceId,
      ...payload,
    });
    props.onSelectChat(chat.id);
  }

  return (
    <SidebarFrame className="rm-sidebar">
      <SidebarBrand />
      <WorkspaceNavCreateControls
        importError={importError}
        importInputRef={importInputRef}
        onImport={importConversation}
        onImportError={setImportError}
        onNewChat={props.onNewChat}
        onNewTemporaryChat={props.onNewTemporaryChat}
      />

      <section className="rm-sidebar-section">
        <WorkspaceNavFilters
          filterMetadataUnavailable={filterMetadataUnavailable}
          folders={foldersQuery.data ?? []}
          foldersUnavailable={
            (foldersQuery.isPending || foldersQuery.isError) &&
            foldersQuery.data === undefined
          }
          onCreateFolder={() => setDialog({ kind: "create-folder" })}
          onRetry={() =>
            void Promise.all([
              tagsQuery.refetch(),
              foldersQuery.refetch(),
              folderItemsBatchQuery.refetch(),
            ])
          }
          search={search}
          searchBusy={searchPending || searchQuery.isFetching}
          searchPending={searchPending}
          selectedFolder={selectedFolder}
          selectedTag={selectedTag}
          setSearch={setSearch}
          setSelectedFolder={setSelectedFolder}
          setSelectedTag={setSelectedTag}
          tags={tagsQuery.data ?? []}
          tagsUnavailable={
            (tagsQuery.isPending || tagsQuery.isError) &&
            tagsQuery.data === undefined
          }
        />
        <WorkspaceNavFolderList
          dropTargetFolder={dropTargetFolder}
          folders={foldersQuery.data ?? []}
          onDelete={(folder) => void confirmDeleteFolder(folder)}
          onDialog={setDialog}
          onDropChat={(folderId, chatId) =>
            void dropChatOnFolder(folderId, chatId)
          }
          selectedFolder={selectedFolder}
          setDropTargetFolder={setDropTargetFolder}
          setSelectedFolder={setSelectedFolder}
        />
        <WorkspaceNavChatList
          activeChatId={props.activeChatId}
          chatCatalog={chatCatalog}
          chatFavorites={chatFavorites}
          chatFolderMembership={chatFolderMembership}
          chatSections={chatSections}
          chatsLoaded={props.chats.length}
          chatsTotal={props.chatsTotal}
          committedSearch={committedSearch}
          folders={folders}
          groupByDate={groupByDate}
          hasMoreChats={props.hasMoreChats}
          isLoadingMoreChats={props.isLoadingMoreChats}
          onDelete={(chat) => void confirmDeleteChat(chat)}
          onDialog={setDialog}
          onLoadMore={props.onLoadMoreChats}
          onPageChange={setChatPage}
          onRemoveFromFolder={(chatId) => void removeChatFromFolder(chatId)}
          onRetry={() => void retrySidebarSource()}
          onSelect={props.onSelectChat}
          onTogglePin={(chatId) => void toggleChatPin(chatId)}
          selectedFolder={selectedFolder}
          selectedTag={selectedTag}
          sourceState={sourceState}
        />
      </section>

      <WorkspaceNavFooter isAdmin={props.isAdmin} />
      <SidebarResizer label={t("resizeSidebar")} />
      {dialog === null ? null : (
        <Suspense fallback={null}>
          <LazyWorkspaceNavDialogs
            dialog={dialog}
            folders={foldersQuery.data ?? []}
            onClose={() => setDialog(null)}
            onFolderCreated={(folderId) => setSelectedFolder(folderId)}
            onRenameChat={props.onRenameChat}
            tags={tagsQuery.data ?? []}
            workspaceId={props.workspaceId}
          />
        </Suspense>
      )}
      {confirmDialog}
    </SidebarFrame>
  );
}
