import Link from "next/link";
import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { focusRing } from "./styles";

const textLink = cva(
  cn("rounded-sm underline-offset-2 transition-colors", focusRing),
  {
    variants: {
      variant: {
        /** The next step: "See all →", "Open activity →". Forest, bold. */
        primary: "font-semibold text-forest hover:underline",
        /** A secondary link beside a primary one. */
        quiet: "text-muted-foreground hover:text-foreground hover:underline",
        /** A link inside a sentence: always underlined. */
        inline: "text-forest underline",
        /** On a tinted banner: the banner's own colour, underlined. */
        inherit: "font-semibold underline",
      },
      size: {
        /** The text around it decides. */
        inherit: "",
        /** Under a heading or in a table row. */
        xs: "text-xs",
      },
    },
    defaultVariants: { variant: "primary", size: "inherit" },
  },
);

export type TextLinkProps = ComponentProps<typeof Link> &
  VariantProps<typeof textLink>;

/**
 * The product's one text link, with the focus ring every control has. Use a
 * Button with `asChild` when a link should look like a button.
 */
export function TextLink({
  variant,
  size,
  className,
  ...props
}: TextLinkProps) {
  return (
    <Link
      data-slot="text-link"
      className={cn(textLink({ variant, size }), className)}
      {...props}
    />
  );
}
