import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingHttpHeaders, type OutgoingHttpHeaders } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";

export interface ResolvedOutboundAddress {
  address: string;
  family: 4 | 6;
}

export interface SafeOutboundHopResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  remoteAddress: string;
}

export interface SafeOutboundResponse extends SafeOutboundHopResponse {
  finalUrl: string;
}

export interface SafeOutboundRequestOptions {
  timeoutMs: number;
  headers?: OutgoingHttpHeaders;
  maximumRedirects?: number;
  maximumResponseBytes?: number;
  allowInvalidTls?: boolean;
  validateUrl?: (candidate: string, previousUrl?: string) => string;
}

export interface SafeOutboundRequestDependencies {
  resolveHostname?: (hostname: string) => Promise<readonly ResolvedOutboundAddress[]>;
  requestHop?: (
    url: string,
    pinnedAddress: ResolvedOutboundAddress,
    input: {
      timeoutMs: number;
      headers: OutgoingHttpHeaders;
      maximumResponseBytes: number;
      allowInvalidTls: boolean;
    }
  ) => Promise<SafeOutboundHopResponse>;
}

const DEFAULT_MAXIMUM_REDIRECTS = 5;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 5 * 1024 * 1024;

let testDependencies: SafeOutboundRequestDependencies | undefined;

/** Test-only deterministic transport injection; production callers cannot enable it. */
export function setSafeOutboundRequestDependenciesForTesting(
  dependencies: SafeOutboundRequestDependencies | undefined
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("OUTBOUND_TEST_DEPENDENCIES_FORBIDDEN");
  }
  testDependencies = dependencies;
}

export async function safeOutboundRequest(
  sourceUrl: string,
  options: SafeOutboundRequestOptions,
  dependencies?: SafeOutboundRequestDependencies
): Promise<SafeOutboundResponse> {
  const timeoutMs = requirePositiveInteger(options.timeoutMs, "OUTBOUND_TIMEOUT_INVALID");
  const maximumRedirects = requireNonNegativeInteger(
    options.maximumRedirects ?? DEFAULT_MAXIMUM_REDIRECTS,
    "OUTBOUND_REDIRECT_LIMIT_INVALID"
  );
  const maximumResponseBytes = requirePositiveInteger(
    options.maximumResponseBytes ?? DEFAULT_MAXIMUM_RESPONSE_BYTES,
    "OUTBOUND_RESPONSE_LIMIT_INVALID"
  );
  const allowInvalidTls = resolveInvalidTlsPolicy(options.allowInvalidTls === true);
  const effectiveDependencies = dependencies ?? testDependencies ?? {};
  const resolveHostname = effectiveDependencies.resolveHostname ?? resolveHostnameWithSystemDns;
  const requestHop = effectiveDependencies.requestHop ?? requestPinnedHop;
  const deadline = Date.now() + timeoutMs;

  let currentUrl = validateOutboundUrl(sourceUrl, undefined, options.validateUrl);
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const remainingMs = Math.max(0, deadline - Date.now());
    if (remainingMs <= 0) throw new Error("OUTBOUND_REQUEST_TIMEOUT");
    const url = new URL(currentUrl);
    const addresses = await withTimeout(
      resolveSafeOutboundAddresses(url.hostname, resolveHostname),
      remainingMs,
      "OUTBOUND_REQUEST_TIMEOUT"
    );
    const response = await requestResolvedHop(currentUrl, addresses, {
      deadline,
      headers: options.headers ?? {},
      maximumResponseBytes,
      allowInvalidTls
    }, requestHop);

    const location = firstHeaderValue(response.headers.location);
    if (response.status >= 300 && response.status < 400) {
      if (!location) throw new Error("OUTBOUND_REDIRECT_LOCATION_MISSING");
      if (redirectCount >= maximumRedirects) throw new Error("OUTBOUND_REDIRECT_LIMIT");
      currentUrl = validateOutboundUrl(location, currentUrl, options.validateUrl);
      continue;
    }

    return { ...response, finalUrl: currentUrl };
  }

  throw new Error("OUTBOUND_REDIRECT_LIMIT");
}

export function requirePublicHttpUrl(candidate: string, baseUrl?: string): string {
  let url: URL;
  try {
    url = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
  } catch {
    throw new Error("OUTBOUND_URL_INVALID");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OUTBOUND_URL_PROTOCOL_FORBIDDEN");
  }
  if (url.username || url.password) throw new Error("OUTBOUND_URL_CREDENTIALS_FORBIDDEN");
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new Error("OUTBOUND_URL_PORT_FORBIDDEN");
  }

  const hostname = stripAddressBrackets(url.hostname).toLocaleLowerCase("en-US").replace(/\.$/u, "");
  if (isForbiddenHostname(hostname)) throw new Error("OUTBOUND_HOSTNAME_FORBIDDEN");
  if (isIP(hostname) !== 0 && isForbiddenIpAddress(hostname)) {
    throw new Error("OUTBOUND_DESTINATION_FORBIDDEN");
  }
  url.hostname = hostname;
  return url.toString();
}

