import { toast as primitiveToast } from "@romeo/ui";

export type ToastTone = "default" | "success" | "error";

/** Compatibility adapter while call sites move to the design-system toast API. */
export function toast(message: string, tone: ToastTone = "default"): void {
  if (tone === "success") {
    primitiveToast.success(message);
    return;
  }
  if (tone === "error") {
    primitiveToast.error(message);
    return;
  }
  primitiveToast(message);
}
