import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { NodrailApi } from "@nodrail/cli/api";
import { heldBackToken, resolveToken, resolveUrl } from "@nodrail/cli";
import { createServer, VERSION } from "./server.ts";

export const HELP = `nodrail-mcp — Nodrail for MCP clients, over stdio

Reads Activity, runs, Insights and rules with a personal token
(NODRAIL_TOKEN, else the one saved by \`nodrail login\`). NODRAIL_URL or --url
for self-hosting; --environment <slug> for an environment other than the
workspace's default.

  --allow-publish     Offer publish_rules, if the token can publish rules
  --client-confirms   Publish even when the client can't ask the
                      person through MCP; its own per-call prompt must be on

Never give a token that can publish to an agent Nodrail governs: it could
rewrite the rules that hold it.`;

type Env = Record<string, string | undefined>;

export function readFlags(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "allow-publish": { type: "boolean" },
      "client-confirms": { type: "boolean" },
      environment: { type: "string" },
      url: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    strict: true,
  });
  return values;
}

/** Builds the server for this command line, or explains why it can't. */
export async function serverFor(
  argv: string[],
  env: Env,
  options: { home?: string; fetch?: typeof fetch } = {},
) {
  const flags = readFlags(argv);
  const url = resolveUrl(env, flags.url);
  const token = await resolveToken(env, options.home ?? homedir(), url);
  if (!token)
    throw new Error(
      `No Nodrail token. Set NODRAIL_TOKEN to a personal token (ndp_…), or run \`nodrail login\`.${heldBackToken(env, url)}`,
    );
  const api = new NodrailApi({
    token,
    url,
    environment: flags.environment,
    fetch: options.fetch,
  });
  const me = await api.me();
  return createServer({
    api,
    me,
    allowPublish: flags["allow-publish"],
    clientConfirms: flags["client-confirms"],
  });
}

export { VERSION };
