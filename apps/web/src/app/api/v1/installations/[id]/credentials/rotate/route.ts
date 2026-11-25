import { rotateCredential } from "@/server/modules/agents";
import { idAction } from "@/server/public-api/route";

export const POST = idAction("agents:manage", rotateCredential);
