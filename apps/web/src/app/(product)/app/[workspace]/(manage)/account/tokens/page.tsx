import type { Metadata } from "next";
import { ApiTokensCard } from "@/features/settings/components/api-tokens";
import { openManagePage } from "@/features/shell/components/manage-section";
import { readForPage } from "@/features/shell/load-view";
import { listApiTokens } from "@/server/modules/api-tokens";

export const metadata: Metadata = { title: "API tokens" };

export default async function ApiTokensPage({
  params,
}: PageProps<"/app/[workspace]/account/tokens">) {
  const { workspace } = await params;
  const { header } = await openManagePage(workspace, "account", "tokens");
  const tokens = await readForPage(workspace, listApiTokens);
  return (
    <>
      {header}
      <ApiTokensCard workspace={workspace} list={tokens} />
    </>
  );
}
