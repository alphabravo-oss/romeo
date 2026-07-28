// The sessions API does not mark the current browser session. The bootstrap
// subject does expose its id, so decoration makes that identity explicit
// before the table decides which confirmation copy to show.

export function decorateSessions<T extends { id: string }>(
  sessions: readonly T[],
  currentSessionId: string | undefined,
): Array<T & { current: boolean }> {
  return sessions.map((session) => ({
    ...session,
    current: session.id === currentSessionId,
  }));
}
