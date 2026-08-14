import { Button, Input, NativeSelect, Popover } from "@romeo/ui";
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
import type { Dispatch, RefObject, SetStateAction } from "react";

import appPackage from "../../package.json";
import type { ChatTag, WorkspaceFolder } from "../features";
import type { Chat } from "../features/types";
import { useLocale, type MessageKey } from "../lib/i18n";
import { CatalogPager } from "./CatalogPager";
import type { ChatListSection, ChatListSectionKey } from "./chat-list-sections";
import type { SidebarQueryState } from "./sidebar-query-state";
import { OverflowMenu } from "./OverflowMenu";
import type { WorkspaceNavDialog } from "./WorkspaceNavDialogs";
import { CHAT_DRAG_MIME, WorkspaceChatNavItem } from "./WorkspaceChatNavItem";
import { useWorkspaceIntentPrefetch } from "./useWorkspaceIntentPrefetch";
import { useWorkspace } from "./WorkspaceContext";
import {
  downloadChatMarkdown,
  PortableChatImportError,
} from "./workspace-nav-portability";

const SECTION_LABEL_KEYS = {
  pinned: "chatSectionPinned",
  today: "chatSectionToday",
  yesterday: "chatSectionYesterday",
  previous7Days: "chatSectionPrevious7Days",
  older: "chatSectionOlder",
} as const satisfies Record<ChatListSectionKey, MessageKey>;

export function WorkspaceNavCreateControls(props: {
  importError: string;
  importInputRef: RefObject<HTMLInputElement | null>;
  onImport: (file: File) => Promise<void>;
  onImportError: (message: string) => void;
  onNewChat: () => void;
  onNewTemporaryChat: () => void;
}) {
  const { t } = useLocale();
  return (
    <>
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
              onClick: () => props.importInputRef.current?.click(),
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
            props.onImportError("");
            if (file)
              void props.onImport(file).catch((error: unknown) => {
                const key =
                  error instanceof PortableChatImportError
                    ? error.code === "file_too_large" ||
                      error.code === "attachment_budget_exceeded"
                      ? "importTooLarge"
                      : error.code === "no_messages"
                        ? "importNoMessages"
                        : "importFailed"
                    : "importFailed";
                props.onImportError(t(key));
              });
          }}
          ref={props.importInputRef}
          type="file"
        />
      </div>
      {props.importError ? (
        <p className="px-3 text-xs text-danger" role="alert">
          {props.importError}
        </p>
      ) : null}
    </>
  );
}

