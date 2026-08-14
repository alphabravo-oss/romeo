import { Button } from "@romeo/ui";
import type { ReactNode } from "react";

/**
 * Linear-style inventory row: title + quiet meta on the left, actions on
 * the right. Used instead of bordered ID tiles or a grid of naked buttons.
 */
export function ResourceRow(props: {
  title: string;
  meta?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}): ReactNode {
  const interactive = props.onSelect !== undefined && props.disabled !== true;
  return (
    <div
      className="rm-resource-row"
      data-disabled={props.disabled === true ? "true" : undefined}
      data-selected={props.selected === true ? "true" : undefined}
    >
      {interactive ? (
        <Button
          className="rm-resource-row__main"
          onClick={props.onSelect}
          type="button"
          variant="ghost"
        >
          <ResourceRowCopy {...copyProps(props)} />
        </Button>
      ) : (
        <div className="rm-resource-row__main">
          <ResourceRowCopy {...copyProps(props)} />
        </div>
      )}
      {props.actions ? (
        <div className="rm-resource-row__actions">{props.actions}</div>
      ) : null}
    </div>
  );
}

function copyProps(props: {
  title: string;
  meta?: string;
  badge?: ReactNode;
}): { title: string; meta?: string; badge?: ReactNode } {
  return {
    title: props.title,
    ...(props.meta === undefined ? {} : { meta: props.meta }),
    ...(props.badge === undefined ? {} : { badge: props.badge }),
  };
}

function ResourceRowCopy(props: {
  title: string;
  meta?: string;
  badge?: ReactNode;
}): ReactNode {
  return (
    <span className="rm-resource-row__copy">
      <span className="rm-resource-row__title-line">
        <span className="rm-resource-row__title">{props.title}</span>
        {props.badge}
      </span>
      {props.meta ? (
        <span className="rm-resource-row__meta">{props.meta}</span>
      ) : null}
    </span>
  );
}
