import { cva, type VariantProps } from "class-variance-authority";
import { Toaster as SonnerToaster, toast } from "sonner";
import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./lib/cn";

export function EmptyState({
  action,
  children,
  className,
  icon,
  title,
}: {
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className={cn("rm-ui-empty", className)}>
      {icon ? <div className="rm-ui-empty__icon">{icon}</div> : null}
      <h2 className="rm-ui-empty__title">{title}</h2>
      {children ? (
        <div className="rm-ui-empty__description">{children}</div>
      ) : null}
      {action ? <div className="rm-ui-empty__action">{action}</div> : null}
    </div>
  );
}

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("rm-ui-skeleton", className)}
      {...props}
    />
  );
}

const statusBadgeVariants = cva("rm-ui-status-badge", {
  variants: {
    tone: {
      danger: "rm-ui-status-badge--danger",
      info: "rm-ui-status-badge--info",
      neutral: "rm-ui-status-badge--neutral",
      success: "rm-ui-status-badge--success",
      warning: "rm-ui-status-badge--warning",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function StatusBadge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof statusBadgeVariants>) {
  return (
    <span className={cn(statusBadgeVariants({ tone }), className)} {...props} />
  );
}

export function ToastViewport() {
  return (
    <SonnerToaster
      closeButton
      position="bottom-right"
      richColors
      toastOptions={{ className: "rm-ui-toast" }}
    />
  );
}

export { toast };
