/**
 * High-severity confirmations require the admin to type the object's name.
 * Case-sensitive on purpose: the friction forces the admin to read the name
 * of the thing they are about to affect. Whitespace is trimmed because a
 * stray space is a usability trap, not a safety check.
 */
export function matchesConfirmationPhrase(
  typed: string,
  required: string,
): boolean {
  const target = required.trim();
  if (target.length === 0) return false;
  return typed.trim() === target;
}
