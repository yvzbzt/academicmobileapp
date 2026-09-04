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

export type SafeOutboundHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
export type SafeOutboundProviderPolicy =
  | "public"
  | "apple-jwks"
  | "google-oauth-tokeninfo"
  | "google-document-ai"
  | "google-metadata-token"
  | "yok-atlas";

export interface SafeOutboundRequestOptions {
  timeoutMs: number;
  method?: SafeOutboundHttpMethod;
  headers?: OutgoingHttpHeaders;
  body?: string | Buffer | Uint8Array;
  maximumRedirects?: number;
  maximumRequestBytes?: number;
  maximumResponseBytes?: number;
  providerPolicy?: SafeOutboundProviderPolicy;
  validateUrl?: (candidate: string, previousUrl?: string) => string;
}

export interface SafeOutboundRequestDependencies {
  resolveHostname?: (hostname: string) => Promise<readonly ResolvedOutboundAddress[]>;
  requestHop?: (
    url: string,
    pinnedAddress: ResolvedOutboundAddress,
    input: {
      timeoutMs: number;
      method: SafeOutboundHttpMethod;
      headers: OutgoingHttpHeaders;
      body?: Buffer;
      maximumResponseBytes: number;
      providerPolicy: SafeOutboundProviderPolicy;
    }
  ) => Promise<SafeOutboundHopResponse>;
}

