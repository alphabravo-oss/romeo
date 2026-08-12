import { useState, type ReactNode } from "react";

/**
 * Progressive disclosure for admin forms: everyday controls stay visible,
 * infrastructure and exception-path settings sit behind a summary until needed.
 */
export function AdminDisclosure({
  badge,
  children,
  defaultOpen = false,
  description,
  title,
}: {
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  description?: string;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="rm-admin-disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary className="rm-admin-disclosure__summary">
        <span className="rm-admin-disclosure__copy">
          <span className="rm-admin-disclosure__title">{title}</span>
          {description ? (
            <span className="rm-admin-disclosure__description">
              {description}
            </span>
          ) : null}
        </span>
        {badge ? (
          <span className="rm-admin-disclosure__badge">{badge}</span>
        ) : null}
      </summary>
      <div className="rm-admin-disclosure__body">{children}</div>
    </details>
  );
}
