import type { UserSession } from "../domain/entities";
import type { UserSessionSummary } from "./session-service";

export function toSessionSummary(session: UserSession): UserSessionSummary {
  const { hashedToken: _hashedToken, ...summary } = session;
  return summary;
}
