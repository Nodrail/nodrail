"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/features/shell/components/page-header";
import { appPath } from "@/lib/product-path";

/**
 * A missing page inside the workspace, in its frame. Settings and account
 * pages, in no environment, lead to the workspace's own Overview.
 */
export default function SectionNotFound() {
  const { workspace, environment } = useParams<{
    workspace: string;
    environment?: string;
  }>();
  return (
    <PageHeader
      title="We can't find that page"
      purpose="It may not exist, or you may not have access to it."
      action={
        <Button asChild>
          <Link
            href={
              environment
                ? appPath(workspace, environment, "overview")
                : appPath(workspace)
            }
          >
            Go to Overview
          </Link>
        </Button>
      }
    />
  );
}
