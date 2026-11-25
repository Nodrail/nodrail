"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/app/action-result";
import { runWorkspaceAction } from "@/features/shell/load-view";
import { clearSessionCookie, requirePrincipal } from "@/server/auth/current";
import { appOrigin } from "@/server/app-origin";
import { billingConfig, stripeClient } from "@/server/billing/stripe";
import { AppError, type ErrorCode } from "@/server/db/context";
import { eraseAccount } from "@/server/modules/account";
import { createApiToken, revokeApiToken } from "@/server/modules/api-tokens";
import {
  MAX_LIVE_TOKENS,
  type IssuedApiTokenDto,
} from "@/contracts/v1/api-tokens";
import { archiveWorkspace } from "@/server/modules/workspaces";
import { describeError } from "@/server/log";
import {
  createOrReuseCheckout,
  prepareCheckout,
  preparePortal,
  saveCustomer,
  saveOpenCheckout,
} from "@/server/modules/billing";
import {
  saveNotificationPreferences,
  updateWorkspaceSettings,
} from "@/server/modules/workspaces";
import { settingsPath } from "@/features/shell/navigation";
import { appPath } from "@/lib/product-path";

export async function saveWorkspaceAction(
  workspace: string,
  _previous: ActionResult,
  data: FormData,
): Promise<ActionResult> {
  const result = await runWorkspaceAction(
    workspace,
    (context) =>
      updateWorkspaceSettings(context, {
        name: data.get("name"),
        defaultEnvironment: data.get("defaultEnvironment"),
      }),
    { INVALID_INPUT: "Enter a workspace name of up to 120 characters." },
  );
  return result.status === "ok"
    ? { status: "ok", message: "Workspace saved." }
    : result;
}

export async function savePreferencesAction(
  workspace: string,
  _previous: ActionResult,
  data: FormData,
): Promise<ActionResult> {
  const result = await runWorkspaceAction(workspace, (context) =>
    saveNotificationPreferences(context, {
      integrationStale: data.has("integrationStale"),
      usageAlerts: data.has("usageAlerts"),
    }),
  );
  return result.status === "ok"
    ? { status: "ok", message: "Preferences saved." }
    : result;
}

const billingMessages: Partial<Record<ErrorCode, string>> = {
  FORBIDDEN: "Only the workspace owner can manage the plan.",
  ALREADY_EXISTS: "This workspace is already on the paid plan.",
  NOT_FOUND: "This workspace has no billing account yet.",
};

const paymentsDown: ActionResult = {
  status: "error",
  message: "Payments are unavailable right now. Please try again.",
};

/** Where Stripe sends people back to: the billing page, on the app's host. */
const billingPage = (workspace: string) =>
  `${appOrigin()}${settingsPath(workspace, "billing")}`;

/** Stripe is called between these steps, never while a database lock is held. */
export async function startCheckoutAction(
  workspace: string,
): Promise<ActionResult<{ url: string }>> {
  const prepared = await runWorkspaceAction(
    workspace,
    prepareCheckout,
    billingMessages,
  );
  if (prepared.status !== "ok") return prepared;
  if (!billingConfig()) return paymentsDown;
  const { workspaceId } = prepared.value;
  const settings = billingPage(workspace);
  let url: string | null;
  try {
    const stripe = stripeClient();
    const customerId =
      prepared.value.customerId ??
      (
        await stripe.customers.create(
          { metadata: { workspace_id: workspaceId } },
          { idempotencyKey: `customer-${workspaceId}` },
        )
      ).id;
    if (!prepared.value.customerId) {
      const saved = await runWorkspaceAction(workspace, (context) =>
        saveCustomer(context, customerId),
      );
      if (saved.status !== "ok") return saved;
    }
    const session = await createOrReuseCheckout(
      {
        workspaceId,
        customerId,
        openCheckoutId: prepared.value.openCheckoutId,
      },
      settings,
    );
    url = session.url;
    const remembered = await runWorkspaceAction(workspace, (context) =>
      saveOpenCheckout(context, session.id),
    );
    if (remembered.status !== "ok") return remembered;
  } catch (error) {
    console.error("Checkout failed", describeError(error));
    return paymentsDown;
  }
  if (!url) return paymentsDown;
  return { status: "ok", data: { url } };
}

export async function openBillingPortalAction(
  workspace: string,
): Promise<ActionResult> {
  const prepared = await runWorkspaceAction(
    workspace,
    preparePortal,
    billingMessages,
  );
  if (prepared.status !== "ok") return prepared;
  let url: string;
  try {
    ({ url } = await stripeClient().billingPortal.sessions.create({
      customer: prepared.value.customerId,
      return_url: billingPage(workspace),
    }));
  } catch (error) {
    console.error("Billing portal failed", describeError(error));
    return paymentsDown;
  }
  redirect(url);
}

export async function archiveWorkspaceAction(
  workspace: string,
  _previous: ActionResult,
  data: FormData,
): Promise<ActionResult> {
  const result = await runWorkspaceAction(
    workspace,
    (context) => archiveWorkspace(context, data.get("confirm")),
    {
      INVALID_INPUT: "Type the workspace name exactly.",
      BILLING_ACTIVE: "Cancel the paid plan before archiving this workspace.",
    },
  );
  if (result.status !== "ok") return result;
  redirect(appPath());
}

const accountMessages: Partial<Record<string, string>> = {
  INVALID_INPUT: "Type your email address exactly.",
  OWNS_WORKSPACE:
    "You own a workspace. Transfer it or archive it before deleting your account.",
};

export async function deleteAccountAction(
  _previous: ActionResult,
  data: FormData,
): Promise<ActionResult> {
  const principal = await requirePrincipal();
  try {
    await eraseAccount(principal, data.get("confirm"));
  } catch (error) {
    if (error instanceof AppError)
      return {
        status: "error",
        message:
          accountMessages[error.code] ??
          "Something went wrong. Please try again.",
      };
    console.error("Account erasure failed", describeError(error));
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }
  await clearSessionCookie();
  redirect("/login");
}

/** The token comes back once, in the answer, and is never readable again. */
export async function createApiTokenAction(
  workspace: string,
  _previous: ActionResult<IssuedApiTokenDto>,
  data: FormData,
): Promise<ActionResult<IssuedApiTokenDto>> {
  const result = await runWorkspaceAction(
    workspace,
    (context) =>
      createApiToken(context, {
        name: data.get("name"),
        scopes: data.getAll("scopes"),
        expiresInDays: data.get("expiresInDays"),
      }),
    {
      FORBIDDEN: "Your role can't give a token that scope.",
      INVALID_INPUT: `Name the token in up to 60 characters. You can have up to ${MAX_LIVE_TOKENS} live tokens.`,
    },
  );
  return result.status === "ok"
    ? { status: "ok", data: result.value, message: "API token created." }
    : result;
}

export async function revokeApiTokenAction(
  workspace: string,
  tokenId: string,
): Promise<ActionResult> {
  const result = await runWorkspaceAction(workspace, (context) =>
    revokeApiToken(context, tokenId),
  );
  return result.status === "ok"
    ? { status: "ok", message: "API token revoked." }
    : result;
}
