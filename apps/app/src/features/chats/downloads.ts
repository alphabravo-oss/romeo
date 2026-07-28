/** Returns a same-origin URL for browser-managed chat downloads. */
export function chatExportUrl(
  chatId: string,
  format: "html" | "json" = "json",
): string {
  return `/api/v1/chats/${encodeURIComponent(chatId)}/export${format === "html" ? "?format=html" : ""}`;
}
