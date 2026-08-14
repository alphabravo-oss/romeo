import { Button } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, type KeyboardEvent, type ReactNode } from "react";

import { mentionFilesQueryOptions, type FileObject } from "../features/files";
import { knowledgeBasesQueryOptions } from "../features/knowledge";
import { commandPromptTemplatesQueryOptions } from "../features/prompts";
import { useLocale } from "../lib/i18n";
import {
  activeComposerTrigger,
  applyMention,
  type DismissedMention,
} from "./chat-composer-mentions";
import { materializePrompt } from "./chat-composer-utils";

/** The one id the composer textarea points `aria-controls` at. */
export const composerMenuId = "composer-command-menu";

const menuLimit = 8;
const mentionFileLimit = 5;

interface ComposerMenuOption {
  hint: string;
  id: string;
  label: string;
  onSelect: () => void;
}

export interface ComposerMenu {
  activeOptionId: string | undefined;
  /** True when the key was consumed, so the composer leaves it alone. */
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  listbox: ReactNode;
  open: boolean;
}

/**
 * Both composer triggers, deliberately in one hook: "/" (prompt templates) and
 * "@" (files and knowledge bases) share a listbox, an active index and a set of
 * arrow keys, and the textarea can only name one `aria-controls` target. Two
 * parallel implementations would be two menus racing for the same keystroke.
 */
export function useComposerMenu({
  caret,
  draft,
  onAttachExistingFile,
  onReplaceDraft,
  workspaceId,
}: {
  caret: number;
  draft: string;
  onAttachExistingFile: (file: FileObject) => void;
  onReplaceDraft: (draft: string, caret: number) => void;
  workspaceId: string | undefined;
}): ComposerMenu {
  const { t } = useLocale();
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState<DismissedMention>();

  const { dismissed: liveDismissal, trigger } = activeComposerTrigger({
    caret,
    dismissed,
    draft,
  });
  // Adjusted during render rather than in an effect: `draft` is a prop, the
  // dismissal is state derived from it, and expiring it a render late would let
  // a stale dismissal swallow the first keystroke of the next mention.
  if (liveDismissal !== dismissed) setDismissed(liveDismissal);
  const isCommand = trigger?.kind === "command";
  const commandQuery = trigger?.kind === "command" ? trigger.command : "";
  const mention = trigger?.kind === "mention" ? trigger : undefined;
  const mentionQuery = mention?.query.trim().toLowerCase() ?? "";

  const commandPromptsQuery = useQuery(
    commandPromptTemplatesQueryOptions({
      enabled: isCommand,
      limit: menuLimit,
      query: commandQuery,
      workspaceId,
    }),
  );
  const mentionFilesQuery = useQuery(
    mentionFilesQueryOptions({
      enabled: mention !== undefined,
      limit: mentionFileLimit,
      query: mentionQuery,
      workspaceId,
    }),
  );
  // Shares the cache key every other knowledge screen uses. The endpoint takes
  // no query, so the filter below is client-side — same as the "/" menu's.
  const knowledgeBasesQuery = useQuery(
    knowledgeBasesQueryOptions(workspaceId, mention !== undefined),
  );

  const mentionFiles = mentionFilesQuery.data?.items;
  function buildOptions(): ComposerMenuOption[] {
    if (isCommand) {
      return (commandPromptsQuery.data?.items ?? [])
        .filter((prompt) =>
          prompt.name.toLowerCase().includes(commandQuery.toLowerCase()),
        )
        .slice(0, menuLimit)
        .map((prompt) => ({
          hint: prompt.description ?? prompt.body.slice(0, 80),
          id: `composer-command-${prompt.id}`,
          label: `/${prompt.name}`,
          onSelect: () => {
            const body = materializePrompt(prompt.body);
            onReplaceDraft(body, body.length);
          },
        }));
    }
    if (mention === undefined) return [];
    const range = { end: mention.end, start: mention.start };
    return [
      ...(mentionFiles ?? []).map((file) => ({
        hint: file.mimeType,
        id: `composer-mention-file-${file.id}`,
        label: `@${file.fileName}`,
        onSelect: () => {
          // The file becomes a real attachment chip, so its name is spliced out
          // of the prose rather than left behind naming it a second time.
          onAttachExistingFile(file);
          const next = applyMention(draft, range, "");
          onReplaceDraft(next.draft, next.caret);
        },
      })),
      ...(knowledgeBasesQuery.data ?? [])
        .filter((base) => base.name.toLowerCase().includes(mentionQuery))
        .slice(0, Math.max(0, menuLimit - (mentionFiles?.length ?? 0)))
        .map((base) => ({
          hint: base.description ?? t("composerMentionKnowledge"),
          id: `composer-mention-knowledge-${base.id}`,
          label: `@${base.name}`,
          onSelect: () => {
            // Mentions name the collection in prose. Binding is the
            // capabilities-menu picker, which sets startRun.knowledgeBaseIds.
            const next = applyMention(draft, range, base.name);
            onReplaceDraft(next.draft, next.caret);
          },
        })),
    ];
  }

  // Rebuilt every render on purpose: `mention` is derived from the draft, so it
  // is a new object per keystroke and any memo keyed on it would miss anyway.
  const options = buildOptions();
  const active = Math.min(activeIndex, options.length - 1);
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (options.length === 0) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      setActiveIndex(0);
      // A "/" draft is nothing but the trigger, so Escape clears it; an "@" sits
      // inside real prose that the reader still wants, so only the dismissed
      // token is remembered.
      if (isCommand) onReplaceDraft("", 0);
      else if (mention !== undefined) {
        setDismissed({
          start: mention.start,
          token: draft.slice(mention.start, mention.end),
        });
      }
      return true;
    }
    if (["ArrowDown", "ArrowUp", "End", "Home"].includes(event.key)) {
      event.preventDefault();
      setActiveIndex(() => {
        if (event.key === "Home") return 0;
        if (event.key === "End") return options.length - 1;
        if (event.key === "ArrowDown") return (active + 1) % options.length;
        return (active - 1 + options.length) % options.length;
      });
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      options[active]?.onSelect();
      setActiveIndex(0);
      return true;
    }
    return false;
  }

  return {
    activeOptionId: options[active]?.id,
    handleKeyDown,
    listbox:
      options.length === 0 ? null : (
        <div
          aria-label={isCommand ? t("promptTemplates") : t("composerMentions")}
          className="rm-composer-command-menu"
          id={composerMenuId}
          role="listbox"
        >
          {options.map((option, index) => (
            <Button
              aria-selected={index === active}
              id={option.id}
              key={option.id}
              onClick={() => {
                option.onSelect();
                setActiveIndex(0);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <strong>{option.label}</strong>
              <span>{option.hint}</span>
            </Button>
          ))}
        </div>
      ),
    open: options.length > 0,
  };
}
