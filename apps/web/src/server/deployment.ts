import "server-only";
import { assertVercelDeployment } from "./deployment-env.mjs";

/** Self-hosting is the default. Cloud explicitly opts into Stripe and its allowances. */
export type DeploymentMode = "cloud" | "self-hosted";

let warned = false;

export function deploymentMode(
  env: Record<string, string | undefined> = process.env,
): DeploymentMode {
  assertVercelDeployment(env);
  const value = env.NODRAIL_DEPLOYMENT;
  if (value === "cloud") return "cloud";
  if (value && value !== "self-hosted" && !warned) {
    warned = true;
    console.warn(
      `NODRAIL_DEPLOYMENT=${JSON.stringify(value.slice(0, 40))} isn't cloud or self-hosted: running self-hosted.`,
    );
  }
  return "self-hosted";
}

/** The most a counter column holds: no limit, in practice. */
export const UNLIMITED = 2_147_483_647;

function limit(value: string | undefined) {
  if (!value) return UNLIMITED;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= UNLIMITED
    ? number
    : UNLIMITED;
}

/**
 * A self-hosted deployment's monthly limits per workspace, as its operator
 * set them; unset means none. Rate, body and retention limits still apply:
 * these are separate from them, and from Cloud's plans.
 */
export function operatorLimits(
  env: Record<string, string | undefined> = process.env,
) {
  return {
    intentsPerMonth: limit(env.NODRAIL_MONTHLY_ACTIONS),
    stepsPerMonth: limit(env.NODRAIL_MONTHLY_STEPS),
  };
}
