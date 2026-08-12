import { Button } from "@romeo/ui";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import SearchIcon from "lucide-react/dist/esm/icons/search.mjs";
import type { ComponentProps, ReactNode } from "react";

/**
 * Filter controls on the left, the group's one real action on the right.
 *
 * Search is capped to a filter's width here rather than at each call site,
 * which is what stopped one page rendering a 1000px-wide search trough while
 * the next rendered a 280px one.
 */
export function Toolbar({
  actions,
  children,
  onSearchChange,
  searchLabel,
  searchPlaceholder,
  searchValue,
}: {
  actions?: ReactNode;
  /** Extra filters — selects, date ranges, segmented controls. */
  children?: ReactNode;
  onSearchChange?: (value: string) => void;
  searchLabel?: string;
  searchPlaceholder?: string;
  searchValue?: string;
}): ReactNode {
  const hasSearch = onSearchChange !== undefined;
  if (!hasSearch && children === undefined && actions === undefined) return null;
  return (
    <div className="cs-toolbar">
      <div className="cs-toolbar__filters">
        {hasSearch ? (
          <label className="cs-search">
            <SearchIcon aria-hidden="true" size={15} />
            <input
              aria-label={searchLabel}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
              placeholder={searchPlaceholder}
              type="search"
              value={searchValue ?? ""}
            />
          </label>
        ) : null}
        {children}
      </div>
      {actions === undefined ? null : (
        <div className="cs-toolbar__actions">{actions}</div>
      )}
    </div>
  );
}

/**
 * The create action. One affordance for "this makes a new thing", everywhere.
 *
 * The console previously spelled this as literal `+ ` text in about twenty
 * places and omitted it in a handful more, so the marker changed page to page.
 * A text plus also sits on the text baseline and never optically matches its
 * label; an icon does.
 */
export function AddButton({
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant"> & {
  children: ReactNode;
}): ReactNode {
  return (
    <Button type="button" {...props} variant="primary">
      <Plus aria-hidden="true" size={15} />
      {children}
    </Button>
  );
}

/** Compact refresh. A utility — it never competes with the primary action. */
export function RefreshButton({
  label,
  onRefresh,
  refreshing = false,
}: {
  label: string;
  onRefresh: () => void;
  refreshing?: boolean;
}): ReactNode {
  return (
    <button
      aria-label={label}
      className="cs-icon-button"
      disabled={refreshing}
      onClick={onRefresh}
      title={label}
      type="button"
    >
      <RefreshCw aria-hidden="true" size={15} />
    </button>
  );
}

/**
 * An empty group is an invitation to act, not a dead end: say what would live
 * here, then offer the one action that creates it.
 */
export function EmptyState({
  action,
  description,
  icon,
  title,
}: {
  action?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}): ReactNode {
  return (
    <div className="cs-empty">
      {icon === undefined ? null : (
        <span aria-hidden="true" className="cs-empty__icon">
          {icon}
        </span>
      )}
      <p className="cs-empty__title">{title}</p>
      {description === undefined ? null : (
        <p className="cs-empty__description">{description}</p>
      )}
      {action === undefined ? null : (
        <div className="cs-empty__action">{action}</div>
      )}
    </div>
  );
}

/**
 * Contextual save bar. Present only while a form is dirty, so a settings page
 * has no permanently-parked Save competing with the page's real work. Cancel is
 * quiet and always precedes the primary action.
 */
export function SaveBar({
  busy = false,
  cancelLabel,
  dirty,
  onCancel,
  onSave,
  saveLabel,
  summary,
}: {
  busy?: boolean;
  cancelLabel: string;
  dirty: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
  summary?: ReactNode;
}): ReactNode {
  if (!dirty) return null;
  return (
    <div className="cs-savebar" role="status">
      <span className="cs-savebar__summary">{summary}</span>
      <div className="cs-savebar__actions">
        <Button disabled={busy} onClick={onCancel} type="button" variant="ghost">
          {cancelLabel}
        </Button>
        <Button
          disabled={busy}
          onClick={onSave}
          pending={busy}
          type="button"
          variant="primary"
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
