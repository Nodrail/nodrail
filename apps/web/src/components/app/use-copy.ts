"use client";

import { useToast } from "./toast";

/** Copies text, and says in a toast whether it worked. */
export function useCopy() {
  const toast = useToast();
  return (text: string, copied = "Copied.") =>
    navigator.clipboard.writeText(text).then(
      () => toast(copied),
      () =>
        toast("Couldn't copy. Select the text and copy it instead.", "error"),
    );
}
