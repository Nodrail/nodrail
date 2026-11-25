"use client";

import type { MouseEvent } from "react";
import { track } from "@/components/analytics/posthog";
import { useDownload } from "@/components/app/use-download";
import { Button } from "@/components/ui/button";

export function ExportRulesLink({ href }: { href: string }) {
  const download = useDownload();

  async function exportRules(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (
      await download(href, "We could not export the rules. Please try again.")
    )
      track("yaml_exported");
  }

  return (
    <Button asChild variant="outline">
      <a href={href} download onClick={(event) => void exportRules(event)}>
        Export YAML
      </a>
    </Button>
  );
}
