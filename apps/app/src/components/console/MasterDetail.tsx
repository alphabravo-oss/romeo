import { Button } from "@romeo/ui";
import type { ReactNode } from "react";

/**
 * Two-pane layout for "pick one, then edit it" screens — the agent studio, and
 * anything else that grows a list beside a form.
 *
 * The list is a card so the selection stays visible while you scroll the
 * detail, which is what a dropdown in the page header could never do: it hid
 * the set you were choosing from and gave no sense of how many there were.
 */
export function MasterDetail({
  children,
  list,
}: {
  children: ReactNode;
  list: ReactNode;
}): ReactNode {
  return (
    <div className="cs-masterdetail">
      <div className="cs-masterdetail__list">{list}</div>
      <div className="cs-masterdetail__detail">{children}</div>
    </div>
  );
}

/** The selectable list itself — one bordered card, rows divided by hairlines. */
export function MasterList({
  children,
  search,
}: {
  children: ReactNode;
  /** Optional filter control, rendered above the card. */
  search?: ReactNode;
}): ReactNode {
  return (
    <>
      {search}
      <div className="cs-masterlist">{children}</div>
    </>
  );
}

export function MasterListItem({
  badge,
  meta,
  onSelect,
  selected,
  title,
}: {
  badge?: ReactNode;
  meta?: ReactNode;
  onSelect: () => void;
  selected: boolean;
  title: ReactNode;
}): ReactNode {
  return (
    <Button
      aria-current={selected ? "true" : undefined}
      className={`cs-masterlist__item${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      type="button"
      variant="ghost"
    >
      <span className="cs-masterlist__line">
        <span className="cs-masterlist__title">{title}</span>
        {badge === undefined ? null : (
          <span className="cs-masterlist__badge">{badge}</span>
        )}
      </span>
      {meta === undefined ? null : (
        <span className="cs-masterlist__meta">{meta}</span>
      )}
    </Button>
  );
}
