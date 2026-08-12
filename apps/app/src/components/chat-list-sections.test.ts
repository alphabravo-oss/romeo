import { describe, expect, it } from "vitest";

import { groupChatsForSidebar, startOfLocalDay } from "./chat-list-sections";

const noon = (daysAgo: number, now: Date): string => {
  const day = startOfLocalDay(now);
  day.setDate(day.getDate() - daysAgo);
  day.setHours(12, 0, 0, 0);
  return day.toISOString();
};

describe("groupChatsForSidebar", () => {
  const now = new Date(2026, 7, 12, 15, 30, 0); // local Aug 12 2026 15:30

  it("puts pinned chats in their own section first", () => {
    const sections = groupChatsForSidebar(
      [
        { id: "c1", updatedAt: noon(0, now) },
        { id: "c2", updatedAt: noon(0, now) },
      ],
      { pinnedIds: new Set(["c2"]), now },
    );
    expect(sections.map((s) => s.key)).toEqual(["pinned", "today"]);
    expect(sections[0]?.chats.map((c) => c.id)).toEqual(["c2"]);
    expect(sections[1]?.chats.map((c) => c.id)).toEqual(["c1"]);
  });

  it("buckets by today / yesterday / previous 7 days / older", () => {
    const sections = groupChatsForSidebar(
      [
        { id: "today", updatedAt: noon(0, now) },
        { id: "yesterday", updatedAt: noon(1, now) },
        { id: "midweek", updatedAt: noon(3, now) },
        { id: "weekEdge", updatedAt: noon(7, now) },
        { id: "old", updatedAt: noon(14, now) },
      ],
      { now },
    );
    expect(
      Object.fromEntries(sections.map((s) => [s.key, s.chats.map((c) => c.id)])),
    ).toEqual({
      today: ["today"],
      yesterday: ["yesterday"],
      previous7Days: ["midweek", "weekEdge"],
      older: ["old"],
    });
  });

  it("skips empty buckets", () => {
    const sections = groupChatsForSidebar(
      [{ id: "old", updatedAt: noon(30, now) }],
      { now },
    );
    expect(sections).toEqual([
      { key: "older", chats: [{ id: "old", updatedAt: noon(30, now) }] },
    ]);
  });

  it("returns a flat stream when groupByDate is false", () => {
    const chats = [
      { id: "a", updatedAt: noon(0, now) },
      { id: "b", updatedAt: noon(10, now) },
    ];
    expect(groupChatsForSidebar(chats, { groupByDate: false, now })).toEqual([
      { key: "today", chats },
    ]);
  });
});
