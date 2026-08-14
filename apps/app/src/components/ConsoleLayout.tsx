import { Button, Sheet } from "@romeo/ui";
import { Link } from "@tanstack/react-router";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import Menu from "lucide-react/dist/esm/icons/menu.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocale } from "../lib/i18n";
import "../styles/app-content.css";
import "../styles/console.css";
import { SidebarBrand, SidebarFrame } from "./SidebarFrame";
import { ThemeToggle } from "./ThemeToggle";
import { useWorkspaceIntentPrefetch } from "./useWorkspaceIntentPrefetch";
import { useWorkspace } from "./WorkspaceContext";

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
  onSectionIntent,
}: {
  title: string;
  groups: ConsoleGroup[];
  active: string;
  route: "/admin" | "/settings" | "/workspace";
  children: ReactNode;
  userMenu?: ReactNode;
  onSectionIntent?: (section: string) => Promise<void> | void;
}) {
  const { t } = useLocale();
  const prefetchWorkspace = useWorkspaceIntentPrefetch();
  const { workspaceId } = useWorkspace();
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
              <Button
                aria-expanded={expanded}
                className={
                  mobile
                    ? "rm-console-mobile-group-label"
                    : "rm-console-group-toggle"
                }
                onClick={() => toggleGroup(groupId)}
                type="button"
                variant="ghost"
              >
                <span>{group.label}</span>
                <span aria-hidden="true" className="rm-console-group-chevron">
                  {expanded ? "▾" : "▸"}
                </span>
              </Button>
            ) : null}
            {expanded || !group.label
              ? group.items.map((item) => {
                  const isActive = item.key === active;
                  return (
                    <Button
                      asChild
                      className={`rm-console-item ${isActive ? "active" : ""}`}
                      key={item.key}
                    >
                      <Link
                        aria-current={isActive ? "page" : undefined}
                        onFocus={() =>
                          runSectionIntent(onSectionIntent, item.key)
                        }
                        onClick={() => {
                          if (mobile) setMobileNavigationOpen(false);
                        }}
                        onMouseEnter={() =>
                          runSectionIntent(onSectionIntent, item.key)
                        }
                        preload={route === "/admin" ? false : "intent"}
                        ref={isActive && !mobile ? activeLinkRef : undefined}
                        search={(previous) => ({
                          ...previous,
                          section: item.key,
                          ...(workspaceId === undefined
                            ? {}
                            : { workspace: workspaceId }),
                        })}
                        to={route}
                      >
                        {/* A dot, not the section icon: at 13px the icons read
                            as visual noise down a 24-item rail, and the same
                            icon already labels the section on the overview.
                            The dot carries alignment and active state only. */}
                        <span aria-hidden="true" className="rm-console-dot" />
                        <span className="rm-console-item-label">
                          {item.label}
                        </span>
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
        <div className="rm-console-railtop">
          <Link
            aria-label={t("adminBackToChat")}
            className="rm-console-back"
            preload="intent"
            search={workspaceId === undefined ? {} : { workspace: workspaceId }}
            to="/"
          >
            <ArrowLeft aria-hidden size={14} />
            <span>{t("adminBackToChat")}</span>
          </Link>
          {/* Workspace and Admin are peer consoles, so switching between them
              belongs in the rail rather than behind a trip through the chat. */}
          <div className="rm-console-switch" role="group">
            <Link
              className={`rm-console-switch__tab${
                route === "/workspace" ? " is-active" : ""
              }`}
              onFocus={prefetchWorkspace}
              onMouseEnter={prefetchWorkspace}
              preload="intent"
              search={
                workspaceId === undefined ? {} : { workspace: workspaceId }
              }
              to="/workspace"
            >
              {t("workspace")}
            </Link>
            <Link
              className={`rm-console-switch__tab${
                route === "/admin" ? " is-active" : ""
              }`}
              preload={false}
              search={
                workspaceId === undefined ? {} : { workspace: workspaceId }
              }
              to="/admin"
            >
              {t("admin")}
            </Link>
          </div>
        </div>
        {navigation(false)}
      </SidebarFrame>
      <section
        className="rm-console-content"
        id="console-content"
        tabIndex={-1}
      >
        <header className="rm-topbar rm-console-topbar">
          {/* Breadcrumb, not a bare title: it names the console you are in and
              the section you are on, which the page heading below cannot do. */}
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
            <span className="rm-console-crumb">{title}</span>
            <span aria-hidden="true" className="rm-console-crumb-sep">
              /
            </span>
            <strong className="rm-console-crumb-current">
              {activeLabel(groups, active) ?? title}
            </strong>
          </div>
          <div className="rm-topbar-actions">
            {/* Opens the existing command palette; the shortcut hint is the
                affordance that tells people it exists at all. */}
            <Button
              className="rm-console-omnisearch"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("romeo:command-palette"))
              }
              type="button"
              variant="ghost"
            >
              <Search aria-hidden size={14} />
              <span className="rm-console-omnisearch__label">
                {t("searchCommands")}
              </span>
              <kbd className="rm-console-omnisearch__kbd">⌘K</kbd>
            </Button>
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
          <Link
            onClick={() => setMobileNavigationOpen(false)}
            preload="intent"
            search={workspaceId === undefined ? {} : { workspace: workspaceId }}
            to="/"
          >
            <ArrowLeft aria-hidden size={16} />
            <span>{t("adminBackToChat")}</span>
          </Link>
        </Button>
        {navigation(true)}
      </Sheet>
    </main>
  );
}

function runSectionIntent(
  onSectionIntent: ((section: string) => Promise<void> | void) | undefined,
  section: string,
): void {
  if (onSectionIntent === undefined) return;
  try {
    void Promise.resolve(onSectionIntent(section)).catch(() => undefined);
  } catch {
    // Navigation remains authoritative if a speculative chunk cannot load.
  }
}

/** Label of the section currently shown, for the topbar breadcrumb. */
function activeLabel(
  groups: ConsoleGroup[],
  active: string,
): string | undefined {
  for (const group of groups) {
    const item = group.items.find((candidate) => candidate.key === active);
    if (item) return item.label;
  }
  return undefined;
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