const DEFAULT_MAXIMUM_REDIRECTS = 5;
const DEFAULT_MAXIMUM_REQUEST_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 5 * 1024 * 1024;
const GOOGLE_METADATA_ADDRESS = "169.254.169.254";
export const GOOGLE_METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
export const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
export const YOK_ATLAS_SEARCH_URL = "https://yokatlas.yok.gov.tr/api/tercih-kilavuz/search";

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
  if (dependencies && process.env.NODE_ENV !== "test") {
    throw new Error("OUTBOUND_TEST_DEPENDENCIES_FORBIDDEN");
  }
  const method = options.method ?? "GET";
  const providerPolicy = options.providerPolicy ?? "public";
  const timeoutMs = requirePositiveInteger(options.timeoutMs, "OUTBOUND_TIMEOUT_INVALID");
  const maximumRedirects = requireNonNegativeInteger(
    options.maximumRedirects ?? defaultRedirectLimit(providerPolicy),
    "OUTBOUND_REDIRECT_LIMIT_INVALID"
  );
  const maximumRequestBytes = requirePositiveInteger(
    options.maximumRequestBytes ?? DEFAULT_MAXIMUM_REQUEST_BYTES,
    "OUTBOUND_REQUEST_LIMIT_INVALID"
  );
  const maximumResponseBytes = requirePositiveInteger(
    options.maximumResponseBytes ?? DEFAULT_MAXIMUM_RESPONSE_BYTES,
    "OUTBOUND_RESPONSE_LIMIT_INVALID"
  );
  const headers = sanitizeOutboundHeaders(options.headers ?? {});
  const body = normalizeRequestBody(options.body, maximumRequestBytes);
  validateRequestPolicy({
    method,
    headers,
    body,
    maximumRedirects,
    maximumRequestBytes,
    maximumResponseBytes,
    providerPolicy,
    timeoutMs
  });
  const effectiveDependencies = dependencies ?? testDependencies ?? {};
  const resolveHostname = effectiveDependencies.resolveHostname ?? resolveHostnameWithSystemDns;
  const requestHop = effectiveDependencies.requestHop ?? requestPinnedHop;
  const deadline = Date.now() + timeoutMs;

  let currentUrl = validateOutboundUrl(sourceUrl, undefined, options.validateUrl, providerPolicy);
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const remainingMs = Math.max(0, deadline - Date.now());
    if (remainingMs <= 0) throw new Error("OUTBOUND_REQUEST_TIMEOUT");
    const url = new URL(currentUrl);
    const addresses = await withTimeout(
      resolveOutboundAddressesForPolicy(url.hostname, providerPolicy, resolveHostname),
      remainingMs,
      "OUTBOUND_REQUEST_TIMEOUT"
    );
    const response = await requestResolvedHop(currentUrl, addresses, {
      deadline,
      method,
      headers,
      ...(body ? { body } : {}),
      maximumResponseBytes,
      providerPolicy
    }, requestHop);

    const location = firstHeaderValue(response.headers.location);
    // 304 is a terminal conditional-GET result, not a redirect. Treating it as
    // a redirect would incorrectly require a Location header and turn an
    // unchanged trusted source into a fetch failure.
    if (response.status === 304) {
      return { ...response, finalUrl: currentUrl };
    }
    if (response.status >= 300 && response.status < 400) {
      if (!location) throw new Error("OUTBOUND_REDIRECT_LOCATION_MISSING");
      const redirectUrl = validateOutboundUrl(location, currentUrl, options.validateUrl, providerPolicy);
      assertRedirectHeadersSafe(currentUrl, redirectUrl, headers);
      if (redirectCount >= maximumRedirects) throw new Error("OUTBOUND_REDIRECT_LIMIT");
      if (method !== "GET" && method !== "HEAD") throw new Error("OUTBOUND_REDIRECT_METHOD_FORBIDDEN");
      currentUrl = redirectUrl;
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

function defaultRedirectLimit(providerPolicy: SafeOutboundProviderPolicy): number {
  return providerPolicy === "public" ? DEFAULT_MAXIMUM_REDIRECTS : 0;
}

function normalizeRequestBody(
  body: SafeOutboundRequestOptions["body"],
  maximumRequestBytes: number
): Buffer | undefined {
  if (body === undefined) return undefined;
  const normalized = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  if (normalized.length > maximumRequestBytes) throw new Error("OUTBOUND_REQUEST_TOO_LARGE");
  return normalized;
}

function sanitizeOutboundHeaders(headers: OutgoingHttpHeaders): OutgoingHttpHeaders {
  const sanitized: OutgoingHttpHeaders = {};
  const forbidden = new Set([
    "connection",
    "content-length",
    "host",
    "proxy-authorization",
    "proxy-connection",
    "transfer-encoding",
    "upgrade"
  ]);
  const seen = new Set<string>();
  for (const [name, rawValue] of Object.entries(headers)) {
    const normalizedName = name.trim().toLocaleLowerCase("en-US");
    if (!normalizedName || forbidden.has(normalizedName)) throw new Error("OUTBOUND_HEADER_FORBIDDEN");
    if (seen.has(normalizedName)) throw new Error("OUTBOUND_HEADER_DUPLICATE");
    seen.add(normalizedName);
    if (rawValue === undefined) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    if (values.some((value) => (
      (typeof value !== "string" && typeof value !== "number")
      || (typeof value === "number" && !Number.isFinite(value))
      || /[\r\n]/u.test(String(value))
    ))) {
      throw new Error("OUTBOUND_HEADER_INVALID");
    }
    sanitized[name] = rawValue;
  }
  return sanitized;
}

function validateRequestPolicy(input: {
  method: SafeOutboundHttpMethod;
  headers: OutgoingHttpHeaders;
  body: Buffer | undefined;
  maximumRedirects: number;
  maximumRequestBytes: number;
  maximumResponseBytes: number;
  providerPolicy: SafeOutboundProviderPolicy;
  timeoutMs: number;
}): void {
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(input.method)) {
    throw new Error("OUTBOUND_METHOD_FORBIDDEN");
  }
  if ((input.method === "GET" || input.method === "HEAD") && input.body) {
    throw new Error("OUTBOUND_REQUEST_BODY_FORBIDDEN");
  }

  switch (input.providerPolicy) {
    case "public":
      return;
    case "apple-jwks":
      requireProviderRequest(input, {
        method: "GET",
        maximumRedirects: 0,
        maximumResponseBytes: 512 * 1024,
        timeoutMs: 10_000
      });
      if (input.body) throw new Error("OUTBOUND_PROVIDER_BODY_FORBIDDEN");
      return;
    case "google-oauth-tokeninfo":
      requireProviderRequest(input, {
        method: "GET",
        maximumRedirects: 0,
        maximumResponseBytes: 512 * 1024,
        timeoutMs: 10_000
      });
      if (input.body) throw new Error("OUTBOUND_PROVIDER_BODY_FORBIDDEN");
      return;
    case "google-document-ai":
      requireProviderRequest(input, {
        method: "POST",
        maximumRedirects: 0,
        maximumRequestBytes: 80 * 1024 * 1024,
        maximumResponseBytes: 16 * 1024 * 1024,
        timeoutMs: 60_000
      });
      if (!input.body) throw new Error("OUTBOUND_PROVIDER_BODY_REQUIRED");
      if (!/^Bearer\s+\S+$/u.test(readHeader(input.headers, "authorization") ?? "")) {
        throw new Error("OUTBOUND_PROVIDER_AUTHORIZATION_REQUIRED");
      }
      if (!/^application\/json(?:\s*;|$)/iu.test(readHeader(input.headers, "content-type") ?? "")) {
        throw new Error("OUTBOUND_PROVIDER_CONTENT_TYPE_REQUIRED");
      }
      return;
    case "google-metadata-token":
      requireProviderRequest(input, {
        method: "GET",
        maximumRedirects: 0,
        maximumResponseBytes: 32 * 1024,
        timeoutMs: 2_500
      });
      if (input.body) throw new Error("OUTBOUND_METADATA_BODY_FORBIDDEN");
      if (readHeader(input.headers, "metadata-flavor") !== "Google") {
        throw new Error("OUTBOUND_METADATA_HEADER_REQUIRED");
      }
      return;
    case "yok-atlas":
      requireProviderRequest(input, {
        method: "POST",
        maximumRedirects: 0,
        maximumRequestBytes: 256 * 1024,
        maximumResponseBytes: 32 * 1024 * 1024,
        timeoutMs: 30_000
      });
      if (!input.body) throw new Error("OUTBOUND_PROVIDER_BODY_REQUIRED");
      if (!/^application\/json(?:\s*;|$)/iu.test(readHeader(input.headers, "content-type") ?? "")) {
        throw new Error("OUTBOUND_PROVIDER_CONTENT_TYPE_REQUIRED");
      }
      return;
    default:
      throw new Error("OUTBOUND_PROVIDER_POLICY_INVALID");
  }
}

