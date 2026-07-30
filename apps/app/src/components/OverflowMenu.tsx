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
}: {
  items: OverflowMenuItem[];
  label?: string;
}): React.ReactNode {
  if (items.length === 0) return null;
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
          <MoreVertical aria-hidden="true" size={16} />
        </IconButton>
      }
    />
  );
}
