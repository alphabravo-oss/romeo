import { Link } from "@tanstack/react-router";
import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import LogOut from "lucide-react/dist/esm/icons/log-out.mjs";
import Settings from "lucide-react/dist/esm/icons/settings.mjs";
import Shield from "lucide-react/dist/esm/icons/shield.mjs";
import User from "lucide-react/dist/esm/icons/user.mjs";
import { Button, DropdownMenuPrimitive } from "@romeo/ui";

import { logout } from "../features";
import { useLocale } from "../lib/i18n";

export function WorkspaceUserMenu({
  isAdmin,
  userLabel,
}: {
  isAdmin: boolean;
  userLabel: string;
}) {
  const { t } = useLocale();
  const initial = userInitial(userLabel);
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <Button
          aria-label={userLabel}
          className="rm-topbar-user-button"
          title={userLabel}
          variant="ghost"
        >
          <span className="rm-user-avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="rm-topbar-user-copy">{userLabel}</span>
        </Button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          className="rm-ui-menu rm-topbar-user-menu"
          sideOffset={6}
        >
          <DropdownMenuPrimitive.Label className="rm-user-menu-identity">
            {userLabel}
          </DropdownMenuPrimitive.Label>
          <DropdownMenuPrimitive.Item asChild>
            <Link
              className="rm-ui-menu__item rm-user-menu-item"
              to="/workspace"
            >
              <Bot aria-hidden="true" size={15} />
              <span>{t("workspace")}</span>
            </Link>
          </DropdownMenuPrimitive.Item>
          <DropdownMenuPrimitive.Item asChild>
            <Link className="rm-ui-menu__item rm-user-menu-item" to="/settings">
              <Settings aria-hidden="true" size={15} />
              <span>{t("settings")}</span>
            </Link>
          </DropdownMenuPrimitive.Item>
          <DropdownMenuPrimitive.Item asChild>
            <Link
              className="rm-ui-menu__item rm-user-menu-item"
              search={{ section: "account" }}
              to="/settings"
            >
              <User aria-hidden="true" size={15} />
              <span>{t("profile")}</span>
            </Link>
          </DropdownMenuPrimitive.Item>
          {isAdmin ? (
            <DropdownMenuPrimitive.Item asChild>
              <Link className="rm-ui-menu__item rm-user-menu-item" to="/admin">
                <Shield aria-hidden="true" size={15} />
                <span>{t("adminConsole")}</span>
              </Link>
            </DropdownMenuPrimitive.Item>
          ) : null}
          <DropdownMenuPrimitive.Separator className="rm-ui-separator" />
          <DropdownMenuPrimitive.Item
            className="rm-ui-menu__item rm-user-menu-item"
            onSelect={() => {
              void logout().finally(() => {
                window.location.href = "/login";
              });
            }}
          >
            <LogOut aria-hidden="true" size={15} />
            <span>{t("logout")}</span>
          </DropdownMenuPrimitive.Item>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

function userInitial(label: string): string {
  const trimmed = label.trim();
  const at = trimmed.indexOf("@");
  const source = at > 0 ? trimmed.slice(0, at) : trimmed;
  const letter = source[0];
  return letter === undefined ? "?" : letter.toUpperCase();
}
