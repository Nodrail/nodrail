"use client";

import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { track } from "@/components/analytics/posthog";
import { useDownload } from "@/components/app/use-download";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Another environment the policies can be copied to, and where that starts. */
export type CopyTarget = { name: string; href: string };

/**
 * The Policies heading's less frequent actions, beside its one primary
 * action: copy the policies to another environment, import or export YAML.
 */
export function PoliciesMenu({
  copies,
  importHref,
  exportHref,
}: {
  copies: CopyTarget[];
  importHref: string;
  exportHref: string;
}) {
  const download = useDownload();
  const exportRules = async () => {
    if (
      await download(
        exportHref,
        "We could not export the rules. Please try again.",
      )
    )
      track("yaml_exported");
  };
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label="More policy actions"
          data-tour="policies-more"
        >
          <Ellipsis aria-hidden="true" />
          More
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {copies.map((copy) => (
          <DropdownMenuItem key={copy.href} asChild>
            <Link href={copy.href}>Copy to {copy.name}…</Link>
          </DropdownMenuItem>
        ))}
        {copies.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem asChild>
          <Link href={importHref}>Import YAML</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportRules()}>
          Export YAML
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
