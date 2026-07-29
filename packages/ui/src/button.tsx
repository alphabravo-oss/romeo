import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
} from "react";
import { cn } from "./lib/cn";

export const buttonVariants = cva("rm-ui-button", {
  variants: {
    variant: {
      default: "rm-ui-button--default",
      primary: "rm-ui-button--primary",
      secondary: "rm-ui-button--secondary",
      ghost: "rm-ui-button--ghost",
      outline: "rm-ui-button--outline",
      danger: "rm-ui-button--danger",
      link: "rm-ui-button--link",
    },
    size: {
      sm: "rm-ui-button--sm",
      md: "rm-ui-button--md",
      lg: "rm-ui-button--lg",
      icon: "rm-ui-button--icon",
    },
  },
  defaultVariants: { size: "md", variant: "default" },
});

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  pending?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      asChild = false,
      children,
      className,
      disabled,
      pending = false,
      size,
      type = "button",
      variant,
      ...props
    },
    ref,
  ) {
    const classNames = cn(buttonVariants({ size, variant }), className);
    if (asChild) {
      return (
        <Slot
          aria-busy={pending || undefined}
          className={classNames}
          ref={ref}
          {...props}
        >
          {children}
        </Slot>
      );
    }
    return (
      <button
        aria-busy={pending || undefined}
        className={classNames}
        data-pending={pending || undefined}
        disabled={disabled || pending}
        ref={ref}
        type={type}
        {...props}
      >
        {pending ? <Spinner aria-hidden="true" size="sm" /> : null}
        {children}
      </button>
    );
  },
);

export interface IconButtonProps extends Omit<ButtonProps, "size"> {
  "aria-label": string;
  size?: "sm" | "md" | "lg";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ size = "md", ...props }, ref) {
    return <Button ref={ref} size="icon" data-icon-size={size} {...props} />;
  },
);

export interface LinkButtonProps
  extends
    AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof buttonVariants> {}

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(
  function LinkButton({ className, size, variant, ...props }, ref) {
    return (
      <a
        className={cn(buttonVariants({ size, variant }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);

export function Spinner({
  className,
  size = "md",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={cn("rm-ui-spinner", `rm-ui-spinner--${size}`, className)}
      role="status"
      {...props}
    />
  );
}
