import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import {
  createContext,
  forwardRef,
  useContext,
  useId,
  useMemo,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./lib/cn";

interface FieldContextValue {
  descriptionId?: string | undefined;
  errorId?: string | undefined;
  invalid: boolean;
  inputId: string;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export function Field({
  children,
  className,
  description,
  error,
  id,
  label,
  required,
}: {
  children: ReactNode | ((props: FieldContextValue) => ReactNode);
  className?: string;
  description?: ReactNode;
  error?: ReactNode;
  id?: string;
  label: ReactNode;
  required?: boolean;
}) {
  const generatedInputId = useId();
  const inputId = id ?? generatedInputId;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const context = useMemo(
    () => ({ descriptionId, errorId, inputId, invalid: Boolean(error) }),
    [descriptionId, error, errorId, inputId],
  );
  return (
    <FieldContext.Provider value={context}>
      <div className={cn("rm-ui-field", className)}>
        <label className="rm-ui-field__label" htmlFor={inputId}>
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </label>
        {typeof children === "function" ? children(context) : children}
        {description ? (
          <div className="rm-ui-field__description" id={descriptionId}>
            {description}
          </div>
        ) : null}
        {error ? (
          <InlineError id={errorId} role="alert">
            {error}
          </InlineError>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

function useFieldProps(props: {
  "aria-describedby"?: string | undefined;
  "aria-invalid"?:
    | boolean
    | "false"
    | "grammar"
    | "spelling"
    | "true"
    | undefined;
  id?: string | undefined;
}) {
  const field = useContext(FieldContext);
  if (!field) return props;
  return {
    ...props,
    "aria-describedby":
      props["aria-describedby"] ??
      [field.descriptionId, field.errorId].filter(Boolean).join(" ") ??
      undefined,
    "aria-invalid": props["aria-invalid"] ?? field.invalid,
    id: props.id ?? field.inputId,
  };
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  const nativeToggle = props.type === "checkbox" || props.type === "radio";
  return (
    <input
      className={cn(
        nativeToggle ? "rm-ui-native-toggle" : "rm-ui-control",
        className,
      )}
      ref={ref}
      {...useFieldProps(props)}
    />
  );
});

export const NativeSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function NativeSelect({ className, ...props }, ref) {
  return (
    <select
      className={cn("rm-ui-control rm-ui-native-select", className)}
      ref={ref}
      {...useFieldProps(props)}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...props }, ref) {
  return (
    <textarea
      className={cn("rm-ui-control rm-ui-textarea", className)}
      ref={ref}
      rows={rows}
      {...useFieldProps(props)}
    />
  );
});

export function Checkbox({
  className,
  label,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  label?: ReactNode;
}) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  return (
    <label className="rm-ui-check-label" htmlFor={id}>
      <CheckboxPrimitive.Root
        className={cn("rm-ui-checkbox", className)}
        id={id}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="rm-ui-checkbox__indicator">
          ✓
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export function Switch({
  className,
  label,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
  label?: ReactNode;
}) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  return (
    <label className="rm-ui-check-label" htmlFor={id}>
      <SwitchPrimitive.Root
        className={cn("rm-ui-switch", className)}
        id={id}
        {...props}
      >
        <SwitchPrimitive.Thumb className="rm-ui-switch__thumb" />
      </SwitchPrimitive.Root>
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export interface SelectOption {
  disabled?: boolean;
  group?: string;
  label: string;
  value: string;
}

export function Select({
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  className,
  options,
  placeholder,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root> & {
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  options: readonly SelectOption[];
  placeholder?: string;
}) {
  const field = useContext(FieldContext);
  const groups = groupSelectOptions(options);
  return (
    <SelectPrimitive.Root {...props}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={[field?.descriptionId, field?.errorId]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={field?.invalid || undefined}
        className={cn("rm-ui-control rm-ui-select", className)}
        id={field?.inputId}
        type="button"
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon aria-hidden="true">⌄</SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="rm-ui-select__content"
          position="popper"
        >
          <SelectPrimitive.Viewport className="rm-ui-select__viewport">
            {groups.map(({ label, options: groupOptions }) => (
              <SelectPrimitive.Group key={label ?? "ungrouped"}>
                {label ? (
                  <SelectPrimitive.Label className="rm-ui-select__label">
                    {label}
                  </SelectPrimitive.Label>
                ) : null}
                {groupOptions.map((option) => (
                  <SelectPrimitive.Item
                    className="rm-ui-select__item"
                    key={option.value}
                    value={option.value}
                    {...(option.disabled ? { disabled: true } : {})}
                  >
                    <SelectPrimitive.ItemText>
                      {option.label}
                    </SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator aria-hidden="true">
                      ✓
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function groupSelectOptions(options: readonly SelectOption[]) {
  const groups = new Map<string | undefined, SelectOption[]>();
  for (const option of options) {
    const items = groups.get(option.group) ?? [];
    items.push(option);
    groups.set(option.group, items);
  }
  return [...groups].map(([label, groupedOptions]) => ({
    label,
    options: groupedOptions,
  }));
}

export function InlineError({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rm-ui-inline-error", className)} {...props} />;
}
