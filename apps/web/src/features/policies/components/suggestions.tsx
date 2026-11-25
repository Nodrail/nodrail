import type { ReactNode } from "react";
import { splitList } from "../form";

/** Names a field offers while typing; nothing when there are none. */
export function Suggestions({ id, values }: { id: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <datalist id={id}>
      {values.map((value) => (
        <option key={value} value={value} />
      ))}
    </datalist>
  );
}

/**
 * A field's hint, or a warning in its place when it names a step agent that
 * never reported here. It never blocks saving: the agent may report later.
 */
export function stepAgentHint(
  value: string,
  known: string[],
  hint?: ReactNode,
): ReactNode {
  const unknown = splitList(value).filter((name) => !known.includes(name));
  if (!unknown.length) return hint;
  return (
    <span data-slot="field-warning" className="text-warning-strong">
      {unknown.length === 1
        ? `No step agent called “${unknown[0]}” has reported`
        : `No step agents called ${unknown.map((name) => `“${name}”`).join(" or ")} have reported`}{" "}
      in this environment.{hint ? <> {hint}</> : null}
    </span>
  );
}
