import X from "lucide-react/dist/esm/icons/x.mjs";
import { useEffect, useState } from "react";

import { useFocusTrap } from "../lib/use-focus-trap";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "K"], label: "Open command palette" },
  { keys: ["?"], label: "Show this shortcuts sheet" },
  { keys: ["Esc"], label: "Close dialogs & menus" },
  { keys: ["↑", "↓"], label: "Move through command results" },
  { keys: ["↵"], label: "Run the selected command" },
];

export function ShortcutsModal() {
  const [open, setOpen] = useState(false);
  const dialogRef = useFocusTrap({ active: open, onEscape: () => setOpen(false) });

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (event: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable === true;
      if (event.key === "?" && !typing) {
        event.preventDefault();
        setOpen((o) => !o);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("rm-shortcuts", onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("rm-shortcuts", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!open) return null;

  return (
    <>
      <button
        aria-label="Close shortcuts"
        className="rm-modal-backdrop"
        onClick={() => setOpen(false)}
        type="button"
      />
      <div
        aria-label="Keyboard shortcuts"
        aria-modal="true"
        className="rm-shortcuts"
        ref={dialogRef}
        role="dialog"
      >
        <div className="rm-shortcuts-head">
          <span>Keyboard shortcuts</span>
          <button
            aria-label="Close"
            className="rm-icon-button"
            onClick={() => setOpen(false)}
            type="button"
          >
            <X aria-hidden size={16} />
          </button>
        </div>
        <div className="rm-shortcuts-body">
          {SHORTCUTS.map((s) => (
            <div className="rm-shortcuts-row" key={s.label}>
              <span>{s.label}</span>
              <span className="rm-shortcuts-keys">
                {s.keys.map((k) => (
                  <kbd className="rm-kbd" key={k}>
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
