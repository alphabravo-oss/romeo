import { describe, expect, it } from "vitest";

import {
  activeComposerTrigger,
  applyMention,
  mentionQueryAt,
} from "./chat-composer-mentions";

describe("composer mention trigger", () => {
  it("opens on a mention at the start of the draft", () => {
    expect(mentionQueryAt("@rep", 4)).toEqual({
      end: 4,
      query: "rep",
      start: 0,
    });
  });

  it("opens on a mention after whitespace", () => {
    expect(mentionQueryAt("summarise @rep", 14)).toEqual({
      end: 14,
      query: "rep",
      start: 10,
    });
  });

  it("opens with an empty query the moment the trigger is typed", () => {
    expect(mentionQueryAt("@", 1)).toEqual({ end: 1, query: "", start: 0 });
  });

  it("ignores an at-sign glued to the previous word", () => {
    expect(mentionQueryAt("mail me@example", 15)).toBeUndefined();
  });

  it("ignores a token the caret has already moved past", () => {
    expect(mentionQueryAt("@rep is ready", 13)).toBeUndefined();
  });

  it("covers the whole token when the caret sits inside it", () => {
    expect(mentionQueryAt("@report", 3)).toEqual({
      end: 7,
      query: "report",
      start: 0,
    });
  });

  it("ignores a query longer than a plausible name", () => {
    expect(mentionQueryAt(`@${"a".repeat(65)}`, 66)).toBeUndefined();
  });

  it("ignores a caret outside the draft", () => {
    expect(mentionQueryAt("@rep", 0)).toBeUndefined();
    expect(mentionQueryAt("@rep", 9)).toBeUndefined();
  });

  it("replaces the token and reports where the caret lands", () => {
    expect(
      applyMention(
        "tell me about @rep now",
        { end: 18, start: 14 },
        "Q3 Report",
      ),
    ).toEqual({ caret: 25, draft: "tell me about @Q3 Report now" });
  });

  it("splices the token out when the selection carries no label", () => {
    expect(applyMention("look at @rep", { end: 12, start: 8 }, "")).toEqual({
      caret: 8,
      draft: "look at ",
    });
  });

  it("does not leave a double space behind a mid-sentence selection", () => {
    expect(applyMention("look at @rep now", { end: 12, start: 8 }, "")).toEqual(
      {
        caret: 8,
        draft: "look at now",
      },
    );
  });
});

describe("active composer trigger", () => {
  it("lets a leading slash win outright over a later mention", () => {
    expect(
      activeComposerTrigger({
        caret: 11,
        dismissed: undefined,
        draft: "/recap @rep",
      }),
    ).toEqual({
      dismissed: undefined,
      trigger: { command: "recap @rep", kind: "command" },
    });
  });

  it("opens the command menu with an empty query on the bare trigger", () => {
    expect(
      activeComposerTrigger({ caret: 1, dismissed: undefined, draft: "/" }),
    ).toEqual({
      dismissed: undefined,
      trigger: { command: "", kind: "command" },
    });
  });

  it("opens the mention menu when no slash claims the draft", () => {
    expect(
      activeComposerTrigger({
        caret: 14,
        dismissed: undefined,
        draft: "summarise @rep",
      }),
    ).toEqual({
      dismissed: undefined,
      trigger: { end: 14, kind: "mention", query: "rep", start: 10 },
    });
  });

  it("reports no trigger for ordinary prose", () => {
    expect(
      activeComposerTrigger({
        caret: 9,
        dismissed: undefined,
        draft: "no menus",
      }),
    ).toEqual({ dismissed: undefined, trigger: undefined });
  });

  it("stays shut while the reader keeps typing the dismissed token", () => {
    const dismissed = { start: 10, token: "@rep" };
    expect(
      activeComposerTrigger({ caret: 15, dismissed, draft: "summarise @repo" }),
    ).toEqual({ dismissed, trigger: undefined });
  });

  it("opens for a mention elsewhere while one stays dismissed", () => {
    const dismissed = { start: 0, token: "@rep" };
    expect(
      activeComposerTrigger({ caret: 13, dismissed, draft: "@rep and @bud" }),
    ).toEqual({
      dismissed,
      trigger: { end: 13, kind: "mention", query: "bud", start: 9 },
    });
  });

  it("drops a dismissal whose token the draft no longer holds", () => {
    expect(
      activeComposerTrigger({
        caret: 0,
        dismissed: { start: 0, token: "@" },
        draft: "",
      }),
    ).toEqual({ dismissed: undefined, trigger: undefined });
  });

  it("reopens at the same offset after the dismissed draft was sent", () => {
    // The composer stays mounted across sends, so the dismissal has to expire
    // with the draft: otherwise one Escape mutes that offset for the session.
    const sent = activeComposerTrigger({
      caret: 0,
      dismissed: { start: 0, token: "@" },
      draft: "",
    });
    expect(
      activeComposerTrigger({
        caret: 1,
        dismissed: sent.dismissed,
        draft: "@",
      }),
    ).toEqual({
      dismissed: undefined,
      trigger: { end: 1, kind: "mention", query: "", start: 0 },
    });
  });
});
