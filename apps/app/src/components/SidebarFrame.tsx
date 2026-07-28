import { Link } from "@tanstack/react-router";
import BotMessageSquare from "lucide-react/dist/esm/icons/bot-message-square.mjs";
import type { ReactNode } from "react";

import { useLocale } from "../lib/i18n";

export function SidebarFrame({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return <aside className={`rm-sidebar-frame ${className}`}>{children}</aside>;
}

export function SidebarBrand({ className = "" }: { className?: string }) {
  const { t } = useLocale();

  return (
    <Link
      aria-label={`Romeo ${t("enterpriseChat")}`}
      className={`rm-sidebar-brand rm-sidebar-brand-fixed ${className}`.trim()}
      to="/"
    >
      <div className="rm-logo-mark">
        <BotMessageSquare aria-hidden="true" size={18} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">Romeo</div>
        <div className="rm-brand-tagline truncate">{t("enterpriseChat")}</div>
      </div>
    </Link>
  );
}
