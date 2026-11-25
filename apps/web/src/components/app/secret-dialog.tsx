"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AppDialog, DialogHeading } from "./app-dialog";
import { SecretReveal } from "./secret-reveal";

/**
 * A secret shown once, in a dialog that only Done or Escape closes, so a
 * stray click can never dismiss it before it is copied.
 */
export function SecretDialog({
  dialogLabel,
  title,
  secretLabel,
  secret,
  onDone,
  children,
}: {
  dialogLabel: string;
  title: string;
  secretLabel: string;
  secret: string;
  onDone: () => void;
  children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return (
    <AppDialog ref={dialog} aria-label={dialogLabel} onClose={onDone}>
      <DialogHeading>{title}</DialogHeading>
      {children}
      <SecretReveal label={secretLabel} secret={secret}>
        <Button
          type="button"
          variant="outline"
          onClick={() => dialog.current?.close()}
        >
          Done
        </Button>
      </SecretReveal>
    </AppDialog>
  );
}
