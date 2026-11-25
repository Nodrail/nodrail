import "server-only";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { isLoopbackHost } from "@/server/loopback";

export function clientSource(request: Pick<Headers, "get">) {
  // Vercel overwrites this header at its edge. A self-hosted proxy must
  // overwrite its configured header and be the only path to the app.
  const header =
    process.env.VERCEL === "1"
      ? "x-vercel-forwarded-for"
      : process.env.AUTH_CLIENT_IP_HEADER;
  if (!header) {
    const origin = process.env.APP_ORIGIN;
    return origin && isLoopbackHost(new URL(origin).hostname) ? "local" : null;
  }
  const value = request.get(header)?.trim() ?? "";
  if (isIP(value) === 4) return value;
  if (value.includes("%") || isIP(value) !== 6) return null;

  const canonical = new URL(`http://[${value}]`).hostname.slice(1, -1);
  // IPv4-mapped IPv6 must use the same bucket as plain IPv4.
  if (canonical.startsWith("::ffff:")) {
    return canonical
      .slice(7)
      .split(":")
      .flatMap((word) => [parseInt(word, 16) >> 8, parseInt(word, 16) & 255])
      .join(".");
  }
  const [left, right] = canonical.split("::");
  const first = left ? left.split(":") : [];
  const last = right ? right.split(":") : [];
  const words =
    right === undefined
      ? first
      : [
          ...first,
          ...Array<string>(8 - first.length - last.length).fill("0"),
          ...last,
        ];
  // A client rotating addresses inside its IPv6 /64 still has one budget.
  return `${words.slice(0, 4).join(":")}::/64`;
}

export async function loginSource() {
  return clientSource(await headers());
}
