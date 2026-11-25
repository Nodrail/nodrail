"use client";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/features/shell/components/page-header";

/** A page failed but the workspace around it still works. */
export default function PageError({ retry }: { retry: () => void }) {
  return (
    <div role="alert">
      <PageHeader
        title="This page didn't load"
        purpose="Nothing was changed. If this keeps happening, try again in a few minutes."
        action={
          <Button type="button" onClick={() => retry()}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
