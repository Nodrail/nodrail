import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FieldError, FormHint } from "./note";

type FieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
};

type ControlAria = {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
};

/** A form label in the product's weight; use it for controls outside FormField. */
export function FieldLabel({
  className,
  ...props
}: ComponentProps<typeof Label>) {
  return (
    <Label
      className={cn(
        "block text-ui leading-normal font-semibold text-body",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A native select styled like Input, so forms and tests keep select semantics.
 * The browser's arrow is replaced by a chevron with room of its own; layout
 * classes (width) go on the wrapper.
 */
export function NativeSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <select
        data-slot="native-select"
        className="h-9 w-full appearance-none rounded-md border border-input-strong bg-card pr-9 pl-2.5 text-sm text-body transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive phone:h-10"
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

/** Label, hint and error wired to whichever control is inside. */
function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: FieldProps & { children: (aria: ControlAria) => ReactNode }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div data-slot="form-field" className="grid gap-1.5">
      <FieldLabel htmlFor={id}>
        {label}
        {optional ? (
          <span className="text-xs font-normal text-muted-foreground">
            {" "}
            Optional
          </span>
        ) : null}
      </FieldLabel>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {hint ? <FormHint id={hintId}>{hint}</FormHint> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

/** A labelled text input with optional hint and error. */
export function FormField({
  id,
  label,
  hint,
  error,
  optional,
  ...input
}: ComponentProps<typeof Input> & FieldProps) {
  return (
    <Field {...{ id, label, hint, error, optional }}>
      {(aria) => <Input {...aria} {...input} />}
    </Field>
  );
}

/** A labelled monospace textarea, for rules and other code-like text. */
export function TextAreaField({
  id,
  label,
  hint,
  error,
  optional,
  className,
  ...area
}: ComponentProps<"textarea"> & FieldProps) {
  return (
    <Field {...{ id, label, hint, error, optional }}>
      {(aria) => (
        <Textarea
          className={cn(
            "field-sizing-fixed min-h-0 rounded-lg bg-card p-2.5 font-mono text-xs leading-normal text-foreground shadow-none md:text-xs",
            className,
          )}
          {...aria}
          {...area}
        />
      )}
    </Field>
  );
}

/** A labelled native select. */
export function SelectField({
  id,
  label,
  hint,
  error,
  optional,
  children,
  ...select
}: ComponentProps<"select"> & FieldProps) {
  return (
    <Field {...{ id, label, hint, error, optional }}>
      {(aria) => (
        <NativeSelect {...aria} {...select}>
          {children}
        </NativeSelect>
      )}
    </Field>
  );
}
