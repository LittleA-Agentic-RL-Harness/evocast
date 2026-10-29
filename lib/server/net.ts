import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { LLMError } from "../llm/error";

/** Private, loopback, link-local, shared, documentation, multicast and other special-purpose ranges.
 *  IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are checked against the IPv4 rules by BlockList itself. */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  BLOCKED.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  BLOCKED.addSubnet(net, prefix, "ipv6");

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  return family !== 0 && !BLOCKED.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Where a host name really points: every address it resolves to must be public, so a public
 * name aimed at an internal address is refused before anything is fetched. Production only
 * forces https, so TLS hostname checks cover the gap between this lookup and the fetch's own.
 * Skipped in development and in the Mac app, whose server is the visitor's own machine (and
 * whose proxies often answer every name with a 198.18.x.x "fake IP").
 */
export async function assertPublicAddress(hostname: string): Promise<void> {
  if (process.env.NODE_ENV !== "production" || process.env.EVOCAST_DESKTOP) return;
  const host = hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    throw new LLMError(`Couldn't find ${host}.`, 400);
  }
  if (!addresses.length || !addresses.every(isPublicAddress)) throw new LLMError("Private or local addresses are not allowed.", 400);
}
