import { Button, Input } from "@romeo/ui";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  chatMessageSearchInfiniteOptions,
  resetChatMessageSearch,
  type ChatMessageSearchHit,
} from "../lib/chat-message-search-query";
import { useDebouncedValue } from "../lib/debounce";
import { useLocale } from "../lib/i18n";
import { isMessagePageResetError } from "../lib/message-page-query";
import { safeUserErrorMessage } from "../lib/safe-user-error";

import "../styles/app-message-search.css";

export function ChatMessageSearch({
  chatId,
  onNavigate,
}: {
  chatId: string;
  onNavigate: (result: ChatMessageSearchHit) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocus = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebouncedValue(query, 250);
  const queryClient = useQueryClient();
  const search = useInfiniteQuery(
    chatMessageSearchInfiniteOptions(open ? chatId : undefined, debouncedQuery),
  );
  const pages = search.data?.pages;
  const results = useMemo(
    () => pages?.flatMap((page) => page.data) ?? [],
    [pages],
  );
  const total = search.data?.pages[0]?.meta.total ?? 0;

  useEffect(() => {
    if (open || !restoreTriggerFocus.current) return;
    restoreTriggerFocus.current = false;
    triggerRef.current?.focus();
  }, [open]);

  const navigate = useCallback(
    (index: number, available: ChatMessageSearchHit[] = results) => {
      const result = available[index];
      if (result === undefined) return;
      setSelectedIndex(index);
      onNavigate(result);
      window.location.hash = `message-${encodeURIComponent(result.messageId)}`;
    },
    [onNavigate, results],
  );

  async function next() {
    const nextIndex = selectedIndex + 1;
    if (nextIndex < results.length) {
      navigate(nextIndex);
      return;
    }
    if (!search.hasNextPage || search.isFetchingNextPage) return;
    const response = await search.fetchNextPage();
    if (response.isError) {
      if (isMessagePageResetError(response.error))
        await resetChatMessageSearch(
          queryClient,
          chatMessageSearchInfiniteOptions(chatId, debouncedQuery),
        );
      return;
    }
    const available = response.data?.pages.flatMap((page) => page.data) ?? [];
    navigate(nextIndex, available);
  }

  function close() {
    restoreTriggerFocus.current = true;
    setOpen(false);
    setSelectedIndex(-1);
  }

  if (!open) {
    return (
      <Button
        aria-label={t("searchCurrentChat")}
        className="rm-chat-session-bar__action"
        onClick={() => {
          setOpen(true);
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
        ref={triggerRef}
        title={t("searchCurrentChat")}
        type="button"
        variant="ghost"
      >
        <Search aria-hidden="true" size={15} />
      </Button>
    );
  }

  const countLabel =
    debouncedQuery.trim().length < 2
      ? t("chatSearchMinimum")
      : search.isPending
        ? t("searchingCurrentChat")
        : t("chatSearchResultCount", { count: total });
  return (
    <div
      aria-label={t("searchCurrentChat")}
      className="rm-chat-message-search"
      role="search"
    >
      <Input
        aria-label={t("searchCurrentChat")}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setSelectedIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "ArrowDown" || event.key === "Enter") {
            event.preventDefault();
            void next();
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            navigate(Math.max(0, selectedIndex - 1));
          }
        }}
        placeholder={t("searchCurrentChatPlaceholder")}
        ref={inputRef}
        type="search"
        value={query}
      />
      <span aria-live="polite" className="rm-chat-message-search__count">
        {countLabel}
      </span>
      {search.error === null ? null : (
        <span className="rm-chat-message-search__error" role="alert">
          {safeUserErrorMessage(search.error, t("chatSearchFailed"))}
        </span>
      )}
      <div className="rm-chat-message-search__controls">
        <Button
          aria-label={t("previousChatSearchResult")}
          disabled={selectedIndex <= 0 || results.length === 0}
          onClick={() => navigate(selectedIndex - 1)}
          size="icon"
          title={t("previousChatSearchResult")}
          type="button"
          variant="ghost"
        >
          <ChevronUp aria-hidden="true" size={15} />
        </Button>
        <Button
          aria-label={t("nextChatSearchResult")}
          disabled={
            results.length === 0 ||
            (selectedIndex >= results.length - 1 && !search.hasNextPage)
          }
          onClick={() => void next()}
          size="icon"
          title={t("nextChatSearchResult")}
          type="button"
          variant="ghost"
        >
          <ChevronDown aria-hidden="true" size={15} />
        </Button>
        <Button
          aria-label={t("closeChatSearch")}
          onClick={close}
          size="icon"
          title={t("closeChatSearch")}
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" size={15} />
        </Button>
      </div>
      {selectedIndex < 0 || results[selectedIndex] === undefined ? null : (
        <span className="rm-chat-message-search__branch">
          {results[selectedIndex].branch === "active"
            ? t("activeChatBranch")
            : t("alternateChatBranch")}
          {": "}
          {results[selectedIndex].snippet}
        </span>
      )}
    </div>
  );
}
