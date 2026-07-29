import { IconButton } from "@romeo/ui";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";

/**
 * Standard page action row. The page's real action owns the primary slot;
 * refresh is a compact utility and never competes with it.
 */
export function PageActions(props: {
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshLabel: string;
}): React.ReactNode {
  return (
    <div className="flex items-center gap-2">
      {props.onRefresh ? (
        <IconButton
          aria-label={props.refreshLabel}
          disabled={props.refreshing === true}
          onClick={props.onRefresh}
          size="sm"
          variant="ghost"
        >
          <RefreshCw aria-hidden size={16} />
        </IconButton>
      ) : null}
      {props.secondary}
      {props.primary}
    </div>
  );
}
