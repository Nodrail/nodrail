import "server-only";

/** Enrolled installations have their own agent row, even for identified callers. */
export const machineAccessJoin = (installation: string) => `
  JOIN nodrail.installations i ON i.workspace_id = a.workspace_id AND i.id = ${installation}
  JOIN nodrail.agents machine ON machine.workspace_id = i.workspace_id AND machine.id = i.agent_id`;

export const accessStatus = `CASE WHEN machine.access_status = 'paused'
  THEN 'paused' ELSE a.access_status END`;

// Both epochs only increase. A pause at either level invalidates prior requests.
export const accessEpoch = `a.access_epoch +
  CASE WHEN a.id = machine.id THEN 0 ELSE machine.access_epoch END`;
