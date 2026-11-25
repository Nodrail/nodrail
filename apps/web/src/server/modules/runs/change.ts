import "server-only";
import { isChange } from "@nodrail/policy-engine";
import type { ActionDescriptor } from "@nodrail/client/protocol";

/**
 * Whether an action would change things if it went ahead, so gates' `since`
 * counts it as work: the engine's own `isChange`. The one place Cloud asks.
 * Stored with the action when it is recorded, because retention later blanks
 * the resource it is judged by; history adds whether it went ahead.
 */
export function changeOf(descriptor: ActionDescriptor): boolean {
  return isChange(descriptor);
}
