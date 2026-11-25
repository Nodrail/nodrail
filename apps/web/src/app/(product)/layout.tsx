import type { Metadata } from "next";
import type { ReactNode } from "react";
import { preload } from "react-dom";
import { AnalyticsConsent } from "@nodrail/web-shared/analytics/consent";
import { site } from "@nodrail/web-shared/site";
import { buttonVariants } from "@/components/ui/button";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: { default: "Nodrail", template: "%s · Nodrail" },
  robots: { index: false, follow: false },
};

const consentCopy = {
  message:
    "With your permission, we use PostHog to understand how Nodrail is used, linked to your account and workspace IDs. It never receives what your agents do.",
  privacy: "Privacy",
  accept: "Accept",
  reject: "Reject",
};

export default function ProductLayout({ children }: { children: ReactNode }) {
  for (const font of ["Manrope-Bold", "Inter-Regular"])
    preload(`/fonts/${font}.woff2`, {
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous",
    });
  return (
    <html lang="en">
      <body data-surface="product">
        {children}
        <AnalyticsConsent
          copy={consentCopy}
          privacyHref={`${site.url}/privacy`}
          buttonClassName={buttonVariants({ variant: "outline", size: "sm" })}
          surface="product"
        />
      </body>
    </html>
  );
}
