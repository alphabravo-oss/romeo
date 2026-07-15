import { Store } from "@tanstack/store";

export type ToastTone = "default" | "success" | "error";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

let seq = 0;

/** Module-level TanStack Store — globally accessible, no provider needed. */
export const toastStore = new Store<Toast[]>([]);

export function dismissToast(id: number): void {
  toastStore.setState((toasts) => toasts.filter((t) => t.id !== id));
}

export function toast(message: string, tone: ToastTone = "default"): void {
  const id = (seq += 1);
  toastStore.setState((toasts) => [...toasts, { id, message, tone }]);
  setTimeout(() => dismissToast(id), 4200);
}
