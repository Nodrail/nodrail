"use client";

import { useCallback, useState } from "react";
import type { ActionResult } from "@/components/app/action-result";
import { Card } from "@/components/app/card";
import { CheckboxField, ChoiceRow } from "@/components/app/choice-field";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import {
  DataActionsCell,
  DataActionsHeading,
  DataEmpty,
  DataTable,
  DataTitle,
} from "@/components/app/data-table";
import { FormField, SelectField } from "@/components/app/form-field";
import { FormHint } from "@/components/app/note";
import { RowActions } from "@/components/app/row-actions";
import { SecretDialog } from "@/components/app/secret-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import {
  apiTokenExpiries,
  DEFAULT_TOKEN_EXPIRY_DAYS,
  scopeLabels,
  scopeRisks,
  type ApiTokenDto,
  type ApiTokenListDto,
  type ApiTokenScope,
  type IssuedApiTokenDto,
} from "@/contracts/v1/api-tokens";
import { formatUtc, timeAgo } from "@/lib/time";
import { createApiTokenAction, revokeApiTokenAction } from "../actions";

const expiryLabel = (days: number) =>
  days === 0 ? "No expiry" : `${days} days`;

function ScopeChoice({ scope }: { scope: Exclude<ApiTokenScope, "read"> }) {
  return (
    <CheckboxField
      name="scopes"
      value={scope}
      title={
        <>
          <code>{scope}</code> · {scopeLabels[scope]}
        </>
      }
      detail={scopeRisks[scope]}
    />
  );
}

function CreateToken({
  workspace,
  grantable,
  onIssued,
}: {
  workspace: string;
  grantable: ApiTokenScope[];
  onIssued: (issued: IssuedApiTokenDto) => void;
}) {
  const show = useCallback(
    (result: Extract<ActionResult<IssuedApiTokenDto>, { status: "ok" }>) => {
      if (result.data) onIssued(result.data);
    },
    [onIssued],
  );
  return (
    <ConfirmDialog
      kicker="API token"
      title="Create an API token"
      triggerLabel="Create token"
      triggerVariant="default"
      confirmLabel="Create token"
      confirmVariant="default"
      action={createApiTokenAction.bind(null, workspace)}
      onSuccess={show}
    >
      <FormField
        id="token-name"
        name="name"
        label="Name"
        maxLength={60}
        autoComplete="off"
        autoFocus
        required
        hint="Where you will use it, such as “laptop” or “CI”."
      />
      <SelectField
        id="token-expiry"
        name="expiresInDays"
        label="Expires after"
        defaultValue={String(DEFAULT_TOKEN_EXPIRY_DAYS)}
      >
        {apiTokenExpiries.map((days) => (
          <option key={days} value={days}>
            {expiryLabel(days)}
          </option>
        ))}
      </SelectField>
      <TokenScopeFields grantable={grantable} />
    </ConfirmDialog>
  );
}

function TokenScopeFields({ grantable }: { grantable: ApiTokenScope[] }) {
  const [reporting, setReporting] = useState(false);
  return (
    <>
      {grantable.includes("inventory:write") ? (
        <fieldset className="grid gap-2.5">
          <legend className="mb-2 text-ui font-semibold">Token type</legend>
          <ChoiceRow
            name="tokenType"
            value="personal"
            checked={!reporting}
            onChange={() => setReporting(false)}
            title="Personal access"
          />
          <ChoiceRow
            name="tokenType"
            value="reporting"
            checked={reporting}
            onChange={() => setReporting(true)}
            title="Inventory reporting"
            detail="For external collectors. Projects connected through apply report automatically."
          />
        </fieldset>
      ) : null}
      <fieldset
        className="grid gap-2.5"
        hidden={reporting}
        disabled={reporting}
      >
        <legend className="mb-2 text-ui font-semibold">Scopes</legend>
        <FormHint>
          <code>read</code> is always included. {scopeLabels.read}.
        </FormHint>
        {grantable
          .filter((scope) => scope !== "read" && scope !== "inventory:write")
          .map((scope) => (
            <ScopeChoice key={scope} scope={scope} />
          ))}
      </fieldset>
    </>
  );
}

function tokenStatus(token: ApiTokenDto) {
  if (token.revokedAt) return <StatusBadge tone="neutral">Revoked</StatusBadge>;
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now())
    return <StatusBadge tone="neutral">Expired</StatusBadge>;
  return token.expiresAt
    ? `Expires ${formatUtc(token.expiresAt)}`
    : "Never expires";
}

