/**
 * The visible focus ring every product control uses, as Button does: a solid
 * 2px ring in forest with a 2px gap, so it reads on any fill (3:1 or more).
 */
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The same ring for a control that wraps its input (a search box). */
export const focusWithinRing =
  "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background";

/** Small uppercase label above a title or group, such as "Workspaces". */
export const eyebrow =
  "text-micro font-semibold tracking-label text-muted-foreground uppercase";

/** Product display headings use Manrope bold in ink. */
export const displayHeading = "font-display font-bold text-foreground";

/*
 * Heading presets: the only sizes a product heading takes. Pair each with the
 * heading level the page needs; the size follows the role, not the level.
 */

/** A page's one title (PageHeader, the sign-in card). */
export const pageTitle = `${displayHeading} text-display leading-[1.2] tracking-display`;

/** A dialog's, a sheet's or a stand-alone empty state's title. */
export const dialogTitle = `${displayHeading} text-heading leading-[1.3]`;

/** A card's title. */
export const cardTitle = `${displayHeading} text-title leading-[1.3]`;

/** A section's title inside a page or a panel's toolbar ("Open requests"). */
export const sectionTitle = `${displayHeading} text-sm`;

/** A section's title over a rule, inside a dialog ("Action to review"). */
export const dividerHeading = `${sectionTitle} mt-4 mb-2.5 border-t border-border pt-3.5`;

/** A quiet uppercase heading over a group inside a card. */
export const groupHeading =
  "text-xs font-semibold tracking-label text-muted-foreground uppercase";

/** A big number in a tile or an Insights section. */
export const figure =
  "font-display text-figure leading-[1.15] font-bold text-foreground tabular-nums";

/**
 * The phone media query, for JavaScript. The same query as the `phone:`
 * variant in src/styles/tokens.css: phones are 780px and narrower.
 */
export const phoneMedia = "(width < 781px)";
