import { ManageSection } from "@/features/shell/components/manage-section";

export default async function AccountLayout({
  children,
  params,
}: LayoutProps<"/app/[workspace]/account">) {
  const { workspace } = await params;
  return (
    <ManageSection group="account" workspace={workspace}>
      {children}
    </ManageSection>
  );
}
