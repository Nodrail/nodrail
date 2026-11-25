"use client";

import { useActionState } from "react";
import { idleResult, type ActionResult } from "./action-result";
import { useToast } from "./toast";

/**
 * A server action with standard feedback. The toast and callback run here, not
 * in an effect, because the change may replace the component that started it.
 */
export function useAppAction<T>(
  action: (
    previous: ActionResult<T>,
    data: FormData,
  ) => Promise<ActionResult<T>>,
  onSuccess?: (result: Extract<ActionResult<T>, { status: "ok" }>) => void,
) {
  const toast = useToast();
  return useActionState<ActionResult<T>, FormData>(async (previous, data) => {
    const result = await action(previous, data);
    if (result.status === "ok") {
      if (result.message) toast(result.message);
      onSuccess?.(result);
    }
    return result;
  }, idleResult);
}
