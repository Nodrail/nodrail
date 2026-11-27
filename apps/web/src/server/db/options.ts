import pg from "pg";
import { databaseConnection } from "./connection-options";
import { DefaultNamingStrategy, type DataSourceOptions } from "typeorm";
import * as authTables from "./auth-entities";
import * as tables from "./entities";
import * as guidanceTables from "./guidance-entities";
import * as tokenTables from "./token-entities";
import * as inventoryTables from "./inventory-entities";
import * as reportingTables from "./reporting-entities";
import * as contractTables from "./contract-entities";
import * as enrollmentTables from "./enrollment-entities";
import * as evidenceTables from "./evidence-entities";
import * as budgetTables from "./budget-entities";
import * as notificationTables from "./notification-entities";
import * as opsTables from "./ops-entities";
import * as usageTables from "./usage-entities";

const snake = (value: string) =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

class SnakeNamingStrategy extends DefaultNamingStrategy {
  override columnName(
    propertyName: string,
    customName: string | undefined,
    prefixes: string[],
  ) {
    return customName ?? snake([...prefixes, propertyName].join("_"));
  }
}

/**
 * Every export of the entities modules is a table, named after its export.
 * TypeORM tells entities apart by class name, which the production build
 * shortens per module, so classes from two modules can share one ("i") and
 * look like a circular relation. Export names survive the build.
 */
type EntityClass = abstract new (...args: never[]) => object;

function named(module: Record<string, EntityClass>) {
  return Object.entries(module).map(([name, entity]) => {
    if (entity.name !== name)
      Object.defineProperty(entity, "name", { value: name });
    return entity;
  });
}

const entities = [
  ...named(tables),
  ...named(authTables),
  ...named(tokenTables),
  ...named(usageTables),
  ...named(guidanceTables),
  ...named(inventoryTables),
  ...named(reportingTables),
  ...named(contractTables),
  ...named(evidenceTables),
  ...named(enrollmentTables),
  ...named(budgetTables),
  ...named(opsTables),
  ...named(notificationTables),
];

/** Schema changes only ever happen through reviewed migrations. */
export function dataSourceOptions(
  url: string,
): Extract<DataSourceOptions, { type: "postgres" }> {
  const { connectionString, ssl } = databaseConnection(url);
  return {
    type: "postgres",
    // Passed directly: TypeORM's own lookup is invisible to the build, which
    // then leaves the driver out of hosted functions.
    driver: pg,
    url: connectionString,
    ssl,
    entities,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    migrationsRun: false,
    // Selects gen_random_uuid(), which needs no extension. The application role
    // must never try to install one.
    installExtensions: false,
    uuidExtension: "pgcrypto",
  };
}
