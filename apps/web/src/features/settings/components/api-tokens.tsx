"use client";

import { useCallback, useState } from "react";
import type { ActionResult } from "@/components/app/action-result";
import { Card } from "@/components/app/card";
import { CheckboxField } from "@/components/app/choice-field";
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
      <fieldset className="grid gap-2.5">
        <legend className="mb-2 text-ui font-semibold">Scopes</legend>
        <FormHint>
          <code>read</code> is always included, but in a reporting token:{" "}
          {scopeLabels.read}.
        </FormHint>
        {grantable
          .filter((scope) => scope !== "read")
          .map((scope) => (
            <ScopeChoice key={scope} scope={scope} />
          ))}
      </fieldset>
    </ConfirmDialog>
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
}: {
  workspace: string;
  token: ApiTokenDto;
}) {
  const live = !token.revokedAt;
  return (
    <tr>
      <td>
        <DataTitle>{token.name}</DataTitle>
        <small>
          <code>{token.prefix}_…</code>
          {token.mine ? null : ` · ${token.owner}`}
        </small>
      </td>
      <td>{token.scopes.join(", ")}</td>
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
              <th>Scopes</th>
              <th>Last used</th>
              <DataActionsHeading />
            </tr>
          </thead>
          <tbody>
            {list.tokens.map((token) => (
              <TokenRow key={token.id} workspace={workspace} token={token} />
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
        <SecretDialog
          dialogLabel="API token ready"
          title={`Token “${issued.token.name}” created`}
          secretLabel="API token"
          secret={issued.secret}
          onDone={() => setIssued(null)}
        >
          <FormHint>
            Scopes: {issued.token.scopes.join(", ")}. Use it with{" "}
            <code>nodrail login</code> or as <code>NODRAIL_TOKEN</code>.
          </FormHint>
        </SecretDialog>
      ) : null}
    </Card>
  );
}
