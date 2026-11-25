import { effectLabels, type Effect } from "@/contracts/v1/policies";

/** What each decision does to a covered call, in a line. */
const effectDetails: Record<Effect, string> = {
  allow: "The agent goes ahead. Nobody is asked.",
  deny: "Each call is refused. Nobody is asked.",
};

const order: Effect[] = ["allow", "deny"];

/**
 * The rule's decision: Allow or Deny, each explained. Nothing
 * is chosen for a new rule; the person picks one before it can be saved.
 */
export function DecisionField({ initial }: { initial?: Effect }) {
  return (
    <fieldset className="grid gap-[7px]" data-tour="rule-effect">
      <legend className="mb-1.5 text-ui leading-normal font-semibold text-body">
        Decision
      </legend>
      {order.map((effect) => (
        <label
          key={effect}
          className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-[11px] transition-colors duration-150 hover:border-input has-checked:border-forest/45 has-checked:bg-success-soft/40"
        >
          <input
            type="radio"
            name="effect"
            value={effect}
            defaultChecked={initial === effect}
            aria-labelledby={`effect-${effect}-label`}
            aria-describedby={`effect-${effect}-detail`}
            required
            className="mt-1 accent-forest"
          />
          <span className="grid gap-[3px]">
            <b
              id={`effect-${effect}-label`}
              className="text-ui font-semibold text-body"
            >
              {effectLabels[effect]}
            </b>
            <small
              id={`effect-${effect}-detail`}
              className="text-xs leading-[1.4] text-muted-foreground"
            >
              {effectDetails[effect]}
            </small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
