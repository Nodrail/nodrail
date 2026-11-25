import { legendLooks } from "../entry-looks";

/** What the colored bars beside the YAML mean, in the editor's own colours. */
export function YamlLegend() {
  return (
    <ul
      aria-label="Colors in the editor"
      className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground"
    >
      {legendLooks.map(({ key, label, fill }) => (
        <li key={key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-xs"
            style={{ backgroundColor: fill }}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}