function requireProviderRequest(
  input: {
    method: SafeOutboundHttpMethod;
    maximumRedirects: number;
    maximumRequestBytes: number;
    maximumResponseBytes: number;
    timeoutMs: number;
  },
  limits: {
    method: SafeOutboundHttpMethod;
    maximumRedirects: number;
    maximumRequestBytes?: number;
    maximumResponseBytes: number;
    timeoutMs: number;
  }
): void {
  if (input.method !== limits.method) throw new Error("OUTBOUND_PROVIDER_METHOD_FORBIDDEN");
  if (input.maximumRedirects > limits.maximumRedirects) throw new Error("OUTBOUND_PROVIDER_REDIRECT_LIMIT");
  if (limits.maximumRequestBytes !== undefined && input.maximumRequestBytes > limits.maximumRequestBytes) {
    throw new Error("OUTBOUND_PROVIDER_REQUEST_LIMIT");
  }
  if (input.maximumResponseBytes > limits.maximumResponseBytes) throw new Error("OUTBOUND_PROVIDER_RESPONSE_LIMIT");
  if (input.timeoutMs > limits.timeoutMs) throw new Error("OUTBOUND_PROVIDER_TIMEOUT_LIMIT");
}

function readHeader(headers: OutgoingHttpHeaders, requestedName: string): string | undefined {
  const entry = Object.entries(headers).find(([name]) => name.toLocaleLowerCase("en-US") === requestedName);
  if (!entry || entry[1] === undefined || Array.isArray(entry[1])) return undefined;
  return String(entry[1]);
}

