// Pure console-section resolution shared by workspace, settings, and admin.
// Kept UI-free (and import-free) so malformed URL search state can be tested
// without loading TanStack Router.
//
// The `in` operator is not sufficient here: ordinary objects inherit keys
// such as "constructor" and "toString". Treating either as a valid section
// later dereferences non-metadata from the prototype and can still crash the
// route that is supposed to fall back safely.

export function resolveSectionKey<TFallback extends string>(
  candidate: string | undefined,
  sections: Readonly<Record<string, unknown>>,
  fallback: TFallback,
): string {
  return candidate !== undefined &&
    Object.prototype.hasOwnProperty.call(sections, candidate)
    ? candidate
    : fallback;
}
