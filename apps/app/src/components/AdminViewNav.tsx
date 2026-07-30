import { Link } from "@tanstack/react-router";
import { Button } from "@romeo/ui";

export function AdminViewNav({
  active,
  ariaLabel,
  items,
  section,
}: {
  active: string;
  ariaLabel: string;
  items: ReadonlyArray<readonly [string, string]>;
  section: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="rm-ui-tabs">
      <div className="rm-ui-tabs__list">
        {items.map(([value, label]) => (
          <Button
            asChild
            className="rm-ui-tabs__trigger"
            data-state={active === value ? "active" : "inactive"}
            key={value}
            variant="ghost"
          >
            <Link
              aria-current={active === value ? "page" : undefined}
              search={{ section, view: value }}
              to="/admin"
            >
              {label}
            </Link>
          </Button>
        ))}
      </div>
    </nav>
  );
}
