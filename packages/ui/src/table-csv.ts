export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function serializeTableCsv<T>(
  columns: readonly CsvColumn<T>[],
  rows: readonly T[],
): string {
  return [
    columns.map((column) => escapeCsvCell(column.header)).join(","),
    ...rows.map((row) =>
      columns.map((column) => escapeCsvCell(column.value(row))).join(","),
    ),
  ].join("\r\n");
}

export function escapeCsvCell(value: unknown): string {
  let text = scalarText(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function downloadCsv(csv: string, filename: string): boolean {
  if (
    typeof document === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return false;
  }
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeCsvFilename(filename);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

export function sanitizeCsvFilename(value: string): string {
  const basename = value.split(/[\\/]/u).at(-1) ?? "";
  const sanitized = basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f:*?"<>|]+/gu, "-")
    .replace(/^\.+/u, "")
    .trim()
    .slice(0, 180);
  const valid = /[\p{L}\p{N}]/u.test(sanitized) ? sanitized : "romeo-table";
  return valid.toLowerCase().endsWith(".csv") ? valid : `${valid}.csv`;
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "bigint" || typeof value === "string")
    return String(value);
  return "";
}
