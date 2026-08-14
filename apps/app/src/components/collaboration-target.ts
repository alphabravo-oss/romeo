import type { ShareTarget } from "../features";

export function shareTargetKey(target: ShareTarget): string {
  return `${target.principalType}:${target.principalId}`;
}
