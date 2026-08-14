import { sidebarMax, sidebarMin, useSidebarResize } from "./useSidebarResize";

export function SidebarResizer({ label }: { label: string }) {
  const resize = useSidebarResize();
  return (
    <div
      aria-controls="main-content"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={sidebarMax}
      aria-valuemin={sidebarMin}
      aria-valuenow={resize.width}
      className="rm-sidebar-resizer"
      onKeyDown={resize.onKeyDown}
      onPointerDown={resize.onPointerDown}
      role="separator"
      tabIndex={0}
    />
  );
}
