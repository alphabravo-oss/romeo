import { useEffect, useState } from "react";

import { useLocale } from "../lib/i18n";
import { OverlayHeader, OverlayShell } from "./OverlayShell";

export function ShortcutsModal() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

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

  const shortcuts = [
    { keys: ["⌘", "K"], label: t("openCommandPalette") },
    { keys: ["?"], label: t("showShortcutsSheet") },
    { keys: ["Esc"], label: t("closeDialogsMenus") },
    { keys: ["↑", "↓"], label: t("moveThroughCommandResults") },
    { keys: ["↵"], label: t("runSelectedCommand") },
  ];

  return (
    <OverlayShell
      ariaLabel={t("keyboardShortcuts")}
      labelledBy="rm-shortcuts-title"
      onClose={() => setOpen(false)}
      open={open}
      variant="shortcuts"
    >
      <OverlayHeader
        closeLabel={t("close")}
        onClose={() => setOpen(false)}
        title={t("keyboardShortcuts")}
        titleId="rm-shortcuts-title"
      />
      <div className="rm-ui-dialog__body rm-shortcuts-body">
        {shortcuts.map((s) => (
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
    </OverlayShell>
  );
}
