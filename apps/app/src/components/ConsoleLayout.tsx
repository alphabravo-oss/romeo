import { Button, Sheet } from "@romeo/ui";
import { Link } from "@tanstack/react-router";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import Menu from "lucide-react/dist/esm/icons/menu.mjs";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocale } from "../lib/i18n";
import { SidebarBrand, SidebarFrame } from "./SidebarFrame";
import { ThemeToggle } from "./ThemeToggle";

export interface ConsoleSection {
  key: string;
  label: string;
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}

export interface ConsoleGroup {
  id?: string;
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
  route,
  children,
  userMenu,
}: {
  title: string;
  groups: ConsoleGroup[];
  active: string;
  route: "/admin" | "/settings" | "/workspace";
  children: ReactNode;
  userMenu?: ReactNode;
}) {
  const { t } = useLocale();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(() =>
    initialExpandedGroups(route, groups, active),
  );
  const activeLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeLinkRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    const groupId = groupIdForSection(groups, active);
    if (groupId === undefined) return;
    setExpandedGroups((current) => {
      if (current.has(groupId)) return current;
      const next = new Set(current);
      next.add(groupId);
      persistExpandedGroups(route, next);
      return next;
    });
  }, [active, groups, route]);

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      persistExpandedGroups(route, next);
      return next;
    });
  }

  const navigation = (mobile: boolean) => (
    <nav
      aria-label={title}
      className={mobile ? "rm-console-mobile-sections" : "rm-console-sections"}
    >
      {groups.map((group, gi) => {
        const groupId = group.id ?? String(gi);
        const expanded = expandedGroups.has(groupId);
        return (
          <div
            className={mobile ? "rm-console-mobile-group" : "rm-console-group"}
            key={groupId}
          >
            {group.label ? (
              <button
                aria-expanded={expanded}
                className={
                  mobile
                    ? "rm-console-mobile-group-label"
                    : "rm-console-group-toggle"
                }
                onClick={() => toggleGroup(groupId)}
                type="button"
              >
                <span>{group.label}</span>
                <span aria-hidden="true" className="rm-console-group-chevron">
                  {expanded ? "▾" : "▸"}
                </span>
              </button>
            ) : null}
            {expanded || !group.label
              ? group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.key === active;
                  return (
                    <Button
                      asChild
                      className={`rm-console-item ${isActive ? "active" : ""}`}
                      key={item.key}
                    >
                      <Link
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => {
                          if (mobile) setMobileNavigationOpen(false);
                        }}
                        ref={isActive && !mobile ? activeLinkRef : undefined}
                        search={{ section: item.key }}
                        to={route}
                      >
                        {Icon ? <Icon aria-hidden size={16} /> : null}
                        <span>{item.label}</span>
                      </Link>
                    </Button>
                  );
                })
              : null}
          </div>
        );
      })}
    </nav>
  );

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
        {navigation(false)}
      </SidebarFrame>
      <section
        className="rm-console-content"
        id="console-content"
        tabIndex={-1}
      >
        <header className="rm-topbar rm-console-topbar">
          <div className="rm-console-topbar-heading">
            <Button
              aria-label={t("openNavigation")}
              className="rm-console-mobile-trigger"
              onClick={() => setMobileNavigationOpen(true)}
              size="icon"
              variant="ghost"
            >
              <Menu aria-hidden size={18} />
            </Button>
            <strong>{title}</strong>
          </div>
          <div className="rm-topbar-actions">
            <ThemeToggle />
            {userMenu}
          </div>
        </header>
        <div className="rm-console-inner">{children}</div>
      </section>
      <Sheet
        closeLabel={t("close")}
        description={t("chooseConsoleSection")}
        onOpenChange={setMobileNavigationOpen}
        open={mobileNavigationOpen}
        side="left"
        title={title}
      >
        <Button asChild className="rm-console-mobile-back" variant="ghost">
          <Link onClick={() => setMobileNavigationOpen(false)} to="/">
            <ArrowLeft aria-hidden size={16} />
            <span>{t("adminBackToChat")}</span>
          </Link>
        </Button>
        {navigation(true)}
      </Sheet>
    </main>
  );
}

function groupIdForSection(
  groups: ConsoleGroup[],
  active: string,
): string | undefined {
  const index = groups.findIndex((group) =>
    group.items.some((item) => item.key === active),
  );
  if (index < 0) return undefined;
  return groups[index]?.id ?? String(index);
}

function storageKey(route: string): string {
  return `romeo:console-nav:${route}`;
}

function initialExpandedGroups(
  route: string,
  groups: ConsoleGroup[],
  active: string,
): Set<string> {
  const expanded = new Set<string>();
  const activeGroup = groupIdForSection(groups, active);
  if (activeGroup !== undefined) expanded.add(activeGroup);
  if (typeof window === "undefined") return expanded;
  try {
    const raw = window.localStorage.getItem(storageKey(route));
    if (raw === null) return expanded;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return expanded;
    for (const value of parsed) {
      if (typeof value === "string") expanded.add(value);
    }
  } catch {
    return expanded;
  }
  return expanded;
}

function persistExpandedGroups(route: string, groups: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(route), JSON.stringify([...groups]));
  } catch {
    // Private mode / quota — expansion stays in memory.
  }
}
