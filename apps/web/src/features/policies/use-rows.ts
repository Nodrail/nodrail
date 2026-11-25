"use client";

import { useState } from "react";

/**
 * Rows a form adds and removes, such as a rule's conditions or a gate's
 * requirements, each with a key of its own that never repeats.
 */
export function useRows<T extends object>(initial: T[], blank: T) {
  const [rows, setRows] = useState<(T & { key: number })[]>(
    initial.map((row, key) => ({ ...row, key })),
  );
  return {
    rows,
    update: (key: number, change: Partial<T>) =>
      setRows((all) =>
        all.map((row) => (row.key === key ? { ...row, ...change } : row)),
      ),
    remove: (key: number) =>
      setRows((all) => all.filter((row) => row.key !== key)),
    add: () =>
      setRows((all) => [
        ...all,
        { ...blank, key: Math.max(-1, ...all.map((row) => row.key)) + 1 },
      ]),
  };
}
