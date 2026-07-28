import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import { notFound } from "../errors";
import type { AppBindings } from "./context";
import { errorHandler } from "./errors";

describe("errorHandler", () => {
  it("logs only metadata for an unhandled fall-through error without changing the 500 response body", async () => {
    const app = new Hono<AppBindings>();
    app.use("*", async (context, next) => {
      context.set("requestId", "test-req");
      await next();
    });
    const sentinel = "RAW_PROMPT_PROVIDER_SECRET_SENTINEL";
    app.get("/boom", () => {
      const error = new Error(`provider payload: ${sentinel}`);
      Object.assign(error, { code: sentinel, cause: sentinel });
      throw error;
    });
    app.onError(errorHandler);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await app.request(`/boom?token=${sentinel}`);

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
    const payload = call?.[1];
    expect(payload).toEqual({
      requestIdFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/),
      method: "GET",
      errorKind: "Error",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(sentinel);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      "provider payload",
    );

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
