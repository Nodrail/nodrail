import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/components/auth-card";
import { appPath } from "@/lib/product-path";

export default function ProductNotFound() {
  return (
    <AuthCard
      eyebrow="Not found"
      title="We can't find that page"
      intro="It may not exist, or you may not have access to it."
    >
      <Button asChild size="lg" className="w-full">
        <Link href={appPath()}>Go to your workspace</Link>
      </Button>
    </AuthCard>
  );
}
