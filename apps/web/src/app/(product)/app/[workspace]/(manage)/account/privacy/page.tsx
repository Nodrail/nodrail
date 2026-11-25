import type { Metadata } from "next";
import { PersonalDataCard } from "@/features/settings/components/data-controls";
import { openManagePage } from "@/features/shell/components/manage-section";

export const metadata: Metadata = { title: "Privacy & your data" };

export default async function PrivacyPage({
  params,
}: PageProps<"/app/[workspace]/account/privacy">) {
  const { workspace } = await params;
  const { view, header } = await openManagePage(
    workspace,
    "account",
    "privacy",
  );
  return (
    <>
      {header}
      <div className="grid gap-4">
        <PersonalDataCard email={view.person.email ?? ""} />
      </div>
    </>
  );
}
