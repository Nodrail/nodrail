/**
 * Whether the person collapsed the sidebar to its icon rail on wide screens.
 * A cookie, not localStorage, so the server renders the frame as the person
 * left it: the frame mounts again between environment and settings pages, and
 * a state read after mount would animate the sidebar on every such visit.
 */
export const SIDEBAR_COOKIE = "nodrail.sidebar";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Expanded unless the person chose the rail: names beat bare icons. */
export function sidebarCollapsed(value: string | undefined) {
  return value === "collapsed";
}

/** Remembers the choice for a year, on every product path. */
export function rememberSidebar(collapsed: boolean) {
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
}
