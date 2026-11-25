"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GroupState } from "./yaml-groups";

/**
 * Over the YAML editor: a button per group of the file that folds it or
 * opens it again, the same folds as the headings inside the editor, but
 * outside the text, where the keyboard and screen readers reach them.
 */
export function YamlGroupBar({
  groups,
  controls,
  onToggle,
}: {
  groups: GroupState[];
  /** The editor's id. */
  controls: string;
  onToggle: (kind: GroupState["kind"]) => void;
}) {
  if (!groups.length) return null;
  return (
    <div
      role="group"
      aria-label="Fold groups"
      data-tour="yaml-groups"
      className="mb-2 flex flex-wrap items-center gap-1.5"
    >
      <span aria-hidden="true" className="mr-1 text-xs text-muted-foreground">
        Groups
      </span>
      {groups.map((group) => {
        const Arrow = group.folded ? ChevronRight : ChevronDown;
        return (
          <Button
            key={group.kind}
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={!group.folded}
            aria-controls={controls}
            onClick={() => onToggle(group.kind)}
          >
            <Arrow aria-hidden="true" />
            {group.label} · {group.count}
          </Button>
        );
      })}
    </div>
  );
}
