import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { toneLooks, type Tone } from "./tones";

/** The tinted box every note and callout sits in: one radius, one border. */
export const calloutBox = (tone: Tone) =>
  cn(
    "rounded-lg border animate-in duration-200 fade-in-0 slide-in-from-bottom-1",
    toneLooks[tone].soft,
    toneLooks[tone].border,
  );

// Right under a page header, a box note sits above the content instead.
const noteBox =
  "mt-3.5 px-3 py-2.5 text-xs leading-normal [[data-slot=page-header]+&]:mt-0 [[data-slot=page-header]+&]:mb-3";

/**
 * A short explanation or banner. A tone is a tinted box (`info` by default);
 * `plain` is body text (the old `activity-note`). Pass `role="status"` when it
 * reports the result of something the person did.
 */
export function Note({
  tone = "info",
  className,
  ...props
}: ComponentProps<"p"> & { tone?: Tone | "plain" }) {
  return (
    <p
      data-slot="note"
      data-tone={tone}
      className={cn(
        tone === "plain"
          ? "mt-3 animate-in text-ui leading-[1.6] text-body duration-200 fade-in-0 slide-in-from-bottom-1"
          : cn(calloutBox(tone), noteBox),
        className,
      )}
      {...props}
    />
  );
}

/**
 * A tinted box with a title, a line or two and its next step, such as
 * "Requests need review". Notes are its one-paragraph form.
 */
export function Callout({
  tone = "info",
  title,
  icon,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  tone?: Tone;
  title?: ReactNode;
  /** Shown before the title, such as a pulsing dot. */
  icon?: ReactNode;
}) {
  return (
    <div
      data-slot="callout"
      data-tone={tone}
      className={cn(
        calloutBox(tone),
        "grid gap-1.5 p-3.5 text-ui leading-normal",
        className,
      )}
      {...props}
    >
      {title ? (
        <p className="flex items-center gap-2 font-display font-bold text-foreground">
          {icon}
          {title}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/** Quiet helper text under a field or list. */
export function FormHint({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="form-hint"
      className={cn("text-xs leading-normal text-muted-foreground", className)}
      {...props}
    />
  );
}

/** A field or form error in the destructive tone; select by `[data-slot=field-error]`. */
export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn("text-ui text-destructive", className)}
      {...props}
    />
  );
}
