/**
 * The composer's trigger rules — "/" templates and "@" mentions — kept out of
 * the component so they are testable without a DOM. "/" only ever means "the
 * draft starts with a slash", while "@" has to survive being typed anywhere
 * inside a sentence and has to remember what Escape closed.
 */

/** Long enough for a real file name, short enough that prose never queries. */
const maxMentionQueryLength = 64;

export interface MentionQuery {
  /** Offset of the "@" itself, so a selection can replace the whole token. */
  start: number;
  /** Offset just past the token, i.e. the next whitespace or end of draft. */
  end: number;
  query: string;
}

export function mentionQueryAt(
  draft: string,
  caret: number,
): MentionQuery | undefined {
  if (caret < 1 || caret > draft.length) return undefined;
  const start = draft.lastIndexOf("@", caret - 1);
  if (start === -1) return undefined;
  // An "@" glued to the previous word is an email address or a package scope,
  // not a mention. Only a word-initial "@" opens the menu.
  if (start > 0 && !isWhitespace(draft.charAt(start - 1))) return undefined;
  const trailing = draft.slice(start + 1).search(/\s/u);
  const end = trailing === -1 ? draft.length : start + 1 + trailing;
  if (caret > end) return undefined;
  const query = draft.slice(start + 1, end);
  if (query.length > maxMentionQueryLength) return undefined;
  return { end, query, start };
}

/** What Escape closed: the token itself, not the offset it happened to sit at. */
export interface DismissedMention {
  /** Offset of the dismissed "@". */
  start: number;
  /** The token as it read when Escape was pressed, e.g. "@rep". */
  token: string;
}

export type ComposerTrigger =
  | (MentionQuery & { kind: "mention" })
  | { command: string; kind: "command" };

/**
 * The whole trigger decision for the composer: which menu the draft asks for,
 * and which dismissal is still worth remembering. Returned together because the
 * second gates the first, and both are wanted before the next render.
 */
export function activeComposerTrigger({
  caret,
  dismissed,
  draft,
}: {
  caret: number;
  dismissed: DismissedMention | undefined;
  draft: string;
}): {
  dismissed: DismissedMention | undefined;
  trigger: ComposerTrigger | undefined;
} {
  // A dismissal dies with its token: once that exact text stops sitting at that
  // offset — the draft was sent, cleared, or replaced by a template — Escape
  // stops applying. Remembering a bare offset instead would mute every later
  // mention that happened to start there, for the life of the composer.
  const live =
    dismissed !== undefined &&
    draft.startsWith(dismissed.token, dismissed.start)
      ? dismissed
      : undefined;
  // "/" wins outright: a draft that opens with a slash is a template lookup,
  // and an "@" further along the same draft must not open a second menu.
  if (draft.startsWith("/")) {
    return {
      dismissed: live,
      trigger: { command: draft.slice(1).trim(), kind: "command" },
    };
  }
  const found = mentionQueryAt(draft, Math.min(caret, draft.length));
  // The menu stays shut while the reader keeps typing the word they dismissed;
  // a mention starting anywhere else opens normally.
  if (found === undefined || found.start === live?.start) {
    return { dismissed: live, trigger: undefined };
  }
  return { dismissed: live, trigger: { ...found, kind: "mention" } };
}

/**
 * Replaces the mention token. An empty label splices the token out instead,
 * which is what a file selection wants: the file becomes a real attachment
 * chip, so leaving its name in the prose would name it twice.
 */
export function applyMention(
  draft: string,
  range: { end: number; start: number },
  label: string,
): { caret: number; draft: string } {
  const inserted = label === "" ? "" : `@${label} `;
  // Swallow the space the token was already followed by, or every selection
  // leaves a double space behind mid-sentence.
  const end = isWhitespace(draft.charAt(range.end)) ? range.end + 1 : range.end;
  return {
    caret: range.start + inserted.length,
    draft: `${draft.slice(0, range.start)}${inserted}${draft.slice(end)}`,
  };
}

function isWhitespace(value: string): boolean {
  return /\s/u.test(value);
}
