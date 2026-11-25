import {
  isShortProductSegment,
  shortProductUrls,
} from "@nodrail/web-shared/routes";

export { shortProductUrls };

const join = (segments: readonly string[]) =>
  segments.filter((segment) => segment !== "").join("/");

/**
 * The public path of a product page, given whether URLs are short. A workspace
 * whose slug is also a top-level route (older than the reserved list) keeps
 * the prefix, because its short URL would open that route instead.
 */
export function productPath(path: string, short: boolean) {
  if (!short) return path ? `/app/${path}` : "/app";
  if (!path) return "/";
  const [first = ""] = path.split(/[/?#]/, 1);
  return isShortProductSegment(first) ? `/${path}` : `/app/${path}`;
}

/**
 * Every link, redirect and email to a product page: `appPath()` is the product
 * home, `appPath(workspace, environment, "policies", rule)` a page in it.
 * Segments are joined as given, so encode values that need it.
 */
export function appPath(...segments: string[]) {
  return productPath(join(segments), shortProductUrls);
}

/**
 * The route file's path, always under `/app`. Only for `revalidatePath`, which
 * needs the destination of a rewrite, not the URL the browser shows.
 */
export function appRoute(...segments: string[]) {
  return productPath(join(segments), false);
}

/**
 * Whether a same-site path opens a product page: `/app/…`, or, with short URLs,
 * `/` and `/<workspace>/…`.
 */
export function isProductPath(path: string, short = shortProductUrls) {
  if (path === "/app" || path.startsWith("/app/")) return true;
  if (!short) return false;
  const [, first = ""] = path.split("/", 2);
  return path === "/" || isShortProductSegment(first);
}
