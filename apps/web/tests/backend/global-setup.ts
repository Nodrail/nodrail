import {
  backendTestDatabase,
  createTestDatabase,
  provisionTestDatabase,
} from "../support/local-stack";

export default async function setup() {
  const { database, appRole, own } = backendTestDatabase();
  if (own) await createTestDatabase(database, appRole);
  else await provisionTestDatabase(database, appRole);
}
