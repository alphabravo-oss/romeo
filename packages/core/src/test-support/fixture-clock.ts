// Fixture timestamps must be relative to now. A hardcoded future date is a
// time bomb: `expiresAt: "2026-07-08T12:00:00.000Z"` silently rotted a week
// after it was written and broke SessionService.revokeOthers tests, because
// revokeOthers skips expired sessions and so never reached the audit hook.
// ponytail: plain Date math, no fake-timer framework — add one only if a test
// needs to control the clock rather than just stay ahead of it.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function fixtureFuture(offsetMs: number = ONE_DAY_MS): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function fixturePast(offsetMs: number = ONE_DAY_MS): string {
  return new Date(Date.now() - offsetMs).toISOString();
}
