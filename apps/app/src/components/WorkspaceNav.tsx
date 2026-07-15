import { Link } from "@tanstack/react-router";
import BotMessageSquare from "lucide-react/dist/esm/icons/bot-message-square.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid.mjs";
import LogOut from "lucide-react/dist/esm/icons/log-out.mjs";
import MessageSquare from "lucide-react/dist/esm/icons/message-square.mjs";
import Settings from "lucide-react/dist/esm/icons/settings.mjs";
import SquarePen from "lucide-react/dist/esm/icons/square-pen.mjs";
import Shield from "lucide-react/dist/esm/icons/shield.mjs";
import User from "lucide-react/dist/esm/icons/user.mjs";
import { useEffect, useRef, useState } from "react";

import { logout } from "../api/client";
import type { Chat } from "../api/types";
import type { Workspace } from "../api/workspace-types";
import { useConfirm } from "./ConfirmDialog";
import { FormDialog } from "./FormDialog";
import { OverflowMenu } from "./OverflowMenu";

const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 480;
const SIDEBAR_KEY = "rm-sidebar-width";

export function WorkspaceNav({
  activeChatId,
  chats,
  isAdmin,
  onDeleteChat,
  onNewChat,
  onRenameChat,
  onSelectChat,
  onSelectWorkspace,
  userLabel,
  workspaceId,
  workspaceName,
  workspaces,
}: {
  activeChatId: string | undefined;
  chats: Chat[];
  isAdmin: boolean;
  onDeleteChat: (chatId: string) => void;
  onNewChat: () => void;
  onRenameChat: (chatId: string, title: string) => void;
  onSelectChat: (chatId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  userLabel: string;
  workspaceId: string | undefined;
  workspaceName: string;
  workspaces: Workspace[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renamingChat, setRenamingChat] = useState<Chat | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const footerRef = useRef<HTMLDivElement>(null);
  const { ask, dialog: confirmDialog } = useConfirm();

  // Restore persisted sidebar width (Open WebUI parity: resizable + saved).
  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved) {
      document.documentElement.style.setProperty("--rm-sidebar-width", `${saved}px`);
    }
  }, []);

  // Close the user menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!footerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  function startResize(event: React.MouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth =
      document.querySelector(".rm-sidebar")?.getBoundingClientRect().width ?? 260;
    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, startWidth + (moveEvent.clientX - startX)),
      );
      document.documentElement.style.setProperty("--rm-sidebar-width", `${next}px`);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      const width = Math.round(
        document.querySelector(".rm-sidebar")?.getBoundingClientRect().width ?? 260,
      );
      localStorage.setItem(SIDEBAR_KEY, String(width));
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function openRenameDialog(chat: Chat) {
    setRenamingChat(chat);
    setRenameValue(chat.title);
  }

  async function confirmDeleteChat(chat: Chat) {
    const confirmed = await ask({
      title: "Delete chat",
      body: `Delete "${chat.title}"? This archives the chat rather than erasing it immediately.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    onDeleteChat(chat.id);
  }

  return (
    <aside className="rm-sidebar">
      <div className="rm-sidebar-brand">
        <div className="rm-logo-mark">
          <BotMessageSquare aria-hidden="true" size={18} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Romeo</div>
          <div className="rm-brand-tagline truncate">Enterprise AI Chat</div>
          {workspaces.length > 1 ? (
            <select
              aria-label="Switch workspace"
              className="rm-workspace-switcher"
              onChange={(event) => onSelectWorkspace(event.currentTarget.value)}
              value={workspaceId ?? ""}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="truncate text-xs text-muted">{workspaceName}</div>
          )}
        </div>
      </div>

      <button className="rm-new-chat-button" onClick={onNewChat} type="button">
        <SquarePen aria-hidden="true" size={18} strokeWidth={2} />
        <span>New chat</span>
      </button>

      <Link className="rm-new-chat-button" to="/workspace">
        <LayoutGrid aria-hidden="true" size={18} strokeWidth={2} />
        <span>Workspace</span>
      </Link>

      <section className="rm-sidebar-section">
        <div className="rm-sidebar-label">
          <MessageSquare aria-hidden="true" size={13} />
          <span>Chats</span>
        </div>
        <div className="rm-sidebar-list">
          {chats.length === 0 ? (
            <div className="rm-sidebar-empty">No chats yet</div>
          ) : (
            chats.map((chat) => (
              <div
                className={`rm-sidebar-item ${chat.id === activeChatId ? "active" : ""}`}
                key={chat.id}
              >
                <button
                  className="rm-sidebar-item-label truncate"
                  onClick={() => onSelectChat(chat.id)}
                  type="button"
                >
                  {chat.title}
                </button>
                <OverflowMenu
                  items={[
                    {
                      label: "Rename",
                      onClick: () => openRenameDialog(chat),
                    },
                    {
                      label: "Delete",
                      onClick: () => void confirmDeleteChat(chat),
                      tone: "danger",
                    },
                  ]}
                  label={`Chat actions for ${chat.title}`}
                />
              </div>
            ))
          )}
        </div>
      </section>

      <div className="rm-sidebar-footer-stack">
        {isAdmin ? (
          <Link className="rm-sidebar-footer" to="/admin">
            <Shield aria-hidden="true" size={16} />
            <span>Admin</span>
          </Link>
        ) : null}

        <div className="rm-sidebar-footer-group" ref={footerRef}>
          {menuOpen ? (
            <div className="rm-user-menu" role="menu">
              <Link
                className="rm-user-menu-item"
                onClick={() => setMenuOpen(false)}
                role="menuitem"
                to="/settings"
              >
                <Settings aria-hidden="true" size={16} />
                <span>Settings</span>
              </Link>
              <Link
                className="rm-user-menu-item"
                onClick={() => setMenuOpen(false)}
                role="menuitem"
                search={{ section: "account" }}
                to="/settings"
              >
                <User aria-hidden="true" size={16} />
                <span>Profile</span>
              </Link>
              <div className="rm-user-menu-divider" />
              <button
                className="rm-user-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  void logout().finally(() => {
                    window.location.href = "/";
                  });
                }}
                role="menuitem"
                type="button"
              >
                <LogOut aria-hidden="true" size={16} />
                <span>Log out</span>
              </button>
            </div>
          ) : null}
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="rm-user-button"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <div className="rm-user-avatar">
              <User aria-hidden="true" size={15} />
            </div>
            <span className="truncate">{userLabel}</span>
            <ChevronDown
              aria-hidden="true"
              className="rm-user-chevron"
              size={14}
            />
          </button>
        </div>

        <div className="rm-built-by">
          built by{" "}
          <a href="https://alphabravo.io" rel="noreferrer" target="_blank">
            AlphaBravo
          </a>
        </div>
      </div>

      <button
        aria-label="Resize sidebar"
        className="rm-sidebar-resizer"
        onMouseDown={startResize}
        type="button"
      />

      <FormDialog
        onClose={() => setRenamingChat(null)}
        open={renamingChat !== null}
        title="Rename chat"
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (renamingChat === null) return;
            const trimmed = renameValue.trim();
            if (trimmed.length === 0) return;
            onRenameChat(renamingChat.id, trimmed);
            setRenamingChat(null);
          }}
        >
          <label className="grid gap-1 text-sm" htmlFor="rename-chat-title">
            <span className="text-muted">Title</span>
            <input
              autoFocus
              className="rm-input"
              id="rename-chat-title"
              onChange={(event) => setRenameValue(event.currentTarget.value)}
              value={renameValue}
            />
          </label>
          <button className="rm-button primary" type="submit">
            Rename
          </button>
        </form>
      </FormDialog>
      {confirmDialog}
    </aside>
  );
}
