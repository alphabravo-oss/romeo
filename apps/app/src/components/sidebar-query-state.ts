export type SidebarQueryState = "error" | "loading" | "ready" | "refreshing";

export function resolveSidebarQueryState(input: {
  hasData: boolean;
  isError: boolean;
  isFetching: boolean;
  isPending: boolean;
}): SidebarQueryState {
  if (input.isError && !input.hasData) return "error";
  if (input.isPending && !input.hasData) return "loading";
  if (input.isFetching) return "refreshing";
  return "ready";
}
