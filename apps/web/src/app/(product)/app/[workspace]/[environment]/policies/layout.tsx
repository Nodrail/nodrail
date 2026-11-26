import { EnvironmentRepositoryPolicy } from "@/features/policies/environment-repository-policy";

export default async function PoliciesLayout({
  params,
  children,
}: LayoutProps<"/app/[workspace]/[environment]/policies">) {
  const { workspace, environment } = await params;
  return (
    <EnvironmentRepositoryPolicy
      workspace={workspace}
      environment={environment}
    >
      {children}
    </EnvironmentRepositoryPolicy>
  );
}
