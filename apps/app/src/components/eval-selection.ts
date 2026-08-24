// Eval lists are ordered newest-first, so positional selection silently moves
// whenever a suite is created or results refetch. Resolve by stable id first
// and only use the first row when the user has not made a surviving choice.

export function resolveActiveSuite<T extends { id: string }>(
  suites: readonly T[],
  selectedId: string | undefined,
): T | undefined {
  return suites.find((suite) => suite.id === selectedId) ?? suites[0];
}

export interface ScopedEvalSelection {
  scopeId: string;
  selectedId: string;
}

export function selectedEvalIdWithinScope(
  selection: ScopedEvalSelection | undefined,
  scopeId: string | undefined,
): string | undefined {
  return selection !== undefined && selection.scopeId === scopeId
    ? selection.selectedId
    : undefined;
}
