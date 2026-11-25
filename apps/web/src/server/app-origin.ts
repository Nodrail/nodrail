import "server-only";
import { isLoopbackHost } from "./loopback";

export function appOrigin() {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new Error("APP_ORIGIN missing");
  const url = new URL(configured);
  const localHttp = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "APP_ORIGIN must be an HTTPS origin or a loopback HTTP origin",
    );
  return url.origin;
}
