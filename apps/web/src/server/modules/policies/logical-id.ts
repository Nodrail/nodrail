import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * A rule's identity comes from the file. Exported rules carry their real id; a
 * readable id always maps to the same rule, so applying a file twice changes nothing.
 */
export function logicalIdFor(environmentId: string, id: string) {
  if (z.uuid().safeParse(id).success) return id;
  const hex = createHash("sha256")
    .update(`${environmentId}\n${id}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
