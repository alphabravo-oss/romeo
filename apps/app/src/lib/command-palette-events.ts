export const COMMAND_PALETTE_OPEN_EVENT = "romeo:command-palette";
export const COMMAND_PALETTE_INTENT_EVENT = "romeo:command-palette-intent";

export function requestCommandPalette(): void {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT));
}

export function preloadCommandPalette(): void {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_INTENT_EVENT));
}
