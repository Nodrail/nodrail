import { main } from "./cli.ts";
import { terminal } from "./terminal.ts";

const argv = process.argv.slice(2);
// `nodrail mcp` speaks MCP on stdout, so it bypasses the terminal output and
// loads the MCP SDK only when asked for.
process.exitCode =
  argv[0] === "mcp"
    ? await import("./mcp/command.ts").then(({ mcp }) => mcp(argv.slice(1)))
    : await main(argv, terminal());
