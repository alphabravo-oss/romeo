import { Button } from "@romeo/ui";
import type { ReactNode } from "react";

/**
 * A console page: title, one line of orientation, an optional tab strip, and a
 * stack of {@link Section}s.
 *
 * The page owns the rhythm *between* sections and nothing inside them. Panels
 * pass content and never spacing — no `mt-4`, no `mb-2`, no bare heading divs.
 * That is the whole reason the console stays consistent: there is nothing left
 * for two panels to disagree about.
 */
export function Page({
  actions,
  children,
  description,
  tabs,
  title,
}: {
  /** Page-level action. Prefer putting actions on the Section they belong to. */
  actions?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  /** Peer views of the same subject — render <PageTabs>. */
  tabs?: ReactNode;
  title: ReactNode;
}): ReactNode {
  return (
    <div className="cs-page">
      <header className="cs-page__head">
        <div className="cs-page__copy">
          <h2 className="cs-page__title">{title}</h2>
          {description === undefined ? null : (
            <p className="cs-page__description">{description}</p>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="cs-page__actions">{actions}</div>
        )}
      </header>
      {tabs}
      <div className="cs-page__body">{children}</div>
    </div>
  );
}

/**
 * Tab strip for peer views of one subject (Providers / Base models / Custom
 * models). Underline tabs, never filled pills — the console has exactly one
 * tab style.
 */
export function PageTabs({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: ReactNode;
}): ReactNode {
  return (
    <nav aria-label={ariaLabel} className="cs-tabs">
      {children}
    </nav>
  );
}

export function PageTab({
  active,
  children,
  href,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  href?: string;
  onClick?: () => void;
}): ReactNode {
  const className = `cs-tab${active ? " is-active" : ""}`;
  if (href !== undefined) {
    return (
      <a
        aria-current={active ? "page" : undefined}
        className={className}
        href={href}
      >
        {children}
      </a>
    );
  }
  return (
    <Button
      aria-current={active ? "page" : undefined}
      className={className}
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}
