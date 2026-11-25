/**
 * The e2e server is told the product has its own host, as in production, so
 * app-host.spec.ts can ask for it by name. Links stay under
 * `/app` (NEXT_PUBLIC_SHORT_PRODUCT_URLS=false), because every other spec
 * reaches the server at 127.0.0.1, which is not that host.
 */
export const appHost = "app.nodrail.test";
