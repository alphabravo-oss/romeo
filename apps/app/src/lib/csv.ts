/**
 * Triggers a browser download of `csvText` as `filename` using the
 * blob → object URL → anchor click → revokeObjectURL pattern. Replaces the
 * ad-hoc copies previously inlined in AuditPanel and UsagePanel.
 *
 *   downloadCsv(await exportAuditLogsCsv(filter), 'romeo-audit-logs.csv')
 *
 * SSR-safe: a no-op when there is no `document`.
 */
export function downloadCsv(csvText: string, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(
    new Blob([csvText], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
