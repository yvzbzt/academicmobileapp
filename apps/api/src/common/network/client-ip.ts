import { isIP } from "node:net";

export interface ClientIpRequest {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

export function resolveClientIp(
  request: ClientIpRequest,
  trustedProxyCidrs = readTrustedProxyCidrs()
): string {
  const remoteAddress = normalizeIp(request.socket?.remoteAddress);
  if (!remoteAddress || !trustedProxyCidrs.some((cidr) => ipMatchesCidr(remoteAddress, cidr))) {
    return remoteAddress ?? "unknown";
  }

  const forwarded = firstHeaderValue(request.headers?.["x-forwarded-for"]);
  if (!forwarded) return remoteAddress;
  const forwardedChain = forwarded
    .split(",")
    .map((entry) => normalizeIp(entry.trim()))
    .filter((entry): entry is string => Boolean(entry));

  // The checked-in deployment has exactly one trusted Caddy hop. Caddy's
  // immediate peer is therefore the right-most forwarded address. Any
  // attacker-supplied values farther left are deliberately ignored.
  return forwardedChain.at(-1) ?? remoteAddress;
}

export function readTrustedProxyCidrs(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.TRUSTED_PROXY_CIDRS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter(isValidCidr);
}

export function invalidTrustedProxyCidrs(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !isValidCidr(entry));
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withoutMappedPrefix = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  return isIP(withoutMappedPrefix) ? withoutMappedPrefix : undefined;
}

function isValidCidr(value: string): boolean {
  const [address, prefixText, ...extra] = value.split("/");
  if (!address || !prefixText || extra.length > 0) return false;
  const family = isIP(address);
  const prefix = Number(prefixText);
  return family === 4
    ? Number.isInteger(prefix) && prefix >= 0 && prefix <= 32
    : family === 6 && Number.isInteger(prefix) && prefix >= 0 && prefix <= 128;
}

function ipMatchesCidr(address: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split("/");
  if (!network || !prefixText || isIP(address) !== isIP(network)) return false;
  const prefix = Number(prefixText);
  if (isIP(address) === 4) {
    const addressNumber = ipv4ToNumber(address);
    const networkNumber = ipv4ToNumber(network);
    if (addressNumber === undefined || networkNumber === undefined) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (addressNumber & mask) === (networkNumber & mask);
  }
  return prefix === 128 && address.toLowerCase() === network.toLowerCase();
}

function ipv4ToNumber(address: string): number | undefined {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}
