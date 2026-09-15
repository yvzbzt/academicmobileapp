import { fetch as expoFetch, type FetchRequestInit } from "expo/fetch";
import {
  DEVICE_SOURCE_ACCEPT_LANGUAGE,
  DEVICE_SOURCE_USER_AGENT,
  executeDeviceSourceRuntime,
  type DeviceSourceRuntimeRequest,
  type DeviceSourceRuntimeResponse,
} from "../../../../packages/shared/src/device-source-runtime";
import {
  canonicalizeOfficialAcademicUrl,
  normalizeTrustedContentCollection,
  officialDomainForUrl,
  type TrustedContentCollection,
} from "./content-trust";
import { isDeviceSourceCurrentlyTrusted, type DeviceContentSource } from "./device-source-manifest";
import { toMobileRecord } from "./device-source-parser";

export type DeviceSourceFetchErrorCode =
  | "source_expired"
  | "network_failed"
  | "request_failed"
  | "redirect_rejected"
  | "media_type_rejected"
  | "response_too_large"
  | "source_empty";

export class DeviceSourceFetchError extends Error {
  constructor(readonly code: DeviceSourceFetchErrorCode) {
    super(code);
    this.name = "DeviceSourceFetchError";
  }
}

export interface DeviceSourceFetchOptions {
  fetchImpl?: DeviceSourceFetch;
  now?: Date;
  signal?: AbortSignal;
  timeoutMs?: number;
  maximumResponseBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 1_500_000;
const MAXIMUM_REDIRECTS = 5;
type DeviceSourceFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchDeviceContentSource(
  source: DeviceContentSource,
  options: DeviceSourceFetchOptions = {},
): Promise<TrustedContentCollection> {
  const now = options.now ?? new Date();
  if (!source.fetchAllowed || !isDeviceSourceCurrentlyTrusted(source, now)) {
    throw new DeviceSourceFetchError("source_expired");
  }
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const transport = createMobileTransport(source, {
      fetchImpl: options.fetchImpl ?? defaultDeviceSourceFetch,
      signal: controller.signal,
      maximumResponseBytes: options.maximumResponseBytes ?? DEFAULT_MAXIMUM_RESPONSE_BYTES,
    });
    let snapshot;
    try {
      snapshot = await executeDeviceSourceRuntime(source, transport);
    } catch (error) {
      if (error instanceof DeviceSourceFetchError) throw error;
      const message = error instanceof Error ? error.message : "";
      if (message === "SOURCE_RUNTIME_REDIRECT_REJECTED") throw new DeviceSourceFetchError("redirect_rejected");
      if (message === "SOURCE_RUNTIME_MEDIA_TYPE_REJECTED") throw new DeviceSourceFetchError("media_type_rejected");
      throw new DeviceSourceFetchError("request_failed");
    }
    if (!isDeviceSourceCurrentlyTrusted(source, options.now ?? new Date())) {
      throw new DeviceSourceFetchError("source_expired");
    }
    const collection = normalizeTrustedContentCollection(
      snapshot.items.map((item) => toMobileRecord(item, source, now)),
    );
    if (collection.items.length === 0) throw new DeviceSourceFetchError("source_empty");
    return collection;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

function createMobileTransport(
  source: DeviceContentSource,
  options: { fetchImpl: DeviceSourceFetch; signal: AbortSignal; maximumResponseBytes: number },
) {
  return async (request: DeviceSourceRuntimeRequest): Promise<DeviceSourceRuntimeResponse> => {
    let target = requireSafeTarget(request.url, source);
    for (let redirects = 0; redirects <= MAXIMUM_REDIRECTS; redirects += 1) {
      let response: Response;
      try {
        response = await options.fetchImpl(target, {
          method: "GET",
          headers: {
            Accept: request.accept,
            "Accept-Language": DEVICE_SOURCE_ACCEPT_LANGUAGE,
            "User-Agent": DEVICE_SOURCE_USER_AGENT,
            ...(request.origin ? { Origin: request.origin } : {}),
          },
          credentials: "omit",
          redirect: "manual",
          cache: "no-store",
          signal: options.signal,
        });
      } catch {
        throw new DeviceSourceFetchError("network_failed");
      }

      // A native fetch implementation that ignored `manual` may already have
      // followed a redirect. Do not accept or parse that unverifiable result.
      const observedUrl = response.url ? requireSafeTarget(response.url, source) : target;
      if (canonicalRequestKey(observedUrl) !== canonicalRequestKey(target)) {
        throw new DeviceSourceFetchError("redirect_rejected");
      }
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects === MAXIMUM_REDIRECTS) {
          throw new DeviceSourceFetchError("redirect_rejected");
        }
        try {
          target = requireSafeTarget(new URL(location, target).toString(), source);
        } catch {
          throw new DeviceSourceFetchError("redirect_rejected");
        }
        continue;
      }

      if (response.status !== 304 && !response.ok) throw new DeviceSourceFetchError("request_failed");
      const text = response.status === 304
        ? ""
        : await readBoundedText(response, options.maximumResponseBytes);
      return {
        status: response.status,
        text,
        finalUrl: target,
        ...(response.headers.get("content-type") ? { contentType: response.headers.get("content-type")! } : {}),
        ...(response.headers.get("etag") ? { etag: response.headers.get("etag")! } : {}),
        ...(response.headers.get("last-modified") ? { lastModified: response.headers.get("last-modified")! } : {}),
      };
    }
    throw new DeviceSourceFetchError("redirect_rejected");
  };
}

async function defaultDeviceSourceFetch(url: string, init?: RequestInit): Promise<Response> {
  return expoFetch(url, init as FetchRequestInit) as unknown as Response;
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const lengthHeader = response.headers.get("content-length");
  const declaredLength = lengthHeader === null ? null : Number(lengthHeader);
  if (declaredLength !== null && (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maximumBytes)) {
    throw new DeviceSourceFetchError("response_too_large");
  }

  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maximumBytes) {
          await reader.cancel();
          throw new DeviceSourceFetchError("response_too_large");
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }

  // Some React Native fetch implementations expose only all-at-once text().
  // Without a trustworthy length there is no way to enforce the memory bound.
  if (declaredLength === null) throw new DeviceSourceFetchError("response_too_large");
  const text = await response.text();
  if (utf8ByteLength(text) > maximumBytes) throw new DeviceSourceFetchError("response_too_large");
  return text;
}

function requireSafeTarget(value: string, source: DeviceContentSource): string {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new DeviceSourceFetchError("redirect_rejected");
  }
  const canonical = canonicalizeOfficialAcademicUrl(value);
  if (
    !canonical
    || target.protocol !== "https:"
    || target.hostname.replace(/\.$/u, "") !== new URL(canonical).hostname
    || officialDomainForUrl(canonical) !== source.allowedOfficialDomain
  ) throw new DeviceSourceFetchError("redirect_rejected");
  // Canonical identity strips slashes and rewrites queries; neither is safe for a network request.
  return target.toString();
}

function canonicalRequestKey(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
