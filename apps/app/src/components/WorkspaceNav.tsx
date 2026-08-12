import { Button, Input, NativeSelect, Popover } from "@romeo/ui";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import Folder from "lucide-react/dist/esm/icons/folder.mjs";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open.mjs";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus.mjs";
import ListFilter from "lucide-react/dist/esm/icons/list-filter.mjs";
import MessageSquare from "lucide-react/dist/esm/icons/message-square.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Shield from "lucide-react/dist/esm/icons/shield.mjs";
import SquarePen from "lucide-react/dist/esm/icons/square-pen.mjs";
import { useEffect, useMemo, useRef, useState } from "react";

import appPackage from "../../package.json";
import {
  addFolderItem,
  deleteFavorite,
  deleteFolder,
  deleteFolderItem,
  favoriteResource,
  importChat,
  listChatTags,
  listChatsForTag,
  listFavorites,
  listFolderItems,
  listFolders,
  searchChats,
} from "../features";
import type { Chat } from "../features/types";
import { catalogPage } from "../lib/catalog-page";
import { useDebouncedValue } from "../lib/debounce";
import { useLocale, type MessageKey } from "../lib/i18n";
import { toast } from "../lib/toast";
import { CatalogPager } from "./CatalogPager";
import {
  groupChatsForSidebar,
  type ChatListSectionKey,
} from "./chat-list-sections";
import { useConfirm } from "./ConfirmDialog";
import { OverflowMenu } from "./OverflowMenu";
import { SidebarBrand, SidebarFrame } from "./SidebarFrame";
import { useSidebarResize } from "./useSidebarResize";
import {
  WorkspaceNavDialogs,
  type WorkspaceNavDialog,
} from "./WorkspaceNavDialogs";
import { CHAT_DRAG_MIME, WorkspaceChatNavItem } from "./WorkspaceChatNavItem";
import {
  downloadChatMarkdown,
  parsePortableChat,
  PortableChatImportError,
} from "./workspace-nav-portability";
import { resolveSidebarQueryState } from "./sidebar-query-state";