function TokenRow({
  workspace,
  token,
  grantable,
}: {
  workspace: string;
  token: ApiTokenDto;
  grantable: ApiTokenScope[];
}) {
  const live = !token.revokedAt;
  const active =
    live && (!token.expiresAt || Date.parse(token.expiresAt) > Date.now());
  const effective = active
    ? token.scopes.filter((scope) => grantable.includes(scope))
    : [];
  return (
    <tr>
      <td>
        <DataTitle>{token.name}</DataTitle>
        <small>
          <code>{token.prefix}_…</code>
          {token.mine ? null : ` · ${token.owner}`}
        </small>
      </td>
      <td>
        {token.scopes.join(", ")}
        {token.mine ? (
          <small>Effective now · {effective.join(", ") || "None"}</small>
        ) : null}
      </td>
      <td>
        {token.lastUsedAt ? timeAgo(token.lastUsedAt) : "Never used"}
        <small>{tokenStatus(token)}</small>
      </td>
      <DataActionsCell>
        <RowActions
          name={token.name}
          items={[
            live
              ? {
                  label: "Revoke…",
                  destructive: true,
                  confirm: {
                    kicker: "API token",
                    title: `Revoke “${token.name}”?`,
                    confirmLabel: "Revoke token",
                    action: () => revokeApiTokenAction(workspace, token.id),
                    children: (
                      <p>
                        It stops working on its next request. Anything using it,
                        such as the command line or an MCP server, must be given
                        a new token.
                      </p>
                    ),
                  },
                }
              : null,
          ]}
        />
      </DataActionsCell>
    </tr>
  );
}

/** Your account → API tokens: personal tokens for the API, CLI and MCP server. */
export function ApiTokensCard({
  workspace,
  list,
}: {
  workspace: string;
  list: ApiTokenListDto;
}) {
  const [issued, setIssued] = useState<IssuedApiTokenDto | null>(null);
  return (
    <Card
      title="API tokens"
      description="For the API, the nodrail command line and the MCP server. A token acts as you and never does more than your role allows."
      action={
        <CreateToken
          workspace={workspace}
          grantable={list.grantable}
          onIssued={setIssued}
        />
      }
    >
      {list.tokens.length ? (
        <DataTable aria-label="API tokens">
          <thead>
            <tr>
              <th>{list.seesEveryone ? "Token · owner" : "Token"}</th>
              <th>Issued scopes</th>
              <th>Last used</th>
              <DataActionsHeading />
            </tr>
          </thead>
          <tbody>
            {list.tokens.map((token) => (
              <TokenRow
                key={token.id}
                workspace={workspace}
                token={token}
                grantable={list.grantable}
              />
            ))}
          </tbody>
        </DataTable>
      ) : (
        <DataEmpty>
          <b>No API tokens yet</b>
          Create one to use Nodrail from a terminal, a script or an assistant.
        </DataEmpty>
      )}
      {issued ? (
        <IssuedToken
          key={issued.token.id}
          issued={issued}
          grantable={list.grantable}
          onDone={() => setIssued(null)}
        />
      ) : null}
    </Card>
  );
}

function IssuedToken({
  issued,
  grantable,
  onDone,
}: {
  issued: IssuedApiTokenDto;
  grantable: ApiTokenScope[];
  onDone: () => void;
}) {
  const { secret, token } = issued;
  const reporting = token.scopes.includes("inventory:write");
  const effective = token.scopes.filter((scope) => grantable.includes(scope));
  return (
    <SecretDialog
      dialogLabel="API token ready"
      title={`Token “${token.name}” created`}
      secretLabel="API token"
      secret={secret}
      onDone={onDone}
      instructions={
        <FormHint>
          {reporting ? (
            <>
              Scope <code>inventory:write</code>. Set your external
              collector&apos;s header to{" "}
              <code>Authorization: Bearer &lt;token shown above&gt;</code>.
            </>
          ) : (
            <>
              Effective now · {effective.join(", ") || "None"}. Use this token
              with <code>nodrail login --token-stdin</code> or as{" "}
              <code>NODRAIL_TOKEN</code>.
            </>
          )}
        </FormHint>
      }
    />
  );
}
