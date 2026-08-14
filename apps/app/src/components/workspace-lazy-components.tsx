import { lazy } from "react";

export const LazyChatPanel = lazy(async () => {
  const { ChatPanel } = await import("./ChatPanel");
  return { default: ChatPanel };
});

export const LazyWorkspaceNavDialogs = lazy(async () => {
  const { WorkspaceNavDialogs } = await import("./WorkspaceNavDialogs");
  return { default: WorkspaceNavDialogs };
});
