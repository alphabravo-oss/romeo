/**
 * Sidebar chat list sections: optional Pinned group, then recency buckets.
 * Pure helpers so unit tests own the boundary math (local calendar days).
 */

export type ChatListSectionKey =
  | "pinned"
  | "today"
  | "yesterday"
  | "previous7Days"
  | "older";

export interface ChatListSectionInput {
  id: string;
  updatedAt: string;
}

export interface ChatListSection<T extends ChatListSectionInput> {
  key: ChatListSectionKey;
  chats: T[];
}

export function groupChatsForSidebar<T extends ChatListSectionInput>(
  chats: readonly T[],
  options: {
    pinnedIds?: ReadonlySet<string>;
    /** When false, return a single flat stream (search results). */
    groupByDate?: boolean;
    now?: Date;
  } = {},
): ChatListSection<T>[] {
  const pinnedIds = options.pinnedIds ?? new Set<string>();
  const groupByDate = options.groupByDate !== false;
  const now = options.now ?? new Date();

  if (chats.length === 0) return [];

  if (!groupByDate) {
    return [{ key: "today", chats: [...chats] }];
  }

  const pinned: T[] = [];
  const unpinned: T[] = [];
  for (const chat of chats) {
    if (pinnedIds.has(chat.id)) pinned.push(chat);
    else unpinned.push(chat);
  }

  const todayStart = startOfLocalDay(now);
  const yesterdayStart = addLocalDays(todayStart, -1);
  const weekStart = addLocalDays(todayStart, -7);

  const today: T[] = [];
  const yesterday: T[] = [];
  const previous7Days: T[] = [];
  const older: T[] = [];

  for (const chat of unpinned) {
    const time = Date.parse(chat.updatedAt);
    if (Number.isNaN(time) || time >= todayStart.getTime()) {
      today.push(chat);
    } else if (time >= yesterdayStart.getTime()) {
      yesterday.push(chat);
    } else if (time >= weekStart.getTime()) {
      previous7Days.push(chat);
    } else {
      older.push(chat);
    }
  }

  const sections: ChatListSection<T>[] = [];
  if (pinned.length > 0) sections.push({ key: "pinned", chats: pinned });
  if (today.length > 0) sections.push({ key: "today", chats: today });
  if (yesterday.length > 0)
    sections.push({ key: "yesterday", chats: yesterday });
  if (previous7Days.length > 0)
    sections.push({ key: "previous7Days", chats: previous7Days });
  if (older.length > 0) sections.push({ key: "older", chats: older });
  return sections;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
