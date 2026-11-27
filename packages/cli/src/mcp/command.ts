import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiError } from "../api.ts";
import { VERSION } from "../version.ts";
import { HELP, readFlags, serverFor } from "./main.ts";

/**
 * `nodrail mcp`: serves MCP over stdio until the client disconnects. stdout
 * carries the protocol, so everything for people goes to stderr.
 */
export async function mcp(argv: string[]): Promise<number> {
  try {
    const flags = readFlags(argv);
    if (flags.version) process.stderr.write(`${VERSION}\n`);
    else if (flags.help) process.stderr.write(`${HELP}\n`);
    else {
      const server = await serverFor(argv, process.env);
      await server.connect(new StdioServerTransport());
    }
    return 0;
  } catch (error) {
    const message =
      error instanceof ApiError
        ? `Nodrail refused the token (${error.message}).`
        : (error as Error).message;
    process.stderr.write(`nodrail mcp: ${message}\n`);
    return 1;
  }
}
