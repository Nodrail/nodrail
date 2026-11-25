import { settingsPath, type SettingsPage } from "./navigation";

type Context = { params: Promise<{ workspace: string }> };

/**
 * Settings and Team used to live in each environment
 * (`/<workspace>/<environment>/settings`); old links and emails move for good
 * to the workspace's settings page, keeping their query, such as the
 * `?billing=` Stripe adds on the way back from checkout.
 */
export function movedToSettings(
  pageFor: (query: URLSearchParams) => SettingsPage,
) {
  return async function GET(request: Request, { params }: Context) {
    const { workspace } = await params;
    const from = new URL(request.url);
    const to = new URL(
      settingsPath(encodeURIComponent(workspace), pageFor(from.searchParams)),
      from,
    );
    to.search = from.search;
    return Response.redirect(to, 308);
  };
}
