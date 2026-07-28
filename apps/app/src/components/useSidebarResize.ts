import { useEffect } from "react";

const sidebarMin = 220;
const sidebarMax = 480;
const sidebarStorageKey = "rm-sidebar-width";

export function useSidebarResize() {
  useEffect(() => {
    const saved = localStorage.getItem(sidebarStorageKey);
    if (saved) {
      document.documentElement.style.setProperty(
        "--rm-sidebar-width",
        `${saved}px`,
      );
    }
  }, []);

  return (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth();
    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(
        sidebarMax,
        Math.max(sidebarMin, startWidth + moveEvent.clientX - startX),
      );
      document.documentElement.style.setProperty(
        "--rm-sidebar-width",
        `${next}px`,
      );
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      localStorage.setItem(
        sidebarStorageKey,
        String(Math.round(sidebarWidth())),
      );
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
}

function sidebarWidth(): number {
  return (
    document.querySelector(".rm-sidebar")?.getBoundingClientRect().width ?? 260
  );
}
