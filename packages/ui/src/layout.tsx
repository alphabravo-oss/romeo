import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./lib/cn";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return <div className={cn("rm-ui-card", className)} ref={ref} {...props} />;
  },
);

export const Panel = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  function Panel({ className, ...props }, ref) {
    return (
      <section className={cn("rm-ui-panel", className)} ref={ref} {...props} />
    );
  },
);

export const Toolbar = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function Toolbar({ className, ...props }, ref) {
  return (
    <div
      className={cn("rm-ui-toolbar", className)}
      ref={ref}
      role="toolbar"
      {...props}
    />
  );
});

export function Separator({
  className,
  decorative = true,
  orientation = "horizontal",
  ...props
}: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      className={cn("rm-ui-separator", className)}
      decorative={decorative}
      orientation={orientation}
      {...props}
    />
  );
}

export interface TabDefinition {
  content: ReactNode;
  disabled?: boolean;
  label: ReactNode;
  value: string;
}

export function Tabs({
  className,
  tabs,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> & {
  tabs: readonly TabDefinition[];
}) {
  return (
    <TabsPrimitive.Root className={cn("rm-ui-tabs", className)} {...props}>
      <TabsPrimitive.List className="rm-ui-tabs__list">
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            className="rm-ui-tabs__trigger"
            disabled={tab.disabled}
            key={tab.value}
            value={tab.value}
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content
          className="rm-ui-tabs__content"
          key={tab.value}
          value={tab.value}
        >
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

export function AppShell({
  children,
  className,
  sidebar,
  topbar,
}: {
  children: ReactNode;
  className?: string;
  sidebar?: ReactNode;
  topbar?: ReactNode;
}) {
  return (
    <div className={cn("rm-ui-app-shell", className)}>
      {sidebar}
      <div className="rm-ui-app-shell__main">
        {topbar}
        <main className="rm-ui-app-shell__content">{children}</main>
      </div>
    </div>
  );
}

export function SidebarFrame({
  children,
  className,
  footer,
  header,
}: {
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  header: ReactNode;
}) {
  return (
    <aside className={cn("rm-ui-sidebar", className)}>
      <div className="rm-ui-sidebar__header">{header}</div>
      <div className="rm-ui-sidebar__body">{children}</div>
      {footer ? <div className="rm-ui-sidebar__footer">{footer}</div> : null}
    </aside>
  );
}

export function Topbar({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <header className={cn("rm-ui-topbar", className)} {...props} />;
}

export { TabsPrimitive };
