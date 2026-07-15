import X from "lucide-react/dist/esm/icons/x.mjs";

import { useFocusTrap } from "../lib/use-focus-trap";

/**
 * Centered modal for create/edit forms — the standard progressive-disclosure
 * shell (open behind a "+ Add X" / "Edit" button, not inline). Shares the
 * backdrop + focus-trap behavior with ConfirmDialog. Controlled: the caller
 * owns `open` and renders the form as `children`.
 *
 *   const [open, setOpen] = useState(false)
 *   <button className="rm-button primary" onClick={() => setOpen(true)}>+ Add key</button>
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
  const { open, title, description, onClose, children } = props;
  const ref = useFocusTrap({ active: open, onEscape: onClose });
  if (!open) return null;

  return (
    <>
      <button
        aria-label="Close"
        className="rm-modal-backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-labelledby="rm-form-dialog-title"
        aria-modal="true"
        className="rm-form-dialog"
        ref={ref}
        role="dialog"
      >
        <header className="rm-form-dialog-head">
          <div className="min-w-0">
            <h2 className="rm-form-dialog-title" id="rm-form-dialog-title">
              {title}
            </h2>
            {description !== undefined ? (
              <p className="rm-form-dialog-desc">{description}</p>
            ) : null}
          </div>
          <button
            aria-label="Close"
            className="rm-icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div className="rm-form-dialog-body">{children}</div>
      </div>
    </>
  );
}
