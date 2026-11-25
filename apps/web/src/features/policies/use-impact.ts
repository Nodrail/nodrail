"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImpactChange, ImpactDto } from "@/contracts/v1/policy-impact";
import { previewImpactAction } from "./actions";

/** Long enough that typing a name doesn't ask the server on every key. */
const IMPACT_DELAY_MS = 500;

/**
 * The form's fields as an entry, read again on every change and after every
 * render (state-held fields, such as conditions, live in hidden inputs). The
 * key changes only when the entry does.
 *
 * `submitting` is set the moment the form submits, before its action runs,
 * and cleared when an unsuccessful save ends: the preview asks nothing while
 * the entry is being published, since its answer would be out of date.
 */
export function useFormEntry<T>(
  fromForm: (data: FormData) => T,
  pending: boolean,
) {
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const [entry, setEntry] = useState<{ key: string; value: T | null }>({
    key: "",
    value: null,
  });
  // The key last read. An unchanged form must not even ask React for an
  // update: while a publish is pending React can't drop a same-value update
  // at once, so asking after every render re-rendered the form at a higher
  // priority than the publish, again and again, and on a slow CPU the
  // publish and its navigation never finished.
  const last = useRef("");
  const read = useCallback(() => {
    if (!form.current) return;
    const value = fromForm(new FormData(form.current));
    const key = JSON.stringify(value);
    if (key === last.current) return;
    last.current = key;
    setEntry({ key, value });
  }, [fromForm]);
  useEffect(read);
  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending]);
  /** The form's action, marking the form as submitting first. */
  const submitWith = useCallback(
    (submit: (data: FormData) => void) => (data: FormData) => {
      submitting.current = true;
      submit(data);
    },
    [],
  );
  return { form, read, submitting, submitWith, ...entry };
}

export type ImpactState =
  | { status: "waiting" | "checking" | "failed"; impact?: undefined }
  | { status: "ready"; impact: ImpactDto | null };

/**
 * What the entry would have done in the last days, asked of the server a
 * moment after the form stops changing. Answers to older entries are dropped,
 * and nothing is asked while the form is submitting.
 */
export function useImpact(
  where: { workspace: string; environment: string },
  change: Pick<ImpactChange, "kind" | "id">,
  entry: {
    key: string;
    value: unknown;
    submitting: { readonly current: boolean };
  },
) {
  const [state, setState] = useState<ImpactState>({ status: "waiting" });
  const { workspace, environment } = where;
  const { kind, id } = change;
  const { key, value, submitting } = entry;
  useEffect(() => {
    if (!key) return;
    let current = true;
    const timer = setTimeout(() => {
      if (submitting.current) return;
      setState({ status: "checking" });
      previewImpactAction(workspace, environment, { kind, id, entry: value })
        .then((impact) => {
          if (current) setState({ status: "ready", impact });
        })
        .catch(() => {
          if (current) setState({ status: "failed" });
        });
    }, IMPACT_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [workspace, environment, kind, id, key, value, submitting]);
  return state;
}
