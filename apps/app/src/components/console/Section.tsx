import { useState, type ReactNode } from "react";

/**
 * A labelled group of related controls or one inventory.
 *
 * Sections separate with a hairline and a fixed rhythm owned here, so a page
 * assembled from three panels written by three people still reads as one page.
 */
export function Section({
  actions,
  children,
  description,
  id,
  title,
  tone = "default",
}: {
  actions?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  id?: string;
  /** Omit when the page header already names this group. */
  title?: ReactNode;
  /** `danger` fences destructive controls off from routine settings. */
  tone?: "danger" | "default";
}): ReactNode {
  // `description` alone is a valid header, and a null action must not emit an
  // empty header row that still consumes the body gap.
  const hasHead = title != null || actions != null || description != null;
  return (
    <section
      className={`cs-section${tone === "danger" ? " cs-section--danger" : ""}`}
      id={id}
    >
      {hasHead ? (
        <header className="cs-section__head">
          <div className="cs-section__copy">
            {title == null ? null : (
              <h3 className="cs-section__title">{title}</h3>
            )}
            {description == null ? null : (
              <p className="cs-section__description">{description}</p>
            )}
          </div>
          {actions == null ? null : (
            <div className="cs-section__actions">{actions}</div>
          )}
        </header>
      ) : null}
      <div className="cs-section__body">{children}</div>
    </section>
  );
}

/**
 * Progressive disclosure inside a section: everyday controls stay visible,
 * tuning and exception-path settings sit behind a summary until asked for.
 *
 * Uses <details> so it works before hydration and is keyboard-operable for
 * free; the open state is mirrored into React only to animate the marker.
 */
export function Disclosure({
  badge,
  children,
  defaultOpen = false,
  description,
  title,
}: {
  /** Short right-aligned status, e.g. "3 configured". */
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  description?: ReactNode;
  title: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="cs-disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary className="cs-disclosure__summary">
        <span aria-hidden="true" className="cs-disclosure__marker" />
        <span className="cs-disclosure__copy">
          <span className="cs-disclosure__title">{title}</span>
          {description === undefined ? null : (
            <span className="cs-disclosure__description">{description}</span>
          )}
        </span>
        {badge === undefined ? null : (
          <span className="cs-disclosure__badge">{badge}</span>
        )}
      </summary>
      <div className="cs-disclosure__body">{children}</div>
    </details>
  );
}

/**
 * A row of at-a-glance counts. Values must come from real query data, never
 * hardcoded.
 */
export function StatRow({
  items,
}: {
  items: {
    label: ReactNode;
    value: ReactNode;
    tone?: "danger" | "default" | "success" | "warning";
  }[];
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <dl className="cs-stats">
      {items.map((item, index) => (
        <div className="cs-stat" key={index}>
          <dt className="cs-stat__label">{item.label}</dt>
          <dd
            className={`cs-stat__value${
              item.tone === undefined || item.tone === "default"
                ? ""
                : ` is-${item.tone}`
            }`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
