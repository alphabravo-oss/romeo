import type { ShareTarget } from "../features/collaboration";

export function shareTargetKey(target: ShareTarget): string {
  return `${target.principalType}:${target.principalId}`;
}
