"use client";

import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { useRef, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmPrompt, type ConfirmProps } from "./confirm-dialog";
import { useToast } from "./toast";

type Common = {
  label: string;
  /** Red, for an item that removes or ends something. */
  destructive?: boolean;
};

/**
 * One choice in a row's menu: a page to go to, text to copy, something to do
 * at once, or something to confirm first. Links, copies and confirmations
 * can come from a server component; `onSelect` needs a client one.
 */
export type RowAction = Common &
  (
    | { href: string }
    | { copy: string; copied?: string }
    | { onSelect: () => void }
    | { confirm: ConfirmProps<unknown> }
  );

/** A choice, a line between groups, or nothing (for a choice not offered). */
export type RowActionItem = RowAction | "separator" | false | null | undefined;

/** Clicks inside the menu or its confirmations are not clicks on the row. */
const keepFromRow = (event: MouseEvent) => event.stopPropagation();

/** No line first, last, or twice in a row. */
function tidy(items: RowActionItem[]) {
  const kept: (RowAction | "separator")[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item === "separator" && (!kept.length || kept.at(-1) === "separator"))
      continue;
    kept.push(item);
  }
  if (kept.at(-1) === "separator") kept.pop();
  return kept;
}

/**
 * A row's "⋯" menu of quick actions, named for the row ("Actions for
 * deploy-bot"). It opens with Enter, Space or the arrow keys, and clicks in it
 * never reach the row. A chosen action runs once the menu has closed and
 * focus is back on "⋯", so a confirmation, or a row that leaves, hands focus
 * on from there. Renders nothing when no action is offered.
 */
export function RowActions({
  name,
  items,
  tour,
}: {
  /** What the row is, for the button's label. */
  name: string;
  items: RowActionItem[];
  /** The page tour's anchor on "⋯", if a step points at it. */
  tour?: string;
}) {
  const copy = useCopy();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogs = useRef(new Map<number, HTMLDialogElement>());
  const chosen = useRef<(() => void) | null>(null);
  const shown = tidy(items);
  if (!shown.some((item) => item !== "separator")) return null;

  /** What choosing an item does, once the menu is closed. */
  const run = (item: RowAction, index: number) => {
    if ("onSelect" in item) return item.onSelect;
    if ("copy" in item) return () => void copy(item.copy, item.copied);
    if ("confirm" in item) return () => dialogs.current.get(index)?.showModal();
    return null;
  };

  return (
    <span className="inline-flex" onClick={keepFromRow}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon-sm"
            data-slot="row-actions"
            data-tour={tour}
            aria-label={`Actions for ${name}`}
            className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-44"
          onCloseAutoFocus={(event) => {
            const action = chosen.current;
            chosen.current = null;
            if (!action) return;
            event.preventDefault();
            trigger.current?.focus();
            action();
          }}
        >
          {shown.map((item, index) =>
            item === "separator" ? (
              <DropdownMenuSeparator key={`separator-${index}`} />
            ) : (
              <Choice
                key={item.label}
                item={item}
                onChoose={() => {
                  chosen.current = run(item, index);
                }}
              />
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {shown.map((item, index) =>
        item !== "separator" && "confirm" in item ? (
          <ConfirmPrompt
            key={item.label}
            ref={(element) => {
              if (element) dialogs.current.set(index, element);
              else dialogs.current.delete(index);
            }}
            {...item.confirm}
          />
        ) : null,
      )}
    </span>
  );
}

/** Copies text, and says in a toast whether it worked. */
function useCopy() {
  const toast = useToast();
  return (text: string, copied = "Copied.") =>
    navigator.clipboard.writeText(text).then(
      () => toast(copied),
      () =>
        toast("Couldn't copy. Select the text and copy it instead.", "error"),
    );
}

/** One menu item: a link, or a choice that runs once the menu closes. */
function Choice({ item, onChoose }: { item: RowAction; onChoose: () => void }) {
  const variant = item.destructive ? "destructive" : "default";
  if ("href" in item)
    return (
      <DropdownMenuItem asChild variant={variant}>
        <Link href={item.href}>{item.label}</Link>
      </DropdownMenuItem>
    );
  return (
    <DropdownMenuItem variant={variant} onSelect={onChoose}>
      {item.label}
    </DropdownMenuItem>
  );
}
