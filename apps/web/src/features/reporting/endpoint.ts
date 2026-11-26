import "server-only";
import { appOrigin } from "@/server/app-origin";

export function reportingEndpoint(environment: string) {
  const url = new URL("/api/v1/otlp/v1/traces", appOrigin());
  url.searchParams.set("environment", environment);
  return url.href;
}