export async function resolveSafeOutboundAddresses(
  hostnameInput: string,
  resolveHostname: (hostname: string) => Promise<readonly ResolvedOutboundAddress[]> = resolveHostnameWithSystemDns
): Promise<ResolvedOutboundAddress[]> {
  const hostname = stripAddressBrackets(hostnameInput).toLocaleLowerCase("en-US").replace(/\.$/u, "");
  if (isForbiddenHostname(hostname)) throw new Error("OUTBOUND_HOSTNAME_FORBIDDEN");

  const literalFamily = isIP(hostname);
  const resolved = literalFamily === 4 || literalFamily === 6
    ? [{ address: hostname, family: literalFamily } as ResolvedOutboundAddress]
    : await resolveHostname(hostname).catch(() => {
      throw new Error("OUTBOUND_DNS_LOOKUP_FAILED");
    });
  if (resolved.length === 0) throw new Error("OUTBOUND_DNS_NO_ADDRESS");

  const unique = new Map<string, ResolvedOutboundAddress>();
  for (const candidate of resolved) {
    const family = isIP(stripAddressZone(candidate.address));
    if (family !== candidate.family || (family !== 4 && family !== 6)) {
      throw new Error("OUTBOUND_DNS_ADDRESS_INVALID");
    }
    if (isForbiddenIpAddress(candidate.address)) {
      // A mixed public/private DNS answer is rejected rather than selecting the
      // public member and leaving a rebinding window for another connection.
      throw new Error("OUTBOUND_DESTINATION_FORBIDDEN");
    }
    unique.set(normalizeIpAddress(candidate.address), {
      address: stripAddressZone(candidate.address),
      family
    });
  }
  return [...unique.values()];
}

export function assertPinnedRemoteAddress(
  pinnedAddress: ResolvedOutboundAddress,
  remoteAddress: string | undefined
): void {
  if (!remoteAddress || isForbiddenIpAddress(remoteAddress)) {
    throw new Error("OUTBOUND_CONNECTED_ADDRESS_FORBIDDEN");
  }
  if (normalizeIpAddress(pinnedAddress.address) !== normalizeIpAddress(remoteAddress)) {
    throw new Error("OUTBOUND_CONNECTED_ADDRESS_MISMATCH");
  }
}

export function isForbiddenIpAddress(addressInput: string): boolean {
  const address = stripAddressZone(stripAddressBrackets(addressInput));
  const ipv4 = parseIpv4(address);
  if (ipv4 !== null) return isForbiddenIpv4(ipv4);

  const ipv6 = parseIpv6(address);
  if (ipv6 === null) return true;
  const mappedIpv4 = ipv4FromMappedIpv6(ipv6);
  if (mappedIpv4 !== null) return isForbiddenIpv4(mappedIpv4);

  // Public IPv6 unicast is allocated from 2000::/3. Reject special-purpose
  // ranges inside it as well as every non-global range outside it.
  if (!isInCidr(ipv6, parseIpv6("2000::")!, 3, 128)) return true;
  return [
    ["2001::", 32],
    ["2001:2::", 48],
    ["2001:10::", 28],
    ["2001:20::", 28],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20]
  ].some(([base, prefix]) => isInCidr(ipv6, parseIpv6(String(base))!, Number(prefix), 128));
}

export function resolveInvalidTlsPolicy(requested: boolean, environment = process.env.NODE_ENV): boolean {
  if (!requested) return false;
  if (environment !== "development") {
    throw new Error("OUTBOUND_INVALID_TLS_DEVELOPMENT_ONLY");
  }
  return true;
}

