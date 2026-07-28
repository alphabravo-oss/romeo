import { Dialog } from "@romeo/ui";
import { useLocale } from "../lib/i18n";

/**
 * Centered modal for create/edit forms — the standard progressive-disclosure
 * shell (open behind a "+ Add X" / "Edit" button, not inline). Shares the
 * backdrop + focus-trap behavior with ConfirmDialog. Controlled: the caller
 * owns `open` and renders the form as `children`.
 *
 *   const [open, setOpen] = useState(false)
 *   <Button variant="primary" onClick={() => setOpen(true)}>+ Add key</Button>
 *   <FormDialog open={open} title="New API key" onClose={() => setOpen(false)}>
 *     <form>…</form>
 *   </FormDialog>
 */
export function FormDialog(props: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactNode {
  const { t } = useLocale();
  const { open, title, description, onClose, children } = props;
  return (
    <Dialog
      closeLabel={t("close")}
      {...(description === undefined ? {} : { description })}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
      title={title}
    >
      {children}
    </Dialog>
  );
}
