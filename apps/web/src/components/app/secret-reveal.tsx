"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Callout, FormHint } from "./note";
import { focusRing } from "./styles";

/** Shows a secret that can never be fetched again. */
export function SecretReveal({
  label,
  secret,
  children,
}: {
  label: string;
  secret: string;
  children?: ReactNode;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <Callout
      data-slot="secret-reveal"
      tone="warning"
      title="Copy this now. For your security it will not be shown again."
      className="mt-3 gap-2"
    >
      <code
        aria-label={label}
        tabIndex={0}
        className={cn(
          "rounded-md bg-card p-2.5 text-xs [overflow-wrap:anywhere] select-all",
          focusRing,
        )}
      >
        {secret}
      </code>
      <div className="flex flex-wrap items-start gap-2">
        <Button type="button" onClick={() => void copySecret()}>
          Copy
        </Button>
        {children}
      </div>
      <FormHint role="status">
        {copy === "copied" ? "Copied." : null}
        {copy === "failed" ? "Could not copy. Select the text instead." : null}
      </FormHint>
    </Callout>
  );
}
