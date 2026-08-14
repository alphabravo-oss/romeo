import { Button } from "@romeo/ui";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";

/**
 * Standard page action row. The page's real action owns the primary slot;
 * refresh is a compact utility and never competes with it.
 */
export function PageActions(props: {
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  refreshing?: boolean;
  refreshLabel: string;
}): React.ReactNode {
  return (
    <div className="flex items-center gap-2">
      {props.onRefresh ? (
        // Same bordered 32px control the table toolbar uses. Two different
        // refresh affordances on one page was the tell that these were built
        // separately.
        <Button
          aria-label={props.refreshLabel}
          className="cs-icon-button"
          disabled={props.refreshDisabled === true || props.refreshing === true}
          onClick={props.onRefresh}
          title={props.refreshLabel}
          type="button"
          variant="ghost"
        >
          <RefreshCw aria-hidden size={15} />
        </Button>
      ) : null}
      {props.secondary}
      {props.primary}
    </div>
  );
}
