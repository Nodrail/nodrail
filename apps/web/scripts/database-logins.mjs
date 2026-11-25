// A provisioned login inherits exactly the access granted by its group role.
export async function provisionLogin(client, login, role, password) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(login))
    throw new Error("Database login must be a plain lowercase name");
  if (password.length < 16)
    throw new Error("Database login password must have at least 16 characters");

  const opposite = role === "nodrail_app" ? "nodrail_auth" : "nodrail_app";
  const {
    rows: [existing],
  } = await client.query(
    `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
            pg_has_role(oid, $2, 'MEMBER') AS other_role
     FROM pg_roles WHERE rolname = $1`,
    [login, opposite],
  );
  if (
    existing &&
    (!existing.rolcanlogin ||
      existing.rolsuper ||
      existing.rolbypassrls ||
      existing.rolcreaterole ||
      existing.rolcreatedb ||
      existing.other_role)
  )
    throw new Error(`Database login ${login} has incompatible privileges`);

  const quoted = client.escapeLiteral(password);
  await client.query(
    existing
      ? `ALTER ROLE ${login} PASSWORD ${quoted}`
      : `CREATE ROLE ${login} LOGIN PASSWORD ${quoted}`,
  );
  // Tenant connections also assume the app group's read and background roles.
  const canSet = role === "nodrail_app" ? "TRUE" : "FALSE";
  await client.query(
    `GRANT ${role} TO ${login} WITH INHERIT TRUE, SET ${canSet}`,
  );
}
