import { Button, Input, NativeSelect, Popover } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus.mjs";
import ListFilter from "lucide-react/dist/esm/icons/list-filter.mjs";
import MessageSquare from "lucide-react/dist/esm/icons/message-square.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Shield from "lucide-react/dist/esm/icons/shield.mjs";
import SquarePen from "lucide-react/dist/esm/icons/square-pen.mjs";
import Star from "lucide-react/dist/esm/icons/star.mjs";
import { useEffect, useMemo, useRef, useState } from "react";

import appPackage from "../../package.json";
import {
  chatExportUrl,
  deleteFavorite,
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
import { useLocale } from "../lib/i18n";
import { CatalogPager } from "./CatalogPager";
import { useConfirm } from "./ConfirmDialog";
import { OverflowMenu } from "./OverflowMenu";
import { SidebarBrand, SidebarFrame } from "./SidebarFrame";
import { useSidebarResize } from "./useSidebarResize";
import {
  WorkspaceNavDialogs,
  type WorkspaceNavDialog,
} from "./WorkspaceNavDialogs";
import {
  downloadChatMarkdown,
  parsePortableChat,
} from "./workspace-nav-portability";

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
  const [dialog, setDialog] = useState<WorkspaceNavDialog>(null);
  const [importError, setImportError] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const { ask, dialog: confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const resizeSidebar = useSidebarResize();
  const normalizedSearch = search.trim();
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
    queryKey: ["chatSearch", props.workspaceId, normalizedSearch],
    queryFn: () => searchChats(props.workspaceId!, normalizedSearch),
    enabled: props.workspaceId !== undefined && normalizedSearch.length >= 2,
  });
  const foldersQuery = useQuery({
    queryKey: ["folders", props.workspaceId],
    queryFn: () => listFolders(props.workspaceId!),
    enabled: props.workspaceId !== undefined,
  });
  const folderItemsQuery = useQuery({
    queryKey: ["folderItems", selectedFolder],
    queryFn: () => listFolderItems(selectedFolder),
    enabled: selectedFolder.length > 0,
  });

  const chatFavorites = useMemo(
    () =>
      new Map(
        (favoritesQuery.data ?? [])
          .filter((item) => item.resourceType === "chat")
          .map((item) => [item.resourceId, item]),
      ),
    [favoritesQuery.data],
  );
  const folderChatIds = useMemo(
    () =>
      new Set(
        (folderItemsQuery.data ?? [])
          .filter((item) => item.resourceType === "chat")
          .map((item) => item.resourceId),
      ),
    [folderItemsQuery.data],
  );
  const visibleChats = useMemo(() => {
    const source =
      normalizedSearch.length >= 2
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
    normalizedSearch,
    props.chats,
    searchQuery.data,
    selectedFolder,
    selectedTag,
    taggedChatsQuery.data,
  ]);
  const chatCatalog = catalogPage(visibleChats, {
    page: chatPage,
    pageSize: 50,
  });

  useEffect(
    () => setChatPage(0),
    [normalizedSearch, props.workspaceId, selectedFolder, selectedTag],
  );

  async function confirmDeleteChat(chat: Chat) {
    const confirmed = await ask({
      title: t("deleteChatTitle"),
      body: `${t("deleteChatBodyPrefix")} "${chat.title}"${t("deleteChatBodySuffix")}`,
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (confirmed) props.onDeleteChat(chat.id);
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
          orientation="vertical"
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
              void importConversation(file).catch(() =>
                setImportError(t("importFailed")),
              );
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
          <label className="rm-sidebar-search">
            <Search aria-hidden="true" size={13} />
            <Input
              aria-label={t("searchChats")}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder={t("searchChats")}
              value={search}
            />
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
        <div className="rm-sidebar-list">
          {chatCatalog.total === 0 ? (
            <div className="rm-sidebar-empty">
              {search ? t("noMatchingChats") : t("noChats")}
            </div>
          ) : (
            chatCatalog.items.map((chat) => (
              <ChatNavItem
                active={chat.id === props.activeChatId}
                chat={chat}
                folders={foldersQuery.data ?? []}
                key={chat.id}
                onDelete={() => void confirmDeleteChat(chat)}
                onDialog={setDialog}
                onExportMarkdown={() => void downloadChatMarkdown(chat)}
                onSelect={() => props.onSelectChat(chat.id)}
                onTogglePin={() => void toggleChatPin(chat.id)}
                pinned={chatFavorites.has(chat.id)}
              />
            ))
          )}
          <CatalogPager
            onPageChange={setChatPage}
            page={chatCatalog.page}
            pageSize={50}
            total={chatCatalog.total}
          />
          {props.hasMoreChats && normalizedSearch.length < 2 && !selectedTag ? (
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
        onRenameChat={props.onRenameChat}
        tags={tagsQuery.data ?? []}
        workspaceId={props.workspaceId}
      />
      {confirmDialog}
    </SidebarFrame>
  );
}

interface ChatNavItemProps {
  active: boolean;
  chat: Chat;
  folders: Array<{ id: string; name: string }>;
  onDelete: () => void;
  onDialog: (dialog: WorkspaceNavDialog) => void;
  onExportMarkdown: () => void;
  onSelect: () => void;
  onTogglePin: () => void;
  pinned: boolean;
}

function ChatNavItem(props: ChatNavItemProps) {
  const { t } = useLocale();
  return (
    <div
      className={`rm-sidebar-item ${props.active ? "active" : ""}`}
      data-chat-id={props.chat.id}
    >
      <Button
        aria-current={props.active ? "page" : undefined}
        className="rm-sidebar-item-label truncate"
        onClick={props.onSelect}
        type="button"
      >
        {props.pinned ? (
          <Star
            aria-hidden="true"
            className="rm-chat-pin"
            fill="currentColor"
            size={11}
          />
        ) : null}
        {props.chat.title}
      </Button>
      <OverflowMenu
        items={[
          {
            label: props.pinned ? t("unpin") : t("pin"),
            onClick: props.onTogglePin,
          },
          {
            label: t("rename"),
            onClick: () => props.onDialog({ kind: "rename", chat: props.chat }),
          },
          {
            label: t("share"),
            onClick: () => props.onDialog({ kind: "share", chat: props.chat }),
          },
          { label: t("exportMarkdown"), onClick: props.onExportMarkdown },
          {
            label: t("exportJson"),
            onClick: () =>
              window.open(
                chatExportUrl(props.chat.id),
                "_blank",
                "noopener,noreferrer",
              ),
          },
          {
            label: t("exportHtml"),
            onClick: () =>
              window.open(
                chatExportUrl(props.chat.id, "html"),
                "_blank",
                "noopener,noreferrer",
              ),
          },
          {
            label: t("addTag"),
            onClick: () => props.onDialog({ kind: "tag", chat: props.chat }),
          },
          ...(props.folders.length === 0
            ? []
            : [
                {
                  label: t("addToFolder"),
                  onClick: () =>
                    props.onDialog({
                      kind: "move",
                      chat: props.chat,
                      initialFolderId: props.folders[0]!.id,
                    }),
                },
              ]),
          { label: t("delete"), onClick: props.onDelete, tone: "danger" },
        ]}
        label={`${t("chatActionsFor")} ${props.chat.title}`}
        orientation="vertical"
      />
    </div>
  );
}
