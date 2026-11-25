"use client";

import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/components/auth-card";

/** Nothing around the page could load, such as the service being unavailable. */
export default function ProductError({ retry }: { retry: () => void }) {
  return (
    <div role="alert">
      <AuthCard
        eyebrow="Temporarily unavailable"
        title="We couldn't load Nodrail"
        intro="Nothing was changed. If this keeps happening, try again in a few minutes."
      >
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => retry()}
        >
          Try again
        </Button>
      </AuthCard>
    </div>
  );
}
