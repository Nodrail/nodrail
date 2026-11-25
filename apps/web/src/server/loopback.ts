/** Hostname from a URL, which canonicalizes IP literals. */
export function isLoopbackHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    (hostname.startsWith("127.") && /^127(?:\.\d{1,3}){3}$/.test(hostname))
  );
}
