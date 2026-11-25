"use client";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/** A menu choice: what it is, then what it does. */
export function MenuChoice({
  title,
  detail,
  onSelect,
}: {
  title: string;
  detail: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="grid gap-0.5 py-2 text-ui">
      <span className="font-semibold text-foreground">{title}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </DropdownMenuItem>
  );
}
