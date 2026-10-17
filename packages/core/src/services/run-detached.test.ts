import { afterEach, describe, expect, it, vi } from "vitest";

import { runDetached } from "./run-detached";

describe("runDetached", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves and logs only redacted error identity when work rejects", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn(async () => undefined);

    await expect(
      runDetached(
        "run.queue.drain",
        async () => {
          throw Object.assign(new Error("provider body with secret"), {
            code: "bad code with spaces",
          });
        },
        { context: { chatId: "chat_1" }, onError },
      ),
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("background task failed", {
      task: "run.queue.drain",
      chatId: "chat_1",
      errorClass: "Error",
    });
  });

  it("classifies non-error throws without echoing them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runDetached("task", () => Promise.reject("raw string secret"));

    expect(log).toHaveBeenCalledWith("background task failed", {
      task: "task",
      errorClass: "NonErrorThrow",
    });
  });
});