async function requestResolvedHop(
  url: string,
  addresses: readonly ResolvedOutboundAddress[],
  input: {
    deadline: number;
    headers: OutgoingHttpHeaders;
    maximumResponseBytes: number;
    allowInvalidTls: boolean;
  },
  requestHop: NonNullable<SafeOutboundRequestDependencies["requestHop"]>
): Promise<SafeOutboundHopResponse> {
  let lastError: unknown;
  for (const address of addresses) {
    try {
      const timeoutMs = Math.max(0, input.deadline - Date.now());
      if (timeoutMs <= 0) throw new Error("OUTBOUND_REQUEST_TIMEOUT");
      const response = await requestHop(url, address, { ...input, timeoutMs });
      assertPinnedRemoteAddress(address, response.remoteAddress);
      return response;
    } catch (error) {
      if (error instanceof Error && /^(?:OUTBOUND_CONNECTED_ADDRESS_|OUTBOUND_DESTINATION_)/u.test(error.message)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError ?? new Error("OUTBOUND_CONNECTION_FAILED");
}

async function resolveHostnameWithSystemDns(hostname: string): Promise<ResolvedOutboundAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((candidate): ResolvedOutboundAddress[] => (
    candidate.family === 4 || candidate.family === 6
      ? [{ address: candidate.address, family: candidate.family }]
      : []
  ));
}

function requestPinnedHop(
  urlString: string,
  pinnedAddress: ResolvedOutboundAddress,
  input: {
    timeoutMs: number;
    headers: OutgoingHttpHeaders;
    maximumResponseBytes: number;
    allowInvalidTls: boolean;
  }
): Promise<SafeOutboundHopResponse> {
  const url = new URL(urlString);
  const client = url.protocol === "https:" ? https : http;
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
    else callback(null, pinnedAddress.address, pinnedAddress.family);
  };

  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      agent: false,
      method: "GET",
      headers: input.headers,
      lookup,
      ...(url.protocol === "https:"
        ? { rejectUnauthorized: !input.allowInvalidTls, servername: stripAddressBrackets(url.hostname) }
        : {})
    }, (response) => {
      let remoteAddress: string;
      try {
        remoteAddress = response.socket.remoteAddress ?? "";
        assertPinnedRemoteAddress(pinnedAddress, remoteAddress);
      } catch (error) {
        response.destroy();
        reject(error);
        return;
      }

      const declaredLength = Number(response.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > input.maximumResponseBytes) {
        response.destroy();
        reject(new Error("OUTBOUND_RESPONSE_TOO_LARGE"));
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > input.maximumResponseBytes) {
          response.destroy(new Error("OUTBOUND_RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
          remoteAddress
        });
      });
      response.on("error", reject);
    });

    request.setTimeout(input.timeoutMs, () => request.destroy(new Error("OUTBOUND_REQUEST_TIMEOUT")));
    const absoluteTimeout = setTimeout(
      () => request.destroy(new Error("OUTBOUND_REQUEST_TIMEOUT")),
      input.timeoutMs
    );
    request.once("close", () => clearTimeout(absoluteTimeout));
    request.on("error", reject);
    request.end();
  });
}

function validateOutboundUrl(
  candidate: string,
  previousUrl: string | undefined,
  validateUrl: SafeOutboundRequestOptions["validateUrl"]
): string {
  const absolute = requirePublicHttpUrl(candidate, previousUrl);
  const policyValidated = validateUrl ? validateUrl(absolute, previousUrl) : absolute;
  return requirePublicHttpUrl(policyValidated, previousUrl);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isForbiddenHostname(hostname: string): boolean {
  return !hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".lan");
}

function isForbiddenIpv4(value: bigint): boolean {
  return [
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
    ["240.0.0.0", 4]
  ].some(([base, prefix]) => isInCidr(value, parseIpv4(String(base))!, Number(prefix), 32));
}

function ipv4FromMappedIpv6(value: bigint): bigint | null {
  return value >> 32n === 0xffffn ? value & 0xffffffffn : null;
}

function parseIpv4(address: string): bigint | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet, index) => (
    !Number.isInteger(octet)
    || octet < 0
    || octet > 255
    || String(octet) !== parts[index]
  ))) return null;
  return octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

function parseIpv6(addressInput: string): bigint | null {
  let address = addressInput.toLocaleLowerCase("en-US");
  if (address.includes(".")) {
    const finalColon = address.lastIndexOf(":");
    const ipv4 = parseIpv4(address.slice(finalColon + 1));
    if (finalColon < 0 || ipv4 === null) return null;
    address = `${address.slice(0, finalColon)}:${(ipv4 >> 16n).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`;
  }
  if ((address.match(/::/gu)?.length ?? 0) > 1) return null;
  const [leftPart, rightPart] = address.split("::");
  const left = leftPart ? leftPart.split(":") : [];
  const right = rightPart ? rightPart.split(":") : [];
  if (left.some((part) => !/^[\da-f]{1,4}$/u.test(part)) || right.some((part) => !/^[\da-f]{1,4}$/u.test(part))) return null;
  const hasCompression = address.includes("::");
  const missing = 8 - left.length - right.length;
  if ((!hasCompression && missing !== 0) || (hasCompression && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function normalizeIpAddress(addressInput: string): string {
  const address = stripAddressZone(stripAddressBrackets(addressInput));
  const ipv4 = parseIpv4(address);
  if (ipv4 !== null) return `4:${ipv4.toString(16)}`;
  const ipv6 = parseIpv6(address);
  if (ipv6 === null) throw new Error("OUTBOUND_IP_ADDRESS_INVALID");
  const mappedIpv4 = ipv4FromMappedIpv6(ipv6);
  return mappedIpv4 === null ? `6:${ipv6.toString(16)}` : `4:${mappedIpv4.toString(16)}`;
}

function isInCidr(value: bigint, base: bigint, prefix: number, width: number): boolean {
  const shift = BigInt(width - prefix);
  return value >> shift === base >> shift;
}

function stripAddressBrackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function stripAddressZone(value: string): string {
  return value.split("%", 1)[0] ?? value;
}

function requirePositiveInteger(value: number, code: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function requireNonNegativeInteger(value: number, code: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(code);
  return value;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(code)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
