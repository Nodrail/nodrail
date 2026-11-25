import { Card, Disclosure, EmptyState } from "@/components/app/card";
import { StatusBadge } from "@/components/app/status-badge";
import { seesWholeWorkspace, roles } from "@/contracts/v1/access";
import type { InviteDto, TeamMemberDto } from "@/contracts/v1/team";
import { PageHeader } from "@/features/shell/components/page-header";
import { readForPage } from "@/features/shell/load-view";
import { roleLabels, settingsPages } from "@/features/shell/navigation";
import { plural } from "@/lib/text";
import { timeUntil } from "@/lib/time";
import { getTeam } from "@/server/modules/team/members";
import { roleDescriptions } from "../presentation";
import { InvitePanel } from "./invite-panel";
import { MemberActions, RevokeInviteButton } from "./member-actions";
import {
  DataActionsCell,
  DataPanel,
  DataTable,
  DataTitle,
} from "@/components/app/data-table";
import { DataActionsHeading } from "@/components/app/data-table";
import { ItemList, ItemRow, ItemText } from "@/components/app/item-list";

const section = settingsPages.find((item) => item.slug === "members");

function agentsText(member: TeamMemberDto) {
  if (seesWholeWorkspace(member.role)) return "All agents";
  return member.assignedAgents
    ? `${plural(member.assignedAgents, "agent")} assigned`
    : "None assigned";
}

/** Member and invite counts, with what each role may do. */
function TeamSummary({ counts }: { counts: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-5 gap-y-2 text-ui text-muted-foreground [&>details]:mt-0 [&>details]:border-0 [&>details]:pt-0">
      <span key={counts} className="animate-pop">
        {counts}
      </span>
      <Disclosure summary="Role permissions">
        <dl className="mb-2.5 grid gap-2">
          {roles.map((role) => (
            <div key={role}>
              <dt className="font-semibold text-foreground">
                {roleLabels[role]}
              </dt>
              <dd>{roleDescriptions[role]}</dd>
            </div>
          ))}
        </dl>
        Viewers only see agents assigned to them. Assign people from an
        agent&apos;s page.
      </Disclosure>
    </div>
  );
}

/** Invites not yet accepted, with their expiry and a way to revoke them. */
function InviteList({
  workspace,
  invites,
}: {
  workspace: string;
  invites: InviteDto[];
}) {
  return (
    <Card title="Open invites">
      <ItemList data-slot="invite-list">
        {invites.map((invite) => (
          <ItemRow key={invite.id}>
            <ItemText
              title={invite.email}
              meta={`${roleLabels[invite.role]} · invited by ${invite.invitedBy}`}
            />
            <span className="flex items-center gap-2.5">
              <StatusBadge tone={invite.expired ? "neutral" : "warning"}>
                {invite.expired
                  ? "Expired"
                  : `Expires in ${timeUntil(invite.expiresAt)}`}
              </StatusBadge>
              <RevokeInviteButton workspace={workspace} invite={invite} />
            </span>
          </ItemRow>
        ))}
      </ItemList>
    </Card>
  );
}

export async function TeamView({ workspace }: { workspace: string }) {
  const team = await readForPage(workspace, getTeam);
  const manages = team.invites !== null;
  const invites = team.invites ?? [];
  const counts = [
    plural(team.members.length, "member"),
    ...(invites.length ? [plural(invites.length, "open invite")] : []),
  ].join(" · ");
  return (
    <>
      <PageHeader
        title={section?.label ?? "Members"}
        purpose={section?.purpose ?? ""}
        action={manages ? <InvitePanel workspace={workspace} /> : null}
      />
      <TeamSummary counts={counts} />
      <div className="grid gap-3">
        <DataPanel>
          <DataTable>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Role</th>
                {manages ? <th scope="col">Agents</th> : null}
                <DataActionsHeading />
              </tr>
            </thead>
            <tbody className="stagger">
              {team.members.map((member) => (
                <tr key={member.userId}>
                  <td>
                    <DataTitle>
                      {member.name}
                      {member.isYou ? " · You" : ""}
                    </DataTitle>
                    {member.email && member.email !== member.name ? (
                      <small>{member.email}</small>
                    ) : null}
                  </td>
                  <td>
                    {roleLabels[member.role]}
                    {member.isOwner ? (
                      <>
                        {" "}
                        <StatusBadge tone="neutral">Owner</StatusBadge>
                      </>
                    ) : null}
                  </td>
                  {manages ? <td>{agentsText(member)}</td> : null}
                  <DataActionsCell>
                    <MemberActions
                      workspace={workspace}
                      member={member}
                      assignableRoles={team.assignableRoles}
                    />
                  </DataActionsCell>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </DataPanel>
        {invites.length ? (
          <InviteList workspace={workspace} invites={invites} />
        ) : null}
        {manages && team.members.length === 1 && !invites.length ? (
          <EmptyState title="Only you so far">
            Teammates look after the policies and agents with you. Use Invite
            teammate at the top of the page to make a link they can join with,
            in the role you choose.
          </EmptyState>
        ) : null}
      </div>
    </>
  );
}
