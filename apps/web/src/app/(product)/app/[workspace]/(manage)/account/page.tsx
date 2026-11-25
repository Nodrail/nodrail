import { redirect } from "next/navigation";
import { accountPath } from "@/features/shell/navigation";

export default async function AccountEntry({
  params,
}: PageProps<"/app/[workspace]/account">) {
  redirect(accountPath((await params).workspace, "notifications"));
}
