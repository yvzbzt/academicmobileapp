import { isIP } from "node:net";

export interface ClientIpRequest {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

export function resolveClientIp(
  request: ClientIpRequest,
  trustedProxyCidrs = readTrustedProxyCidrs()
): string {
  const socketAddress = request.socket?.remoteAddress;
  const remoteAddress = normalizeIp(socketAddress);
  const trustedPeer = remoteAddress && trustedProxyCidrs.some((cidr) =>
    ipMatchesCidr(remoteAddress, cidr)
    || (socketAddress !== remoteAddress && Boolean(socketAddress && ipMatchesCidr(socketAddress, cidr)))
  );
  if (!trustedPeer) {
    return remoteAddress ?? "unknown";
  }

  const forwarded = firstHeaderValue(request.headers?.["x-forwarded-for"]);
  if (!forwarded) return remoteAddress;
  const forwardedChain = forwarded
    .split(",")
    .map((entry) => normalizeIp(entry.trim()));

  if (forwardedChain.some((entry) => !entry)) return remoteAddress;

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
  return Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
}

function normalizeIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return undefined;

  const bytes = ipv6ToBytes(value);
  if (!bytes) return undefined;
  const isIpv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0)
    && bytes[10] === 0xff
    && bytes[11] === 0xff;
  return isIpv4Mapped ? Array.from(bytes.slice(12)).join(".") : value;
}

function isValidCidr(value: string): boolean {
  const [address, prefixText, ...extra] = value.split("/");
  if (!address || !prefixText || extra.length > 0) return false;
  const family = isIP(address);
  const prefix = Number(prefixText);
  return family === 4
    ? Number.isInteger(prefix) && prefix >= 0 && prefix <= 32
    : family === 6
      && ipv6ToBytes(address) !== undefined
      && Number.isInteger(prefix)
      && prefix >= 0
      && prefix <= 128;
}

function ipMatchesCidr(address: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split("/");
  if (!network || !prefixText || !isValidCidr(cidr) || isIP(address) !== isIP(network)) return false;
  const prefix = Number(prefixText);
  if (isIP(address) === 4) {
    const addressNumber = ipv4ToNumber(address);
    const networkNumber = ipv4ToNumber(network);
    if (addressNumber === undefined || networkNumber === undefined) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (addressNumber & mask) === (networkNumber & mask);
  }

  const addressBytes = ipv6ToBytes(address);
  const networkBytes = ipv6ToBytes(network);
  if (!addressBytes || !networkBytes) return false;
  return bytesMatchPrefix(addressBytes, networkBytes, prefix);
}

function ipv4ToNumber(address: string): number | undefined {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function ipv6ToBytes(address: string): Uint8Array | undefined {
  if (isIP(address) !== 6 || address.includes("%")) return undefined;

  let normalizedAddress = address;
  const lastColon = normalizedAddress.lastIndexOf(":");
  const ipv4Tail = normalizedAddress.slice(lastColon + 1);
  if (ipv4Tail.includes(".")) {
    const ipv4Number = ipv4ToNumber(ipv4Tail);
    if (ipv4Number === undefined) return undefined;
    normalizedAddress = `${normalizedAddress.slice(0, lastColon + 1)}${(ipv4Number >>> 16).toString(16)}:${(ipv4Number & 0xffff).toString(16)}`;
  }

  const compressionIndex = normalizedAddress.indexOf("::");
  if (compressionIndex !== normalizedAddress.lastIndexOf("::")) return undefined;

  const leftText = compressionIndex >= 0 ? normalizedAddress.slice(0, compressionIndex) : normalizedAddress;
  const rightText = compressionIndex >= 0 ? normalizedAddress.slice(compressionIndex + 2) : "";
  const leftGroups = leftText ? leftText.split(":") : [];
  const rightGroups = rightText ? rightText.split(":") : [];
  const missingGroups = 8 - leftGroups.length - rightGroups.length;
  if ((compressionIndex >= 0 && missingGroups < 1) || (compressionIndex < 0 && missingGroups !== 0)) {
    return undefined;
  }

  const groups = compressionIndex >= 0
    ? [...leftGroups, ...Array.from({ length: missingGroups }, () => "0"), ...rightGroups]
    : leftGroups;
  if (groups.length !== 8) return undefined;

  const bytes = new Uint8Array(16);
  for (const [index, group] of groups.entries()) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >>> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function bytesMatchPrefix(address: Uint8Array, network: Uint8Array, prefix: number): boolean {
  const wholeBytes = Math.floor(prefix / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (address[index] !== network[index]) return false;
  }

  const remainingBits = prefix % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (address[wholeBytes]! & mask) === (network[wholeBytes]! & mask);
}
