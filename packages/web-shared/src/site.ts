export const site = {
  name: "Nodrail",
  url: "https://nodrail.com",
  github: "https://github.com/Nodrail",
  /** The engine, client and their compatibility tests. */
  repository: "https://github.com/Nodrail/nodrail",
  contactEmail: "hello@nodrail.com",
  signup: "https://app.nodrail.com/signup",
  login: "https://app.nodrail.com/login",
} as const;
export const isPublicProduction =
  process.env.VERCEL_ENV === "production" ||
  process.env.DEPLOYMENT_ENV === "production";
