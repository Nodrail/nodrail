import type { Metadata } from "next";
import { TeamView } from "@/features/team/components/team-view";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({
  params,
}: PageProps<"/app/[workspace]/settings/members">) {
  return <TeamView workspace={(await params).workspace} />;
}
