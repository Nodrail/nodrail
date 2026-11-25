import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { dialogTitle } from "./styles";

/**
 * A native modal `<dialog>` (tests address it as `dialog`) that fades and
 * scales in and out, backdrop included. Open it with `showModal()`.
 */
export function AppDialog({ className, ...props }: ComponentProps<"dialog">) {
  return (
    <dialog
      data-slot="app-dialog"
      className={cn(
        "m-auto w-[min(460px,calc(100vw-32px))] rounded-xl border bg-card p-6 text-body",
        "scale-95 opacity-0 transition-[opacity,scale,display,overlay] transition-discrete duration-200 ease-out open:scale-100 open:opacity-100 starting:open:scale-95 starting:open:opacity-0",
        "backdrop:bg-ink/25 backdrop:opacity-0 backdrop:transition-[opacity,display,overlay] backdrop:transition-discrete backdrop:duration-200 open:backdrop:opacity-100 starting:open:backdrop:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

/** The dialog's title. */
export function DialogHeading({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn(dialogTitle, "mb-2.5 [overflow-wrap:anywhere]", className)}
      {...props}
    />
  );
}
