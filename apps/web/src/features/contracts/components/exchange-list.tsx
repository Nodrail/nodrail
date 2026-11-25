import { Disclosure } from "@/components/app/card";
import type { ContractEventDto } from "@/contracts/v1/contract-events";
import { eventState, surfaceNouns } from "../presentation";
import { ReceiptInspector } from "./receipt-inspector";

/**
 * A step's or action's checked exchanges: its brief, the input
 * a connection was called with and the result it returned, each with its
 * state and, opened, what its contract reports. Same states, redaction and
 * missing markers as a receipt.
 */
export function ExchangeList({ events }: { events: ContractEventDto[] }) {
  if (events.length === 0) return null;
  return (
    <ul data-slot="contract-exchanges" className="grid gap-1">
      {events.map((event) => (
        <li key={event.id} data-surface={event.surface}>
          <Disclosure
            summary={`${surfaceNouns[event.surface]}: ${eventState(event).label}`}
          >
            <ReceiptInspector event={event} />
          </Disclosure>
        </li>
      ))}
    </ul>
  );
}
