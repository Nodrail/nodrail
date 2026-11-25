import { parseArgs } from "node:util";
import { DataSource } from "typeorm";
import {
  hashPassword,
  loginEmail,
  newPassword,
} from "../src/server/auth/password";
import {
  accountFor,
  createVerifiedAccount,
  lockEmail,
  replacePassword,
} from "../src/server/auth/store";
import { newToken } from "../src/server/auth/token";
import { dataSourceOptions } from "../src/server/db/options";

async function readPassword() {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    bytes += chunk.length;
    if (bytes > 1026) throw new Error("Password input is too long");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      reset: { type: "boolean" },
      generate: { type: "boolean" },
    },
  });
  const email = loginEmail.safeParse(values.email);
  if (!email.success) throw new Error("Supply a valid --email address");
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url)
    throw new Error(
      "Set MIGRATION_DATABASE_URL to the database owner connection",
    );
  const generated = values.generate === true;
  if (!generated && process.stdin.isTTY)
    throw new Error("Pipe the password on stdin or use --generate");
  const password = newPassword.safeParse(
    generated ? newToken() : await readPassword(),
  );
  if (!password.success)
    throw new Error("Use a password of 12 to 256 characters");
  const hash = await hashPassword(password.data);
  const database = await new DataSource(dataSourceOptions(url)).initialize();
  try {
    await database.transaction(async (manager) => {
      await lockEmail(manager, email.data);
      const account = await accountFor(manager, email.data, true);
      if (values.reset) {
        if (account?.status !== "active")
          throw new Error("No active account to reset");
        await replacePassword(manager, account.user_id, email.data, hash);
      } else {
        if (account)
          throw new Error(
            "Account already exists. Use --reset to change its password.",
          );
        await createVerifiedAccount(manager, email.data, hash);
      }
    });
    console.error(
      values.reset
        ? "Password reset. Existing sessions were revoked."
        : "Login created.",
    );
    if (generated) console.log(password.data);
  } finally {
    await database.destroy();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && error.name === "Error" && !("code" in error)
      ? error.message
      : "Database operation failed. Check the owner connection and migrations.";
  console.error(message);
  process.exitCode = 1;
});
