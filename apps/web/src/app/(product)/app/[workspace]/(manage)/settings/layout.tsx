import { ManageSection } from "@/features/shell/components/manage-section";

export default async function SettingsLayout({
  children,
  params,
}: LayoutProps<"/app/[workspace]/settings">) {
  const { workspace } = await params;
  return (
    <ManageSection group="settings" workspace={workspace}>
      {children}
    </ManageSection>
  );
}
