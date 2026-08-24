import { definePlugin } from "nitro";

interface ShutdownHooks {
  hook(name: "close", callback: () => Promise<void>): unknown;
}

type RuntimeLoader = () => Promise<{
  closeRomeoServerRuntime: () => Promise<void>;
}>;

/**
 * Bind the Romeo runtime to Nitro's graceful-shutdown lifecycle. Nitro stops
 * accepting work first, then awaits this hook within its configured shutdown
 * timeout, allowing workers/outboxes to drain before the database pool closes.
 */
export function registerRomeoRuntimeShutdown(
  hooks: ShutdownHooks,
  loadRuntime: RuntimeLoader = () => import("../romeo-api"),
): void {
  hooks.hook("close", async () => {
    const runtime = await loadRuntime();
    await runtime.closeRomeoServerRuntime();
  });
}

export default definePlugin((nitroApp) => {
  registerRomeoRuntimeShutdown(nitroApp.hooks);
});