function assertRedirectHeadersSafe(
  currentUrl: string,
  redirectUrl: string,
  headers: OutgoingHttpHeaders
): void {
  if (new URL(currentUrl).protocol === "https:" && new URL(redirectUrl).protocol !== "https:") {
    throw new Error("OUTBOUND_REDIRECT_DOWNGRADE_FORBIDDEN");
  }
  if (new URL(currentUrl).origin === new URL(redirectUrl).origin) return;
  const sensitiveNames = /^(?:authorization|cookie|proxy-authorization|x-api-key|x-auth-token)$/iu;
  if (Object.keys(headers).some((name) => sensitiveNames.test(name))) {
    throw new Error("OUTBOUND_REDIRECT_SENSITIVE_HEADERS_FORBIDDEN");
  }
}

function requireProviderPolicyUrl(
  candidate: string,
  baseUrl: string | undefined,
  providerPolicy: SafeOutboundProviderPolicy
): string {
  if (providerPolicy === "google-metadata-token") {
    return requireGoogleMetadataTokenUrl(candidate, baseUrl);
  }

  const absolute = requirePublicHttpUrl(candidate, baseUrl);
  const url = new URL(absolute);
  switch (providerPolicy) {
    case "public":
      return absolute;
    case "apple-jwks":
      if (url.toString() !== APPLE_JWKS_URL) throw new Error("OUTBOUND_APPLE_AUTHORITY_FORBIDDEN");
      return url.toString();
    case "google-oauth-tokeninfo": {
      const parameterNames = [...url.searchParams.keys()];
      if (
        url.protocol !== "https:"
        || url.hostname !== "oauth2.googleapis.com"
        || url.pathname !== "/tokeninfo"
        || url.hash
        || parameterNames.length !== 1
        || parameterNames[0] !== "id_token"
        || !url.searchParams.get("id_token")
      ) {
        throw new Error("OUTBOUND_GOOGLE_AUTHORITY_FORBIDDEN");
      }
      return url.toString();
    }
    case "google-document-ai": {
      const location = url.pathname.match(/^\/v1\/projects\/[^/]+\/locations\/([^/]+)\/processors\/[^/]+(?::process|\/processorVersions\/[^/]+:process)$/u)?.[1];
      if (
        url.protocol !== "https:"
        || !location
        || url.hostname !== `${location.toLocaleLowerCase("en-US")}-documentai.googleapis.com`
        || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(location)
        || url.search
        || url.hash
      ) {
        throw new Error("OUTBOUND_GOOGLE_AUTHORITY_FORBIDDEN");
      }
      return url.toString();
    }
    case "yok-atlas":
      if (url.toString() !== YOK_ATLAS_SEARCH_URL) throw new Error("OUTBOUND_YOK_ATLAS_AUTHORITY_FORBIDDEN");
      return url.toString();
    default:
      throw new Error("OUTBOUND_PROVIDER_POLICY_INVALID");
  }
}

function requireGoogleMetadataTokenUrl(candidate: string, baseUrl?: string): string {
  let url: URL;
  try {
    url = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
  } catch {
    throw new Error("OUTBOUND_URL_INVALID");
  }
  if (url.username || url.password) throw new Error("OUTBOUND_URL_CREDENTIALS_FORBIDDEN");
  if (url.toString() !== GOOGLE_METADATA_TOKEN_URL) throw new Error("OUTBOUND_METADATA_URL_FORBIDDEN");
  return url.toString();
}

async function resolveOutboundAddressesForPolicy(
  hostname: string,
  providerPolicy: SafeOutboundProviderPolicy,
  resolveHostname: (hostname: string) => Promise<readonly ResolvedOutboundAddress[]>
): Promise<ResolvedOutboundAddress[]> {
  if (providerPolicy !== "google-metadata-token") {
    return resolveSafeOutboundAddresses(hostname, resolveHostname);
  }
  if (hostname !== "metadata.google.internal") throw new Error("OUTBOUND_METADATA_URL_FORBIDDEN");
  const resolved = await resolveHostname(hostname).catch(() => {
    throw new Error("OUTBOUND_DNS_LOOKUP_FAILED");
  });
  if (resolved.length === 0) throw new Error("OUTBOUND_DNS_NO_ADDRESS");
  const unique = new Map<string, ResolvedOutboundAddress>();
  for (const candidate of resolved) {
    if (
      candidate.family !== 4
      || isIP(stripAddressZone(candidate.address)) !== 4
      || normalizeIpAddress(candidate.address) !== normalizeIpAddress(GOOGLE_METADATA_ADDRESS)
    ) {
      throw new Error("OUTBOUND_METADATA_ADDRESS_FORBIDDEN");
    }
    unique.set(normalizeIpAddress(candidate.address), {
      address: stripAddressZone(candidate.address),
      family: 4
    });
  }
  return [...unique.values()];
}

