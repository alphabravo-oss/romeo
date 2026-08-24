import { describe, expect, it, vi } from "vitest";

import { registerRomeoRuntimeShutdown } from "./romeo-runtime-shutdown";

describe("Romeo runtime shutdown plugin", () => {
  it("awaits runtime cleanup from Nitro's close hook", async () => {
    let closeHook: (() => Promise<void>) | undefined;
    const closeRomeoServerRuntime = vi.fn(async () => undefined);

    registerRomeoRuntimeShutdown(
      {
        hook(name, callback) {
          expect(name).toBe("close");
          closeHook = callback;
        },
      },
      async () => ({ closeRomeoServerRuntime }),
    );

    expect(closeHook).toBeDefined();
    await closeHook?.();
    expect(closeRomeoServerRuntime).toHaveBeenCalledOnce();
  });
});
