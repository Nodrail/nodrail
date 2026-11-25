"use client";

import {
  useEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActionForm } from "./action-form";
import { AppDialog, DialogHeading } from "./app-dialog";
import { FormError, SubmitButton } from "./form-feedback";
import type { ActionResult } from "./action-result";
import { eyebrow } from "./styles";
import { useAppAction } from "./use-app-action";

/** What a confirmation says and does, whatever opens it. */
export type ConfirmProps<T> = {
  kicker?: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: ComponentProps<typeof Button>["variant"];
  /**
   * A method, so a list of confirmations (as in a row's menu) can hold
   * actions with different results as `ConfirmProps<unknown>`.
   */
  action(
    this: void,
    previous: ActionResult<T>,
    data: FormData,
  ): Promise<ActionResult<T>>;
  onSuccess?: (result: Extract<ActionResult<T>, { status: "ok" }>) => void;
};

/**
 * The confirmation itself, opened with `showModal()` on its ref by a button
 * or a menu item. Focus starts on Cancel, unless a field inside asks for it,
 * Escape is safe, the backdrop does nothing, and the browser returns focus to
 * what had it before on close.
 */
export function ConfirmPrompt<T>({
  ref,
  kicker,
  title,
  children,
  confirmLabel,
  confirmVariant = "destructive",
  action,
  onSuccess,
}: ConfirmProps<T> & { ref: Ref<HTMLDialogElement> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [state, submit, pending] = useAppAction(action, onSuccess);

  useEffect(() => {
    if (state.status !== "ok") return;
    dialog.current?.close();
    form.current?.reset();
  }, [state]);

  return (
    <AppDialog
      ref={(element) => {
        dialog.current = element;
        if (typeof ref === "function") return ref(element);
        if (ref) ref.current = element;
      }}
      aria-label={title}
    >
      <ActionForm ref={form} action={submit}>
        {kicker ? <p className={cn("mb-2.5", eyebrow)}>{kicker}</p> : null}
        <DialogHeading>{title}</DialogHeading>
        <div className="grid gap-2 text-sm leading-normal [&_ul]:pl-4.5">
          {children}
        </div>
        <FormError state={state} />
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            autoFocus
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </Button>
          <SubmitButton
            variant={confirmVariant}
            pending={pending}
            pendingLabel="Working…"
          >
            {confirmLabel}
          </SubmitButton>
        </div>
      </ActionForm>
    </AppDialog>
  );
}

/** Confirms a risky action behind its own button. */
export function ConfirmDialog<T>({
  triggerLabel,
  triggerVariant = "danger-quiet",
  ...props
}: ConfirmProps<T> & {
  triggerLabel: string;
  triggerVariant?: ComponentProps<typeof Button>["variant"];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        onClick={() => dialog.current?.showModal()}
      >
        {triggerLabel}
      </Button>
      <ConfirmPrompt ref={dialog} {...props} />
    </>
  );
}
