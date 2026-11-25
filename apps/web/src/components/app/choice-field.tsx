import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { focusRing } from "./styles";

/** A native checkbox or radio in the product's look: forest when chosen. */
const choiceInput = cn(
  "mt-0.5 size-4 shrink-0 cursor-pointer accent-forest",
  focusRing,
);

/** A choice's words: a bold line with a quiet explanation under it. */
export function ChoiceText({
  title,
  detail,
}: {
  title: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <span className="grid min-w-0 gap-0.75">
      <b className="text-ui font-semibold text-body">{title}</b>
      {detail ? (
        <small className="text-xs leading-[1.4] text-muted-foreground">
          {detail}
        </small>
      ) : null}
    </span>
  );
}

type ChoiceProps = Omit<ComponentProps<"input">, "type" | "title"> & {
  title: ReactNode;
  detail?: ReactNode;
};

/** A labelled checkbox: the box first, then what it turns on and why. */
export function CheckboxField({
  title,
  detail,
  className,
  ...input
}: ChoiceProps) {
  return (
    <label
      data-slot="checkbox-field"
      className={cn("flex items-start gap-2.5 text-ui", className)}
    >
      <input type="checkbox" className={choiceInput} {...input} />
      <ChoiceText title={title} detail={detail} />
    </label>
  );
}

/**
 * One of a set of radio choices, as a bordered row that highlights when
 * chosen. Put them in a `fieldset` with a legend.
 */
export function ChoiceRow({ title, detail, className, ...input }: ChoiceProps) {
  return (
    <label
      data-slot="choice-row"
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.75 transition-colors duration-150 hover:border-input has-checked:border-forest/45 has-checked:bg-success-soft/40",
        className,
      )}
    >
      <input type="radio" className={cn(choiceInput, "mt-0")} {...input} />
      <ChoiceText title={title} detail={detail} />
    </label>
  );
}
