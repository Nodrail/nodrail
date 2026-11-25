import { readFileSync, writeFileSync } from "node:fs";

/** What the setup made, for the commands run outside the browser and the checks after. */
export type AcceptanceState = {
  email: string;
  base: string;
  token: string;
  storage: string;
};

const file = () => {
  const path = process.env.ACCEPTANCE_STATE;
  if (!path) throw new Error("Set ACCEPTANCE_STATE to a file path");
  return path;
};

export const saveState = (state: AcceptanceState) =>
  writeFileSync(file(), JSON.stringify(state, null, 2));

/** The signed-in browser state setup saves; read only when a test starts. */
export const storagePath = () => `${file()}.storage.json`;

export const readState = () =>
  JSON.parse(readFileSync(file(), "utf8")) as AcceptanceState;
