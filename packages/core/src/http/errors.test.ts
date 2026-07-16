import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import { notFound } from "../errors";
import type { AppBindings } from "./context";
import { errorHandler } from "./errors";

describe("errorHandler", () => {
  it("logs the unhandled fall-through error without changing the 500 response body", async () => {
    const app = new Hono<AppBindings>();
    app.use("*", async (context, next) => {
      context.set("requestId", "test-req");
      await next();
    });
    app.get("/boom", () => {
      throw new Error("kaboom");
    });
    app.onError(errorHandler);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await app.request("/boom");

    // The client contract must be untouched.
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "internal_error",
        message: "Unexpected server error.",
        request_id: "test-req",
        details: {},
      },
    });

    // ...but the crash must now leave a server-side trace.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const call = errorSpy.mock.calls[0];
    expect(call).toBeDefined();
    const payload = call?.[1] as
      | { requestId?: unknown; method?: unknown; path?: unknown; error?: unknown }
      | undefined;
    expect(payload).toMatchObject({
      requestId: "test-req",
      method: "GET",
      path: "/boom",
    });
    // The Error itself (with its stack), not just a message string.
    expect(payload?.error).toBeInstanceOf(Error);

    errorSpy.mockRestore();
  });

  it("does not log for a handled ApiError", async () => {
    const app = new Hono<AppBindings>();
    app.use("*", async (context, next) => {
      context.set("requestId", "test-req");
      await next();
    });
    app.get("/missing", () => {
      throw notFound("Widget");
    });
    app.onError(errorHandler);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await app.request("/missing");

    expect(response.status).toBe(404);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
