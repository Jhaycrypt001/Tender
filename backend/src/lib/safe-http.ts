import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";

/**
 * Outbound HTTP to merchant-supplied URLs (webhooks), without SSRF.
 *
 * A webhook URL is attacker-controlled input: pointed at 127.0.0.1, the cloud
 * metadata service (169.254.169.254) or a private network, our worker would
 * make requests on the attacker's behalf from inside our network.
 *
 * Checking the URL when it is saved is not enough — a hostname that resolved
 * to a public address then can resolve to a private one later (DNS
 * rebinding). So the check runs INSIDE the connection: every address DNS
 * returns is validated at connect time, on every request, and the socket
 * connects only to an address that passed.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64: can embed a private v4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
  ["2001:db8::", 32], // documentation
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** True only for a globally routable unicast address. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) is judged as the IPv4 address it carries.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !blocked.check(address, "ipv6");
  }
  return false;
}

export class UnsafeDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDestinationError";
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `dns.lookup` replacement for the socket layer. Resolves every address and
 * refuses the connection if ANY is non-public — so a hostname cannot mix one
 * public and one private record and hope the private one gets picked.
 */
function safeLookup(hostname: string, options: object, callback: LookupCallback) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || list.length === 0) {
      return callback(new UnsafeDestinationError(`refusing to connect to non-public address for ${hostname}`), []);
    }
    const wantsAll = (options as { all?: boolean }).all;
    if (wantsAll) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

/** HTTP dispatcher that can only reach public addresses. Use for every merchant-supplied URL. */
export const publicOnlyDispatcher = new Agent({
  connect: { lookup: safeLookup as never, timeout: 5_000 },
  headersTimeout: 10_000,
  bodyTimeout: 10_000,
});

/**
 * Validates a webhook URL when a merchant saves it, for a clear error at the
 * time. (Connect-time checking above is what actually enforces safety.)
 */
export async function assertSafeWebhookUrl(raw: string, opts: { allowPrivate?: boolean } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeDestinationError("webhook_url is not a valid URL");
  }
  if (url.protocol !== "https:") throw new UnsafeDestinationError("webhook_url must use https");
  if (url.username || url.password) throw new UnsafeDestinationError("webhook_url must not contain credentials");
  if (opts.allowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new UnsafeDestinationError("webhook_url points at a non-public address");
    return url;
  }
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) =>
    dnsLookup(host, { all: true }, (err, list) => (err ? reject(err) : resolve(list))),
  ).catch(() => {
    throw new UnsafeDestinationError(`webhook_url host ${host} does not resolve`);
  });
  if (addresses.some((a) => !isPublicAddress(a.address))) {
    throw new UnsafeDestinationError("webhook_url resolves to a non-public address");
  }
  return url;
}
