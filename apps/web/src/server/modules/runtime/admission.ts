import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { proofExpiry, signingKey, verificationKey } from "./admission-keys";
import type { runtimeCaller } from "./caller";

type Caller = Awaited<ReturnType<typeof runtimeCaller>>;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A call gets evidence for exactly the access state observed under DB locks. */
export function admissionId(
  caller: Caller,
  call: string,
  policy: string | null,
) {
  const { pauseReplayKey } = caller.context;
  if (!pauseReplayKey) return undefined;
  const { id, key } = signingKey(pauseReplayKey);
  const header = `${id}.${proofExpiry(nowSeconds())}`;
  const signature = sign(caller, { call, policy, header }, key).toString(
    "base64url",
  );
  return `${header}.${signature}`;
}

function sign(
  caller: Caller,
  {
    call,
    policy,
    header,
  }: { call: string; policy: string | null; header: string },
  key: Buffer,
) {
  const { installationId, credentialId, agentId } = caller.context;
  return createHmac("sha256", key)
    .update(
      JSON.stringify([
        header,
        installationId,
        credentialId,
        agentId,
        call,
        policy,
        caller.epoch,
        caller.accessAgents.map(({ id, access_epoch, paused_at }) => [
          id,
          access_epoch,
          paused_at !== null,
        ]),
      ]),
    )
    .digest();
}

export function admitted(
  caller: Caller,
  report: {
    admission_id?: string | undefined;
    idempotency_key: string;
    policy_digest: string | null;
    paused_agents?: string[] | undefined;
  },
) {
  if (!!report.paused_agents !== !!caller.refusal || !report.admission_id)
    return false;
  const proof =
    /^([A-Za-z0-9_-]{1,32})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/.exec(
      report.admission_id,
    );
  const now = nowSeconds();
  const seed = caller.context.pauseReplayKey;
  if (!proof || !seed || Number(proof[2]) <= now) return false;
  const [, id, expires, signature] = proof;
  const key = verificationKey(seed, id!, now);
  if (!key) return false;
  const expected = sign(
    caller,
    {
      call: report.idempotency_key,
      policy: report.policy_digest,
      header: `${id}.${expires}`,
    },
    key,
  );
  return timingSafeEqual(expected, Buffer.from(signature!, "base64url"));
}
