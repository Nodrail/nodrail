import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiError } from "@nodrail/cli/api";
import { HELP, readFlags, serverFor, VERSION } from "./main.ts";

// stdout carries the protocol, so everything for people goes to stderr.
try {
  const flags = readFlags(process.argv.slice(2));
  if (flags.version) process.stderr.write(`${VERSION}\n`);
  else if (flags.help) process.stderr.write(`${HELP}\n`);
  else {
    const server = await serverFor(process.argv.slice(2), process.env);
    await server.connect(new StdioServerTransport());
  }
} catch (error) {
  const message =
    error instanceof ApiError
      ? `Nodrail refused the token (${error.message}).`
      : (error as Error).message;
  process.stderr.write(`nodrail-mcp: ${message}\n`);
  process.exitCode = 1;
}
