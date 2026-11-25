"use client";

import { useMemo, useState } from "react";

/**
 * A list's search box and the rows it keeps: those whose text, from any of the
 * given fields, contains what was typed (case ignored), and that `keep` (the
 * list's other filters) accepts. Pass `text` and `keep` from module scope or
 * `useCallback`, so the list is filtered only when something changes.
 */
export function useListSearch<T>(
  items: T[],
  text: (item: T) => (string | null | undefined)[],
  keep?: (item: T) => boolean,
) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!keep || keep(item)) &&
        (!term || text(item).join(" ").toLowerCase().includes(term)),
    );
  }, [items, query, text, keep]);
  return { query, setQuery, visible };
}
