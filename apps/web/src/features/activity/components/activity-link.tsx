import { TextLink, type TextLinkProps } from "@/components/app/text-link";
import { VIEW_IN_ACTIVITY } from "@/contracts/v1/glossary";

/**
 * Every link into Activity: the product's text link, reading "View in
 * Activity →". Pass the filtered or event address it should open.
 */
export function ActivityLink(props: Omit<TextLinkProps, "children">) {
  return (
    <TextLink size="xs" {...props}>
      {VIEW_IN_ACTIVITY}
    </TextLink>
  );
}
