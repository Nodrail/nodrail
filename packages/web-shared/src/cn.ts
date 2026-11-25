import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * The named text sizes and letter spacings in styles/tokens.css. Without
 * them tailwind-merge reads `text-ui` as a colour and drops it against
 * `text-foreground`, and cannot tell that `tracking-label` replaces another.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "figure", "heading", "title", "ui", "micro"],
      tracking: ["display", "label"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
