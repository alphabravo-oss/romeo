import { Link } from "@tanstack/react-router";
import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
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
  const roleLabel = isAdmin ? t("admin") : t("member");
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <Button
          aria-label={`${userLabel}, ${roleLabel}`}
          className="rm-topbar-user-button"
          variant="ghost"
        >
          <span className="rm-user-avatar">
            <User aria-hidden="true" size={15} />
          </span>
          <span className="rm-topbar-user-copy">
            <strong>{userLabel}</strong>
            <small>{roleLabel}</small>
          </span>
          <ChevronDown aria-hidden="true" size={14} />
        </Button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          className="rm-ui-menu rm-user-menu rm-topbar-user-menu"
        >
          <DropdownMenuPrimitive.Label className="rm-user-menu-identity">
            <strong>{userLabel}</strong>
            <small>{roleLabel}</small>
          </DropdownMenuPrimitive.Label>
          {isAdmin ? (
            <DropdownMenuPrimitive.Item asChild>
              <Link
                className="rm-ui-menu__item rm-user-menu-item"
                to="/workspace"
              >
                <Bot aria-hidden="true" size={16} />
                <span>{t("workspaceSettings")}</span>
              </Link>
            </DropdownMenuPrimitive.Item>
          ) : null}
          <DropdownMenuPrimitive.Item asChild>
            <Link className="rm-ui-menu__item rm-user-menu-item" to="/settings">
              <Settings aria-hidden="true" size={16} />
              <span>{t("settings")}</span>
            </Link>
          </DropdownMenuPrimitive.Item>
          <DropdownMenuPrimitive.Item asChild>
            <Link
              className="rm-ui-menu__item rm-user-menu-item"
              search={{ section: "account" }}
              to="/settings"
            >
              <User aria-hidden="true" size={16} />
              <span>{t("profile")}</span>
            </Link>
          </DropdownMenuPrimitive.Item>
          {isAdmin ? (
            <DropdownMenuPrimitive.Item asChild>
              <Link className="rm-ui-menu__item rm-user-menu-item" to="/admin">
                <Shield aria-hidden="true" size={16} />
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
            <LogOut aria-hidden="true" size={16} />
            <span>{t("logout")}</span>
          </DropdownMenuPrimitive.Item>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
