"use client";

import type { Ref } from "react";
import { AppDialog, DialogHeading } from "@/components/app/app-dialog";
import { eyebrow } from "@/components/app/styles";
import { TextLink } from "@/components/app/text-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { whatsNew } from "../whats-new";

/** The changelog, newest first, each entry with a link to see it. */
export function WhatsNewDialog({
  ref,
  base,
  onClose,
}: {
  ref: Ref<HTMLDialogElement>;
  /** The environment's path, which entry links continue. */
  base: string;
  onClose: () => void;
}) {
  return (
    <AppDialog
      ref={ref}
      data-slot="whats-new"
      aria-labelledby="whats-new-title"
      className="w-[min(520px,calc(100vw-32px))]"
      onClose={onClose}
    >
      <p className={cn("mb-2.5", eyebrow)}>Nodrail</p>
      <DialogHeading id="whats-new-title">What&apos;s new</DialogHeading>
      <ol className="grid max-h-[60vh] gap-3.5 overflow-y-auto">
        {whatsNew.map((entry) => (
          <li
            key={entry.id}
            data-slot="whats-new-entry"
            className="border-b pb-3.5 last:border-b-0 last:pb-0"
          >
            <h3 className="mb-0.5 text-sm font-semibold text-foreground">
              {entry.title}
            </h3>
            <p className="text-ui leading-normal text-muted-foreground">
              {entry.body}
            </p>
            {entry.link ? (
              <TextLink
                href={`${base}${entry.link.path}`}
                size="xs"
                className="mt-1 inline-block"
                onClick={(event) =>
                  event.currentTarget.closest("dialog")?.close()
                }
              >
                {entry.link.label}
              </TextLink>
            ) : null}
          </li>
        ))}
      </ol>
      <form method="dialog" className="mt-5 flex justify-end">
        <Button type="submit" variant="outline" autoFocus>
          Close
        </Button>
      </form>
    </AppDialog>
  );
}
