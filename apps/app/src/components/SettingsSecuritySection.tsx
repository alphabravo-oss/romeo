import { AccountSecurityPanel } from "./AccountSecurityPanel";
import { SessionsPanel } from "./SessionsPanel";

export function SettingsSecuritySection() {
  return (
    <div className="grid gap-4">
      <AccountSecurityPanel />
      <SessionsPanel />
    </div>
  );
}
