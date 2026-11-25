"use client";

import Link from "next/link";
import type { starterPacks } from "@nodrail/policy-engine/yaml";
import { track } from "@/components/analytics/posthog";
import { Button } from "@/components/ui/button";

export function StarterPackLink({
  pack,
  href,
  title,
  label,
}: {
  pack: keyof typeof starterPacks;
  href: string;
  title: string;
  label: string;
}) {
  return (
    <Button asChild variant="outline">
      <Link
        href={href}
        title={title}
        onClick={() => track("starter_pack_chosen", { pack })}
      >
        {label}
      </Link>
    </Button>
  );
}
