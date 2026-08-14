/**
 * Builds a "contains" pattern for LIKE/ILIKE out of untrusted search input.
 *
 * Interpolating raw input leaves % and _ acting as wildcards: a search for "%"
 * returns every row, "_" matches everything, a literal "100%" silently matches
 * anything starting with "100", and a string of "%_" pairs forces a quadratic
 * scan. Backslash is escaped by the same pass so it cannot smuggle an escape
 * for the character after it.
 */
export function containsPattern(value: string): string {
  return `%${escapeLikeValue(value)}%`;
}

export function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}