const SECTION_LABEL_KEYS = {
  pinned: "chatSectionPinned",
  today: "chatSectionToday",
  yesterday: "chatSectionYesterday",
  previous7Days: "chatSectionPrevious7Days",
  older: "chatSectionOlder",
} as const satisfies Record<ChatListSectionKey, MessageKey>;

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
  const queryClient = useQueryClient();
  const resizeSidebar = useSidebarResize();
  const addFolderItemMutation = useMutation({ mutationFn: addFolderItem });
  const deleteFolderMutation = useMutation({ mutationFn: deleteFolder });
  const deleteFolderItemMutation = useMutation({
    mutationFn: deleteFolderItem,
  });
  const normalizedInput = search.trim();
  const debouncedSearch = useDebouncedValue(normalizedInput, 250);
  const committedSearch =
    normalizedInput.length < 2 ? "" : debouncedSearch.trim();
  const searchPending =
    normalizedInput.length >= 2 && normalizedInput !== committedSearch;
  const favoritesQuery = useQuery({
    queryKey: ["favorites"],
    queryFn: listFavorites,
  });
  const favoriteMutation = useMutation({ mutationFn: favoriteResource });
  const deleteFavoriteMutation = useMutation({ mutationFn: deleteFavorite });
  const tagsQuery = useQuery({ queryKey: ["chatTags"], queryFn: listChatTags });
  const taggedChatsQuery = useQuery({
    queryKey: ["chatsByTag", selectedTag],
    queryFn: () => listChatsForTag(selectedTag),
    enabled: selectedTag.length > 0,
  });
  const searchQuery = useQuery({
    queryKey: ["chatSearch", props.workspaceId, committedSearch],
    queryFn: () => searchChats(props.workspaceId!, committedSearch),
    enabled: props.workspaceId !== undefined && committedSearch.length >= 2,
  });
  const foldersQuery = useQuery({
    queryKey: ["folders", props.workspaceId],
    queryFn: () => listFolders(props.workspaceId!),
    enabled: props.workspaceId !== undefined,
  });
  const folders = foldersQuery.data ?? [];
  const folderItemsQueries = useQueries({
    queries: folders.map((folder) => ({
      queryKey: ["folderItems", folder.id] as const,
      queryFn: () => listFolderItems(folder.id),
      enabled: folders.length > 0,
    })),
  });
  const folderItemsData = folderItemsQueries.map((query) => query.data);

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
    for (const [index, folder] of folders.entries()) {
      const items = folderItemsData[index] ?? [];
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
  }, [folderItemsData, folders]);
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

  const selectedFolderIndex = folders.findIndex(
    (folder) => folder.id === selectedFolder,
  );
  const selectedFolderItemsQuery =
    selectedFolderIndex >= 0
      ? folderItemsQueries[selectedFolderIndex]
      : undefined;
  const sourceQuery =
    committedSearch.length >= 2
      ? searchQuery
      : selectedTag
        ? taggedChatsQuery
        : selectedFolder.length > 0
          ? selectedFolderItemsQuery
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
    (foldersQuery.isError && foldersQuery.data === undefined);

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
    if (chatId.length === 0) return;
    try {
      await addFolderItemMutation.mutateAsync({
        folderId,
        resourceType: "chat",
        resourceId: chatId,
      });
      await queryClient.invalidateQueries({ queryKey: ["folderItems"] });
      toast(t("chatAddedToFolder"), "success");
      setSelectedFolder(folderId);
    } catch {
      toast(t("chatAddToFolderFailed"), "error");
    }
  }

  async function removeChatFromFolder(chatId: string) {
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
            itemId: entry.itemId,
          }),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ["folderItems"] });
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
      await deleteFolderMutation.mutateAsync(folder.id);
      if (selectedFolder === folder.id) setSelectedFolder("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["folders", props.workspaceId],
        }),
        queryClient.invalidateQueries({ queryKey: ["folderItems"] }),
      ]);
      toast(t("folderDeleted"), "success");
    } catch {
      toast(t("folderDeleteFailed"), "error");
    }
  }

  async function toggleChatPin(chatId: string) {
    const favorite = chatFavorites.get(chatId);
    if (favorite === undefined) {
      await favoriteMutation.mutateAsync({
        resourceType: "chat",
        resourceId: chatId,
      });
    } else {
      await deleteFavoriteMutation.mutateAsync(favorite.id);
    }
    await queryClient.invalidateQueries({ queryKey: ["favorites"] });
  }

  async function importConversation(file: File) {
    if (props.workspaceId === undefined) return;
    const payload = await parsePortableChat(file);
    const chat = await importChat({
      workspaceId: props.workspaceId,
      ...payload,
    });
    await queryClient.invalidateQueries({
      queryKey: ["chats", props.workspaceId],
    });
    props.onSelectChat(chat.id);
  }

  return (
    <SidebarFrame className="rm-sidebar">
      <SidebarBrand />
      <div className="rm-chat-create-row">
        <Button
          aria-label={t("newChat")}
          className="rm-new-chat-button"
          onClick={props.onNewChat}
          type="button"
        >
          <SquarePen aria-hidden="true" size={18} strokeWidth={2} />
          <span>{t("newChat")}</span>
        </Button>
        <OverflowMenu
          items={[
            {
              label: t("temporaryChat"),
              description: t("temporaryChatDescription"),
              onClick: props.onNewTemporaryChat,
            },
            {
              label: t("importChat"),
              description: t("importChatDescription"),
              onClick: () => importInputRef.current?.click(),
            },
          ]}
          label={t("moreChatActions")}
        />
        <Input
          accept="application/json,.json"
          hidden
          id="import-chat-file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            setImportError("");
            if (file) {
              void importConversation(file).catch((error: unknown) => {
                const key =
                  error instanceof PortableChatImportError
                    ? error.code === "file_too_large" ||
                      error.code === "attachment_budget_exceeded"
                      ? "importTooLarge"
                      : error.code === "no_messages"
                        ? "importNoMessages"
                        : "importFailed"
                    : "importFailed";
                setImportError(t(key));
              });
            }
          }}
          ref={importInputRef}
          type="file"
        />
      </div>
      {importError ? (
        <p className="px-3 text-xs text-danger" role="alert">
          {importError}
        </p>
      ) : null}

      <section className="rm-sidebar-section">
        <div className="rm-sidebar-label">
          <MessageSquare aria-hidden="true" size={13} />
          <span>{t("chats")}</span>
          <Button
            aria-label={t("createFolder")}
            className="rm-sidebar-label-action"
            onClick={() => setDialog({ kind: "create-folder" })}
            title={t("createFolder")}
            type="button"
          >
            <FolderPlus aria-hidden="true" size={13} />
          </Button>
        </div>
        <div className="rm-sidebar-search-row">
          <label
            aria-busy={searchPending || searchQuery.isFetching}
            className="rm-sidebar-search"
          >
            <Search aria-hidden="true" size={13} />
            <Input
              aria-label={t("searchChats")}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder={t("searchChats")}
              value={search}
            />
            {searchPending ? (
              <span className="rm-sidebar-search-pending" role="status">
                <span className="sr-only">{t("chatSearchPending")}</span>
              </span>
            ) : null}
          </label>
          <Popover
            align="end"
            className="rm-sidebar-filter-menu"
            trigger={
              <Button
                aria-label={`${t("filterByTag")} / ${t("filterByFolder")}`}
                className={`rm-sidebar-filter-trigger${selectedTag || selectedFolder ? " active" : ""}`}
                title={`${t("filterByTag")} / ${t("filterByFolder")}`}
                type="button"
              >
                <ListFilter aria-hidden="true" size={14} />
                {selectedTag || selectedFolder ? (
                  <span className="rm-sidebar-filter-count">
                    {Number(Boolean(selectedTag)) +
                      Number(Boolean(selectedFolder))}
                  </span>
                ) : null}
              </Button>
            }
          >
            <NativeSelect
              aria-label={t("filterByTag")}
              className="rm-sidebar-filter"
              disabled={
                (tagsQuery.isPending || tagsQuery.isError) &&
                tagsQuery.data === undefined
              }
              onChange={(event) => setSelectedTag(event.currentTarget.value)}
              value={selectedTag}
            >
              <option value="">{t("allTags")}</option>
              {(tagsQuery.data ?? []).map((tag) => (
                <option key={tag.id} value={tag.slug}>
                  {tag.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={t("filterByFolder")}
              className="rm-sidebar-filter"
              disabled={
                (foldersQuery.isPending || foldersQuery.isError) &&
                foldersQuery.data === undefined
              }
              onChange={(event) => setSelectedFolder(event.currentTarget.value)}
              value={selectedFolder}
            >
              <option value="">{t("allFolders")}</option>
              {(foldersQuery.data ?? []).map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </NativeSelect>
          </Popover>
        </div>
        {filterMetadataUnavailable ? (
          <div className="rm-sidebar-query-warning" role="status">
            {t("chatFiltersUnavailable")}
            <Button
              onClick={() =>
                void Promise.all([tagsQuery.refetch(), foldersQuery.refetch()])
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("tryAgain")}
            </Button>
          </div>
        ) : null}
        {(foldersQuery.data ?? []).length > 0 ? (
          <div
            className="rm-sidebar-folders"
            role="list"
            aria-label={t("folders")}
          >
            {(foldersQuery.data ?? []).map((folder) => {
              const active = selectedFolder === folder.id;
              const dropActive = dropTargetFolder === folder.id;
              return (
                <div
                  className={`rm-sidebar-folder${active ? " active" : ""}${dropActive ? " drop-target" : ""}`}
                  key={folder.id}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDropTargetFolder(folder.id);
                  }}
                  onDragLeave={(event) => {
                    if (
                      event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    ) {
                      return;
                    }
                    setDropTargetFolder((current) =>
                      current === folder.id ? "" : current,
                    );
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTargetFolder(folder.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDropTargetFolder("");
                    const chatId = event.dataTransfer.getData(CHAT_DRAG_MIME);
                    if (chatId.length > 0) {
                      void dropChatOnFolder(folder.id, chatId);
                    }
                  }}
                  role="listitem"
                >
                  <button
                    aria-pressed={active}
                    className="rm-sidebar-folder-select"
                    onClick={() =>
                      setSelectedFolder((current) =>
                        current === folder.id ? "" : folder.id,
                      )
                    }
                    title={t("dropChatOnFolder")}
                    type="button"
                  >
                    {active ? (
                      <FolderOpen aria-hidden="true" size={13} />
                    ) : (
                      <Folder aria-hidden="true" size={13} />
                    )}
                    <span className="truncate">{folder.name}</span>
                  </button>
                  <div className="rm-sidebar-folder-menu">
                    <OverflowMenu
                      items={[
                        {
                          label: t("rename"),
                          onClick: () =>
                            setDialog({
                              kind: "rename-folder",
                              folder: {
                                id: folder.id,
                                name: folder.name,
                              },
                            }),
                        },
                        {
                          label: t("delete"),
                          onClick: () => void confirmDeleteFolder(folder),
                          tone: "danger",
                        },
                      ]}
                      label={`${t("folderActionsFor")} ${folder.name}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="rm-sidebar-list">
          {sourceState === "error" ? (
            <div className="rm-sidebar-query-error" role="alert">
              <span>{t("chatSearchUnavailable")}</span>
              <Button
                onClick={() => void retrySidebarSource()}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("tryAgain")}
              </Button>
            </div>
          ) : chatCatalog.total === 0 ? (
            <div className="rm-sidebar-empty">
              {selectedFolder
                ? t("folderEmpty")
                : committedSearch
                  ? t("noMatchingChats")
                  : t("noChats")}
            </div>
          ) : (
            chatSections.map((section) => (
              <div className="rm-sidebar-chat-section" key={section.key}>
                {groupByDate ? (
                  <div className="rm-sidebar-time-label">
                    {t(SECTION_LABEL_KEYS[section.key])}
                  </div>
                ) : null}
                {section.chats.map((chat) => {
                  const memberships = chatFolderMembership.get(chat.id) ?? [];
                  const inFolder =
                    selectedFolder.length > 0
                      ? memberships.some(
                          (entry) => entry.folderId === selectedFolder,
                        )
                      : memberships.length > 0;
                  return (
                    <WorkspaceChatNavItem
                      active={chat.id === props.activeChatId}
                      chat={chat}
                      folders={folders}
                      inFolder={inFolder}
                      key={chat.id}
                      onDelete={() => void confirmDeleteChat(chat)}
                      onDialog={setDialog}
                      onExportMarkdown={() => void downloadChatMarkdown(chat)}
                      onRemoveFromFolder={
                        inFolder
                          ? () => void removeChatFromFolder(chat.id)
                          : undefined
                      }
                      onSelect={() => props.onSelectChat(chat.id)}
                      onTogglePin={() => void toggleChatPin(chat.id)}
                      pinned={chatFavorites.has(chat.id)}
                    />
                  );
                })}
              </div>
            ))
          )}
          <CatalogPager
            onPageChange={setChatPage}
            page={chatCatalog.page}
            pageSize={50}
            total={chatCatalog.total}
          />
          {props.hasMoreChats &&
          committedSearch.length < 2 &&
          !selectedTag &&
          !selectedFolder ? (
            <Button
              className="m-2"
              disabled={props.isLoadingMoreChats}
              onClick={props.onLoadMoreChats}
              type="button"
            >
              {props.isLoadingMoreChats
                ? t("loadingMoreChats")
                : `${t("loadMoreChats")} (${props.chats.length} of ${props.chatsTotal})`}
            </Button>
          ) : null}
        </div>
      </section>

      <div className="rm-sidebar-footer-stack">
        <Link className="rm-sidebar-footer" to="/workspace">
          <Bot aria-hidden="true" size={16} />
          <span>{t("workspace")}</span>
        </Link>
        {props.isAdmin ? (
          <Link className="rm-sidebar-footer" to="/admin">
            <Shield aria-hidden="true" size={16} />
            <span>{t("admin")}</span>
          </Link>
        ) : null}
        <div className="rm-sidebar-meta">
          <div className="rm-sidebar-version">Romeo v{appPackage.version}</div>
          <div className="rm-built-by">
            Built by{" "}
            <a href="https://alphabravo.io" rel="noreferrer" target="_blank">
              AlphaBravo
            </a>
          </div>
        </div>
      </div>
      <Button
        aria-label={t("resizeSidebar")}
        className="rm-sidebar-resizer"
        onMouseDown={resizeSidebar}
        type="button"
      />
      <WorkspaceNavDialogs
        dialog={dialog}
        folders={foldersQuery.data ?? []}
        onClose={() => setDialog(null)}
        onFolderCreated={(folderId) => setSelectedFolder(folderId)}
        onRenameChat={props.onRenameChat}
        tags={tagsQuery.data ?? []}
        workspaceId={props.workspaceId}
      />
      {confirmDialog}
    </SidebarFrame>
  );
}
