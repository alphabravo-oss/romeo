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
  downloadText(csvText, filename, "text/csv;charset=utf-8");
}
import { downloadText } from "./download";
