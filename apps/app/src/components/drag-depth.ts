// Pure drag-depth state for ChatPanel. Kept UI-free (and import-free) because
// dragenter/dragleave ordering is subtle and the app's tests run without a
// DOM.
//
// Browser drag events fire once per descendant, not once per drop zone. A
// boolean therefore hides the overlay while the pointer is still inside when
// it crosses from one child to another. Depth tracks those paired events,
// while reset handles window-level drop/dragend after an aborted drag. The
// clamp is deliberate: unmatched browser events must never leave a negative
// depth that makes later enters invisible.

export type DragDepthEvent = "enter" | "leave" | "reset";

export function nextDragDepth(depth: number, event: DragDepthEvent): number {
  if (event === "reset") return 0;
  if (event === "enter") return Math.max(0, depth) + 1;
  return Math.max(0, depth - 1);
}

export function isDragOverlayVisible(depth: number): boolean {
  return depth > 0;
}
