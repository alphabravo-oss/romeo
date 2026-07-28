// Provider configuration stores several list-valued fields as one item per
// line. Keeping the parser separate binds the save path to the same real
// newline format used when existing values are joined back into the dialog.

/** Parse a textarea containing one provider setting per line. */
export function linesToArray(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
