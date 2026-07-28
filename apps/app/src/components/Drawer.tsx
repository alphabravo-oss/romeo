import { Sheet } from "@romeo/ui";
import { useLocale } from "../lib/i18n";

/** Accessible right-side detail sheet for row-to-detail flows. */
export function Drawer(props: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactNode {
  const { t } = useLocale();
  const { open, title, description, onClose, children } = props;
  return (
    <Sheet
      closeLabel={t("close")}
      {...(description === undefined ? {} : { description })}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
      side="right"
      title={title}
    >
      {children}
    </Sheet>
  );
}
