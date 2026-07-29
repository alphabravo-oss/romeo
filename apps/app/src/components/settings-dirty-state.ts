/**
 * Dirty tracking for settings forms. Values are compared structurally so
 * array-valued settings do not report dirty just because React handed us a
 * fresh array reference.
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }
  return Object.is(left, right);
}

export function changedFields<T extends object>(
  initial: T,
  current: T,
): (keyof T)[] {
  const keys = new Set([
    ...Object.keys(initial),
    ...Object.keys(current),
  ]) as Set<keyof T>;
  return [...keys].filter((key) => !sameValue(initial[key], current[key]));
}

export function isDirty<T extends object>(initial: T, current: T): boolean {
  return changedFields(initial, current).length > 0;
}
