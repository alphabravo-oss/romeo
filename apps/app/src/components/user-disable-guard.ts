/**
 * An admin must never be able to remove the last way into the console.
 */
export function canDisableUser(
  target: { id: string; role: string; status: string },
  all: readonly { id: string; role: string; status: string }[],
): boolean {
  if (target.role !== "global_admin") return true;
  const activeAdmins = all.filter(
    (entry) => entry.role === "global_admin" && entry.status === "active",
  );
  return activeAdmins.length > 1;
}
