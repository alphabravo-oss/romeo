import { useStore } from "@tanstack/react-store";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";

import { dismissToast, toastStore } from "../lib/toast";

export function Toaster() {
  const toasts = useStore(toastStore);
  if (toasts.length === 0) return null;
  return (
    <div aria-atomic="true" aria-live="polite" className="rm-toaster">
      {toasts.map((t) => (
        <div
          className={`rm-toast ${t.tone}`}
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
        >
          {t.tone === "success" ? (
            <Check aria-hidden size={15} />
          ) : t.tone === "error" ? (
            <TriangleAlert aria-hidden size={15} />
          ) : null}
          <span>{t.message}</span>
          <button
            aria-label="Dismiss"
            className="rm-toast-x"
            onClick={() => dismissToast(t.id)}
            type="button"
          >
            <X aria-hidden size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