function assertPinnedRemoteAddressForPolicy(
  pinnedAddress: ResolvedOutboundAddress,
  remoteAddress: string | undefined,
  providerPolicy: SafeOutboundProviderPolicy
): void {
  if (providerPolicy !== "google-metadata-token") {
    assertPinnedRemoteAddress(pinnedAddress, remoteAddress);
    return;
  }
  if (
    !remoteAddress
    || normalizeIpAddress(pinnedAddress.address) !== normalizeIpAddress(GOOGLE_METADATA_ADDRESS)
    || normalizeIpAddress(remoteAddress) !== normalizeIpAddress(GOOGLE_METADATA_ADDRESS)
  ) {
    throw new Error("OUTBOUND_METADATA_CONNECTED_ADDRESS_FORBIDDEN");
  }
}

function assertBoundedResponse(response: SafeOutboundHopResponse, maximumResponseBytes: number): void {
  const declaredLength = Number(firstHeaderValue(response.headers["content-length"]));
  if ((Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) || response.body.length > maximumResponseBytes) {
    throw new Error("OUTBOUND_RESPONSE_TOO_LARGE");
  }
}

async function requestResolvedHop(
  url: string,
  addresses: readonly ResolvedOutboundAddress[],
  input: {
    deadline: number;
    method: SafeOutboundHttpMethod;
    headers: OutgoingHttpHeaders;
    body?: Buffer;
    maximumResponseBytes: number;
    providerPolicy: SafeOutboundProviderPolicy;
  },
  requestHop: NonNullable<SafeOutboundRequestDependencies["requestHop"]>
): Promise<SafeOutboundHopResponse> {
  let lastError: unknown;
  for (const address of addresses) {
    try {
      const timeoutMs = Math.max(0, input.deadline - Date.now());
      if (timeoutMs <= 0) throw new Error("OUTBOUND_REQUEST_TIMEOUT");
      const response = await withTimeout(
        requestHop(url, address, {
          timeoutMs,
          method: input.method,
          headers: input.headers,
          ...(input.body ? { body: input.body } : {}),
          maximumResponseBytes: input.maximumResponseBytes,
          providerPolicy: input.providerPolicy
        }),
        timeoutMs,
        "OUTBOUND_REQUEST_TIMEOUT"
      );
      assertPinnedRemoteAddressForPolicy(address, response.remoteAddress, input.providerPolicy);
      assertBoundedResponse(response, input.maximumResponseBytes);
      return response;
    } catch (error) {
      if (error instanceof Error && /^(?:OUTBOUND_CONNECTED_ADDRESS_|OUTBOUND_DESTINATION_|OUTBOUND_METADATA_)/u.test(error.message)) {
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
    method: SafeOutboundHttpMethod;
    headers: OutgoingHttpHeaders;
    body?: Buffer;
    maximumResponseBytes: number;
    providerPolicy: SafeOutboundProviderPolicy;
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
      method: input.method,
      headers: input.headers,
      lookup
    }, (response) => {
      let remoteAddress: string;
      try {
        remoteAddress = response.socket.remoteAddress ?? "";
        assertPinnedRemoteAddressForPolicy(pinnedAddress, remoteAddress, input.providerPolicy);
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
    request.end(input.body);
  });
}

function validateOutboundUrl(
  candidate: string,
  previousUrl: string | undefined,
  validateUrl: SafeOutboundRequestOptions["validateUrl"],
  providerPolicy: SafeOutboundProviderPolicy
): string {
  const absolute = requireProviderPolicyUrl(candidate, previousUrl, providerPolicy);
  const policyValidated = validateUrl ? validateUrl(absolute, previousUrl) : absolute;
  return requireProviderPolicyUrl(policyValidated, previousUrl, providerPolicy);
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
