import type { z } from "zod";
import type { ActionResult } from "@/components/app/action-result";
import {
  csrfResponse,
  policyFilePreview,
  policyFilePublished,
} from "@/contracts/v1/management-responses";
import type {
  PolicyFilePreviewDto,
  PolicyFileResultDto,
} from "@/contracts/v1/policies";
import type { previewBody, publishBody } from "@/contracts/v1/public-api";

type Place = { workspace: string; environment: string };
type PolicyCall =
  | { action: "preview"; body: z.input<typeof previewBody> }
  | { action: "publish"; body: z.input<typeof publishBody> };

const csrfHeader = "X-Nodrail-CSRF";

let issuingCsrf: Promise<string> | undefined;

function csrfToken() {
  issuingCsrf ??= readCsrfToken().finally(() => {
    issuingCsrf = undefined;
  });
  return issuingCsrf;
}

async function readCsrfToken() {
  const response = await fetch("/api/v1/session/csrf", {
    credentials: "same-origin",
    headers: { [csrfHeader]: "fetch" },
  });
  if (!response.ok) throw await requestError(response);
  return csrfResponse.parse(await response.json()).token;
}

class PolicyRequestError extends Error {}

async function requestError(response: Response) {
  if (response.status === 401)
    return new PolicyRequestError("Sign in again, then retry.");
  const body = (await response.json()) as {
    error?: { code?: string; message?: string };
  };
  switch (body.error?.code) {
    case "REPOSITORY_CHANGED":
      return new PolicyRequestError(
        body.error.message ?? "Reload to review repository ownership.",
      );
    case "RULE_CHANGED":
      return new PolicyRequestError(
        "The rules changed since this preview. Reload to see them and merge your edits, or preview again.",
      );
    case "INVALID_INPUT":
      return new PolicyRequestError(
        "This file has problems. Preview it again to see them.",
      );
    case "BUSY":
      return new PolicyRequestError(
        "A policy change is in progress. Try again in a moment.",
      );
    case "NOT_FOUND":
      return new PolicyRequestError(
        "This environment is no longer available. Reload and choose another.",
      );
    case "INSUFFICIENT_SCOPE":
    case "FORBIDDEN":
      return new PolicyRequestError(
        "Check your permissions and reload the page before retrying.",
      );
    default:
      return new PolicyRequestError("Something went wrong. Please try again.");
  }
}

async function post(place: Place, { action, body }: PolicyCall) {
  const query = new URLSearchParams(place);
  const response = await fetch(`/api/v1/rules/${action}?${query}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      [csrfHeader]: await csrfToken(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await requestError(response);
  return (await response.json()) as unknown;
}

function message(error: unknown) {
  return error instanceof PolicyRequestError
    ? error.message
    : "Something went wrong. Please try again.";
}

export async function reviewPolicyFile(
  place: Place,
  yaml: string,
): Promise<ActionResult<PolicyFilePreviewDto>> {
  try {
    const { policy_revision, file_digest, takeover, pins_current, ...preview } =
      policyFilePreview.parse(
        await post(place, { action: "preview", body: { yaml } }),
      );
    return {
      status: "ok",
      data: {
        ...preview,
        policyRevision: policy_revision,
        fileDigest: file_digest,
        pinsCurrent: pins_current,
        ...(takeover
          ? {
              takeover: {
                projectId: takeover.project_id,
                hosts: takeover.hosts,
              },
            }
          : {}),
      },
    };
  } catch (error) {
    return { status: "error", message: message(error) };
  }
}

export async function publishPolicyFile(
  place: Place,
  yaml: string,
  preview: Pick<PolicyFilePreviewDto, "policyRevision" | "fileDigest">,
  reviewedProjectId: string | null,
): Promise<ActionResult<PolicyFileResultDto>> {
  try {
    const { policy_revision, ...result } = policyFilePublished.parse(
      await post(place, {
        action: "publish",
        body: {
          yaml,
          policy_revision: preview.policyRevision,
          file_digest: preview.fileDigest,
          reviewed_project_id: reviewedProjectId,
        },
      }),
    );
    return {
      status: "ok",
      data: { ...result, policyRevision: policy_revision },
      message: "Rules applied.",
    };
  } catch (error) {
    return { status: "error", message: message(error) };
  }
}
