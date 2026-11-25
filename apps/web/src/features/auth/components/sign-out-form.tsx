import { Button } from "@/components/ui/button";
import { signOut } from "@/features/auth/actions";
import { authForm } from "./auth-form";

export function SignOutForm({
  variant = "default",
}: {
  variant?: "default" | "ghost";
}) {
  return (
    <form action={signOut} className={authForm}>
      <Button type="submit" size="lg" variant={variant} className="w-full">
        Sign out
      </Button>
    </form>
  );
}
