import type { ReactNode } from "react";
import { Logo } from "@nodrail/web-shared/logo";
import {
  pageTitle,
  eyebrow as eyebrowStyle,
  focusRing,
} from "@/components/app/styles";
import { Card } from "@/components/ui/card";
import { ConsentSettingsButton } from "@nodrail/web-shared/analytics/consent";
import { cn } from "@/lib/utils";

/** The centred card for sign-in, invites, errors and other pages outside a workspace. */
export function AuthCard({
  eyebrow,
  title,
  intro,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main
      id="main-content"
      className="grid min-h-dvh place-items-center bg-background px-4 py-6 text-body"
    >
      <Card className="block w-full max-w-107.5 animate-rise gap-0 rounded-xl px-7.5 py-8.5 text-center shadow-lg shadow-ink/5">
        <Logo className="mx-auto mb-7 block h-auto w-32" />
        <p className={cn("mb-2.5", eyebrowStyle)}>{eyebrow}</p>
        <h1 className={cn(pageTitle, "mb-2")}>{title}</h1>
        <p className="mb-5.5 text-sm leading-normal text-muted-foreground">
          {intro}
        </p>
        {children}
        {footer ? (
          <div className="mt-4.5 border-t pt-4 text-ui text-muted-foreground [&_a]:font-semibold [&_a]:text-forest">
            {footer}
          </div>
        ) : null}
        <ConsentSettingsButton
          label="Cookie settings"
          className={cn(
            "mt-3.5 block cursor-pointer rounded-sm text-xs text-muted-foreground underline",
            focusRing,
          )}
        />
      </Card>
    </main>
  );
}