export function WorkspaceNavFilters(props: {
  filterMetadataUnavailable: boolean;
  folders: WorkspaceFolder[];
  foldersUnavailable: boolean;
  onCreateFolder: () => void;
  onRetry: () => void;
  search: string;
  searchBusy: boolean;
  searchPending: boolean;
  selectedFolder: string;
  selectedTag: string;
  setSearch: (value: string) => void;
  setSelectedFolder: (value: string) => void;
  setSelectedTag: (value: string) => void;
  tags: ChatTag[];
  tagsUnavailable: boolean;
}) {
  const { t } = useLocale();
  return (
    <>
      <div className="rm-sidebar-label">
        <MessageSquare aria-hidden="true" size={13} />
        <span>{t("chats")}</span>
        <Button
          aria-label={t("createFolder")}
          className="rm-sidebar-label-action"
          onClick={props.onCreateFolder}
          title={t("createFolder")}
          type="button"
        >
          <FolderPlus aria-hidden="true" size={13} />
        </Button>
      </div>
      <div className="rm-sidebar-search-row">
        <label aria-busy={props.searchBusy} className="rm-sidebar-search">
          <Search aria-hidden="true" size={13} />
          <Input
            aria-label={t("searchChats")}
            onChange={(event) => props.setSearch(event.currentTarget.value)}
            placeholder={t("searchChats")}
            value={props.search}
          />
          {props.searchPending ? (
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
              className={`rm-sidebar-filter-trigger${props.selectedTag || props.selectedFolder ? " active" : ""}`}
              title={`${t("filterByTag")} / ${t("filterByFolder")}`}
              type="button"
            >
              <ListFilter aria-hidden="true" size={14} />
              {props.selectedTag || props.selectedFolder ? (
                <span className="rm-sidebar-filter-count">
                  {Number(Boolean(props.selectedTag)) +
                    Number(Boolean(props.selectedFolder))}
                </span>
              ) : null}
            </Button>
          }
        >
          <NativeSelect
            aria-label={t("filterByTag")}
            className="rm-sidebar-filter"
            disabled={props.tagsUnavailable}
            onChange={(event) =>
              props.setSelectedTag(event.currentTarget.value)
            }
            value={props.selectedTag}
          >
            <option value="">{t("allTags")}</option>
            {props.tags.map((tag) => (
              <option key={tag.id} value={tag.slug}>
                {tag.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label={t("filterByFolder")}
            className="rm-sidebar-filter"
            disabled={props.foldersUnavailable}
            onChange={(event) =>
              props.setSelectedFolder(event.currentTarget.value)
            }
            value={props.selectedFolder}
          >
            <option value="">{t("allFolders")}</option>
            {props.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </NativeSelect>
        </Popover>
      </div>
      {props.filterMetadataUnavailable ? (
        <div className="rm-sidebar-query-warning" role="status">
          {t("chatFiltersUnavailable")}
          <Button
            onClick={props.onRetry}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("tryAgain")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function WorkspaceNavFolderList(props: {
  dropTargetFolder: string;
  folders: WorkspaceFolder[];
  onDelete: (folder: WorkspaceFolder) => void;
  onDialog: Dispatch<SetStateAction<WorkspaceNavDialog>>;
  onDropChat: (folderId: string, chatId: string) => void;
  selectedFolder: string;
  setDropTargetFolder: Dispatch<SetStateAction<string>>;
  setSelectedFolder: Dispatch<SetStateAction<string>>;
}) {
  const { t } = useLocale();
  if (props.folders.length === 0) return null;
  return (
    <div className="rm-sidebar-folders" role="list" aria-label={t("folders")}>
      {props.folders.map((folder) => {
        const active = props.selectedFolder === folder.id;
        const dropActive = props.dropTargetFolder === folder.id;
        return (
          <div
            className={`rm-sidebar-folder${active ? " active" : ""}${dropActive ? " drop-target" : ""}`}
            key={folder.id}
            role="listitem"
          >
            <Button
              aria-controls="workspace-nav-chat-list"
              aria-expanded={active}
              aria-pressed={active}
              className="rm-sidebar-folder-select"
              onDragEnter={(event) => {
                event.preventDefault();
                props.setDropTargetFolder(folder.id);
              }}
              onDragLeave={(event) => {
                if (
                  event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  return;
                props.setDropTargetFolder((current) =>
                  current === folder.id ? "" : current,
                );
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                props.setDropTargetFolder(folder.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                props.setDropTargetFolder("");
                const chatId = event.dataTransfer.getData(CHAT_DRAG_MIME);
                if (chatId.length > 0) props.onDropChat(folder.id, chatId);
              }}
              onClick={() =>
                props.setSelectedFolder((current) =>
                  current === folder.id ? "" : folder.id,
                )
              }
              title={t("dropChatOnFolder")}
              type="button"
              variant="ghost"
            >
              {active ? (
                <FolderOpen aria-hidden="true" size={13} />
              ) : (
                <Folder aria-hidden="true" size={13} />
              )}
              <span className="truncate">{folder.name}</span>
            </Button>
            <div className="rm-sidebar-folder-menu">
              <OverflowMenu
                items={[
                  {
                    label: t("rename"),
                    onClick: () =>
                      props.onDialog({
                        kind: "rename-folder",
                        folder: { id: folder.id, name: folder.name },
                      }),
                  },
                  {
                    label: t("delete"),
                    onClick: () => props.onDelete(folder),
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
  );
}

export function WorkspaceNavChatList(props: {
  activeChatId: string | undefined;
  chatCatalog: { page: number; total: number };
  chatFavorites: Map<string, unknown>;
  chatFolderMembership: Map<string, Array<{ folderId: string }>>;
  chatSections: ChatListSection<Chat>[];
  chatsLoaded: number;
  chatsTotal: number;
  committedSearch: string;
  folders: WorkspaceFolder[];
  groupByDate: boolean;
  hasMoreChats: boolean;
  isLoadingMoreChats: boolean;
  onDelete: (chat: Chat) => void;
  onDialog: Dispatch<SetStateAction<WorkspaceNavDialog>>;
  onLoadMore: () => void;
  onPageChange: (page: number) => void;
  onRemoveFromFolder: (chatId: string) => void;
  onRetry: () => void;
  onSelect: (chatId: string) => void;
  onTogglePin: (chatId: string) => void;
  selectedFolder: string;
  selectedTag: string;
  sourceState: SidebarQueryState;
}) {
  const { t } = useLocale();
  return (
    <div className="rm-sidebar-list" id="workspace-nav-chat-list">
      {props.sourceState === "error" ? (
        <div className="rm-sidebar-query-error" role="alert">
          <span>{t("chatSearchUnavailable")}</span>
          <Button
            onClick={props.onRetry}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("tryAgain")}
          </Button>
        </div>
      ) : props.sourceState === "loading" ? (
        <div className="rm-sidebar-empty" aria-live="polite" role="status">
          {t("chatResultsLoading")}
        </div>
      ) : props.chatCatalog.total === 0 ? (
        <div className="rm-sidebar-empty">
          {props.selectedFolder
            ? t("folderEmpty")
            : props.committedSearch
              ? t("noMatchingChats")
              : t("noChats")}
        </div>
      ) : (
        props.chatSections.map((section) => (
          <div className="rm-sidebar-chat-section" key={section.key}>
            {props.groupByDate ? (
              <div className="rm-sidebar-time-label">
                {t(SECTION_LABEL_KEYS[section.key])}
              </div>
            ) : null}
            {section.chats.map((chat) => {
              const memberships = props.chatFolderMembership.get(chat.id) ?? [];
              const inFolder =
                props.selectedFolder.length > 0
                  ? memberships.some(
                      (entry) => entry.folderId === props.selectedFolder,
                    )
                  : memberships.length > 0;
              return (
                <WorkspaceChatNavItem
                  active={chat.id === props.activeChatId}
                  chat={chat}
                  folders={props.folders}
                  inFolder={inFolder}
                  key={chat.id}
                  onDelete={() => props.onDelete(chat)}
                  onDialog={props.onDialog}
                  onExportMarkdown={() => void downloadChatMarkdown(chat)}
                  onRemoveFromFolder={
                    inFolder
                      ? () => props.onRemoveFromFolder(chat.id)
                      : undefined
                  }
                  onSelect={() => props.onSelect(chat.id)}
                  onTogglePin={() => props.onTogglePin(chat.id)}
                  pinned={props.chatFavorites.has(chat.id)}
                />
              );
            })}
          </div>
        ))
      )}
      <CatalogPager
        onPageChange={props.onPageChange}
        page={props.chatCatalog.page}
        pageSize={50}
        total={props.chatCatalog.total}
      />
      {props.hasMoreChats &&
      props.committedSearch.length < 2 &&
      !props.selectedTag &&
      !props.selectedFolder ? (
        <Button
          className="m-2"
          disabled={props.isLoadingMoreChats}
          onClick={props.onLoadMore}
          type="button"
        >
          {props.isLoadingMoreChats
            ? t("loadingMoreChats")
            : `${t("loadMoreChats")} (${props.chatsLoaded} of ${props.chatsTotal})`}
        </Button>
      ) : null}
    </div>
  );
}

export function WorkspaceNavFooter({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useLocale();
  const { workspaceId } = useWorkspace();
  const prefetchWorkspace = useWorkspaceIntentPrefetch();
  return (
    <div className="rm-sidebar-footer-stack">
      <Link
        className="rm-sidebar-footer"
        onFocus={prefetchWorkspace}
        onMouseEnter={prefetchWorkspace}
        preload="intent"
        search={workspaceId === undefined ? {} : { workspace: workspaceId }}
        to="/workspace"
      >
        <Bot aria-hidden="true" size={16} />
        <span>{t("workspace")}</span>
      </Link>
      {isAdmin ? (
        <Link
          className="rm-sidebar-footer"
          preload={false}
          search={workspaceId === undefined ? {} : { workspace: workspaceId }}
          to="/admin"
        >
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
  );
}
