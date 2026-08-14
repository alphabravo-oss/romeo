import { Button, Input } from "@romeo/ui";
import { useEffect, useRef, useState } from "react";

import { useLocale } from "../lib/i18n";

const TITLE_MAX = 200;

/** ChatGPT-style conversation name in the shell header. */
export function ChatHeaderTitle({
  canRename,
  chatId,
  title,
  onRename,
}: {
  canRename: boolean;
  chatId: string | undefined;
  title: string | undefined;
  onRename: (chatId: string, title: string) => void;
}) {
  const { t } = useLocale();
  const display = title?.trim() || t("newChat");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(display);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditing(false);
  }, [chatId]);

  useEffect(() => {
    if (!editing) setDraft(display);
  }, [display, editing]);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (input === undefined || input === null) return;
    input.focus();
    input.select();
  }, [editing]);

  function commit() {
    setEditing(false);
    if (chatId === undefined) return;
    const next = draft.trim();
    if (next.length === 0 || next === display) return;
    onRename(chatId, next.slice(0, TITLE_MAX));
  }

  if (editing && canRename && chatId !== undefined) {
    return (
      <Input
        aria-label={t("renameChat")}
        className="rm-topbar-title-input"
        maxLength={TITLE_MAX}
        onBlur={commit}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(display);
            setEditing(false);
          }
        }}
        ref={inputRef}
        value={draft}
      />
    );
  }

  if (!canRename || chatId === undefined) {
    return (
      <h1 className="rm-topbar-title" title={display}>
        {display}
      </h1>
    );
  }

  return (
    <Button
      aria-label={t("renameChat")}
      className="rm-topbar-title rm-topbar-title-button"
      onClick={() => setEditing(true)}
      title={display}
      type="button"
      variant="ghost"
    >
      {display}
    </Button>
  );
}
