import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal.mjs";
import MoreVertical from "lucide-react/dist/esm/icons/more-vertical.mjs";
import { DropdownMenu, IconButton } from "@romeo/ui";

export interface OverflowMenuItem {
  label: string;
  description?: string;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}

/** Standard keyboard-accessible row action menu. */
export function OverflowMenu({
  items,
  label = "More actions",
  orientation = "horizontal",
}: {
  items: OverflowMenuItem[];
  label?: string;
  orientation?: "horizontal" | "vertical";
}): React.ReactNode {
  if (items.length === 0) return null;
  const Icon = orientation === "vertical" ? MoreVertical : MoreHorizontal;
  return (
    <DropdownMenu
      items={items.map((item) => ({
        danger: item.tone === "danger",
        ...(item.disabled ? { disabled: true } : {}),
        label: (
          <span className="grid gap-0.5">
            <span>{item.label}</span>
            {item.description ? <small>{item.description}</small> : null}
          </span>
        ),
        onSelect: item.onClick,
      }))}
      trigger={
        <IconButton
          aria-label={label}
          className="rm-icon-button"
          variant="ghost"
        >
          <Icon aria-hidden="true" size={16} />
        </IconButton>
      }
    />
  );
}
