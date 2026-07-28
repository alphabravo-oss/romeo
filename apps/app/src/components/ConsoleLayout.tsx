import { Button } from "@romeo/ui";
import { Link } from "@tanstack/react-router";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import type { ComponentType, ReactNode } from "react";
import { useLocale } from "../lib/i18n";
import { SidebarBrand, SidebarFrame } from "./SidebarFrame";
import { ThemeToggle } from "./ThemeToggle";

export interface ConsoleSection {
  key: string;
  label: string;
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}

export interface ConsoleGroup {
  label?: string;
  items: ConsoleSection[];
}

/**
 * Full-screen enterprise console shell (Settings / Workspace / Admin): a left
 * category nav with a "Back to chat" link, and a content pane on the right.
 */
export function ConsoleLayout({
  title,
  groups,
  active,
  onSelect,
  children,
  userMenu,
}: {
  title: string;
  groups: ConsoleGroup[];
  active: string;
  onSelect: (key: string) => void;
  children: ReactNode;
  userMenu?: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <main className="rm-console">
      <a className="rm-skip-link" href="#console-content">
        {t("skipToContent")}
      </a>
      <SidebarFrame className="rm-console-nav">
        <SidebarBrand className="rm-console-brand" />
        <Link
          aria-label={t("adminBackToChat")}
          className="rm-console-back"
          to="/"
        >
          <ArrowLeft aria-hidden size={16} />
          <span>{t("adminBackToChat")}</span>
        </Link>
        <div className="rm-console-title">{title}</div>
        <nav className="rm-console-sections">
          {groups.map((group, gi) => (
            <div className="rm-console-group" key={group.label ?? gi}>
              {group.label ? (
                <div className="rm-console-group-label">{group.label}</div>
              ) : null}
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    className={`rm-console-item ${item.key === active ? "active" : ""}`}
                    key={item.key}
                    onClick={() => onSelect(item.key)}
                    type="button"
                  >
                    {Icon ? <Icon aria-hidden size={16} /> : null}
                    <span>{item.label}</span>
                  </Button>
                );
              })}
            </div>
          ))}
        </nav>
      </SidebarFrame>
      <section
        className="rm-console-content"
        id="console-content"
        tabIndex={-1}
      >
        <header className="rm-topbar rm-console-topbar">
          <strong>{title}</strong>
          <div className="rm-topbar-actions">
            <ThemeToggle />
            {userMenu}
          </div>
        </header>
        <div className="rm-console-inner">{children}</div>
      </section>
    </main>
  );
}
