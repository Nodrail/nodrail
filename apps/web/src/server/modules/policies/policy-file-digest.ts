import "server-only";
import { fingerprint } from "@nodrail/sdk/protocol";
import type { Declarations, ProjectApply } from "@/contracts/v1/project-apply";
import type { takeoverHosts } from "./project-owner";

/** Bind the reviewed file, project and takeover to the preview environment. */
export function fileDigest(
  environmentId: string,
  text: unknown,
  {
    declarations,
    intended,
    takeover,
  }: {
    declarations?: Declarations;
    intended?: ProjectApply["intended"];
    takeover?: Awaited<ReturnType<typeof takeoverHosts>>;
  } = {},
) {
  return fingerprint({
    environmentId,
    ...(declarations ? { declarations } : {}),
    ...(intended ? { intended } : {}),
    ...(takeover ? { takeover } : {}),
    yaml: typeof text === "string" ? text.replace(/\r\n?/g, "\n") : null,
  });
}
