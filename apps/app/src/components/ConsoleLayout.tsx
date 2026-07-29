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
  const activeLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeLinkRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const navigation = (mobile: boolean) => (
    <nav
      aria-label={title}
      className={mobile ? "rm-console-mobile-sections" : "rm-console-sections"}
    >
      {groups.map((group, gi) => (
        <div
          className={mobile ? "rm-console-mobile-group" : "rm-console-group"}
          key={group.label ?? gi}
        >
          {group.label ? (
            <div
              className={
                mobile
                  ? "rm-console-mobile-group-label"
                  : "rm-console-group-label"
              }
            >
              {group.label}
            </div>
          ) : null}
          {group.items.map((item) => {
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
          })}
        </div>
      ))}
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
