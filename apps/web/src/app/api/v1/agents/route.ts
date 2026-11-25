import { environmentQuery } from "@/contracts/v1/public-api";
import { agentListQuery, connectAgentBody } from "@/contracts/v1/management";
import { parseInput } from "@/server/db/context";
import { connectAgent, listAgents } from "@/server/modules/agents";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: agentListQuery },
  (context, call) => listAgents(context, call.environment, call.query.cursor),
);

export const POST = publicRoute(
  { scope: "agents:manage", access: "write", query: environmentQuery },
  (context, call) => {
    const body = parseInput(connectAgentBody, call.body);
    return connectAgent(context, {
      agentKey: body.agent_key,
      adapterKey: body.adapter_key,
      description: body.description ?? "",
      environmentSlug: call.environment,
    });
  },
);
