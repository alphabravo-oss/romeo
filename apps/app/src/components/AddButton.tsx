import { Button } from "@romeo/ui";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import type { ComponentProps, ReactNode } from "react";

/**
 * The create action for a console section.
 *
 * The console had ~20 buttons spelling this as the literal text `+ {label}` and
 * another handful with no marker at all, so the affordance for "this makes a
 * new thing" changed page to page. A text plus also sits on the text baseline
 * and never optically matches the label; a real icon does.
 *
 *   <AddButton onClick={open}>{t("addProvider")}</AddButton>
 *
 * Every other Button prop passes through, so `asChild` still works for links:
 *
 *   <AddButton asChild><Link to="/admin">{t("addProvider")}</Link></AddButton>
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
