import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionResult } from "./action-result";
import { FieldError } from "./note";

/** The server's answer when a form could not be saved. */
export function FormError({ state }: { state: ActionResult<unknown> }) {
  return state.status === "error" ? (
    <FieldError>{state.message}</FieldError>
  ) : null;
}

/**
 * A form's submit button: disabled while the form is pending, and saying what
 * is happening ("Saving…") instead of its label meanwhile.
 */
export function SubmitButton({
  pending,
  pendingLabel,
  disabled,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "type"> & {
  pending: boolean;
  /** What the button says while pending, such as "Publishing…". */
  pendingLabel: string;
}) {
  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

/**
 * The end of a form: the server's error, then its buttons. `start` for a form
 * that is the page (the buttons line up with the fields), `end` for a form in
 * a card (beside the card's edge).
 */
export function FormFooter({
  state,
  align = "start",
  className,
  children,
}: {
  state: ActionResult<unknown>;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="form-footer"
      className={cn(
        "flex flex-wrap items-center gap-2.5",
        align === "end" && "justify-end",
        className,
      )}
    >
      {align === "end" ? <FormError state={state} /> : null}
      {children}
      {align === "start" ? <FormError state={state} /> : null}
    </div>
  );
}

/** Error and save button, for forms in a card that stay on the page. */
export function SaveRow({
  state,
  pending,
}: {
  state: ActionResult;
  pending: boolean;
}) {
  return (
    <FormFooter state={state} align="end">
      <SubmitButton pending={pending} pendingLabel="Saving…">
        Save changes
      </SubmitButton>
    </FormFooter>
  );
}

/**
 * A form's grid: two columns of fields, one on phones. A child with
 * `formGridWide` spans both.
 */
export const formGrid = "grid grid-cols-2 gap-3.5 phone:grid-cols-1";
export const formGridWide = "col-span-2 phone:col-span-1";
