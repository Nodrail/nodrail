/**
 * Cloud releases must opt into billing and quota enforcement explicitly.
 * @param {Record<string, string | undefined>} env
 */
export function assertVercelDeployment(env = process.env) {
  if (
    (env.VERCEL === "1" || env.VERCEL_ENV !== undefined) &&
    env.NODRAIL_DEPLOYMENT !== "cloud"
  ) {
    throw new Error("Set NODRAIL_DEPLOYMENT=cloud for Nodrail on Vercel.");
  }
}
