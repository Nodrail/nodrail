import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { pageTitle } from "@/components/app/styles";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Every page's heading: title, purpose, and optional back, lead and action. */
export function PageHeader({
  title,
  purpose,
  action,
  back,
  lead,
  status,
}: {
  title: string;
  purpose: string;
  action?: ReactNode;
  back?: { href: string; label: string };
  lead?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <header
      data-slot="page-header"
      className="mb-5 flex animate-rise items-center justify-between gap-5 phone:flex-wrap phone:items-start"
    >
      {back ? (
        <Button asChild variant="ghost" size="icon">
          <Link href={back.href} aria-label={back.label} title={back.label}>
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
      ) : null}
      {lead}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={cn(pageTitle, "mb-0.5 [overflow-wrap:anywhere]")}>
            {title}
          </h1>
          {status}
        </div>
        <p className="text-sm text-muted-foreground">{purpose}</p>
      </div>
      {action ? (
        <div className="flex flex-col items-end gap-1.5 phone:w-full phone:items-start">
          {action}
        </div>
      ) : null}
    </header>
  );
}
