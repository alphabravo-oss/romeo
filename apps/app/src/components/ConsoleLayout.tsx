import { Link } from "@tanstack/react-router";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import type { ComponentType, ReactNode } from "react";

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
}: {
  title: string;
  groups: ConsoleGroup[];
  active: string;
  onSelect: (key: string) => void;
  children: ReactNode;
}) {
  return (
    <main className="rm-console">
      <aside className="rm-console-nav">
        <Link className="rm-console-back" to="/">
          <ArrowLeft aria-hidden size={16} />
          <span>Back to chat</span>
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
                  <button
                    className={`rm-console-item ${item.key === active ? "active" : ""}`}
                    key={item.key}
                    onClick={() => onSelect(item.key)}
                    type="button"
                  >
                    {Icon ? <Icon aria-hidden size={16} /> : null}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <section className="rm-console-content">
        <div className="rm-console-inner">{children}</div>
      </section>
    </main>
  );
}
