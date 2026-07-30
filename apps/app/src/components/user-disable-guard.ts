/**
 * An admin must never be able to remove the last way into the console.
 */
export function canDisableUser(
  target: { id: string; role: string; status: string },
  activeGlobalAdminTotal: number,
): boolean {
  if (target.role !== "global_admin") return true;
  return activeGlobalAdminTotal > 1;
}
