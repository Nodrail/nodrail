import { environmentQuery } from "@/contracts/v1/public-api";
import { agentAccessBody } from "@/contracts/v1/management";
import { parseInput } from "@/server/db/context";
import { pauseAgent, resumeAgent } from "@/server/modules/agents";
import { publicRoute } from "@/server/public-api/route";

export const PATCH = publicRoute<{ key: string }>(
  { scope: "agents:manage", access: "write", query: environmentQuery },
  (context, call) => {
    const { status } = parseInput(agentAccessBody, call.body);
    const change = status === "paused" ? pauseAgent : resumeAgent;
    return change(context, call.params.key);
  },
);
