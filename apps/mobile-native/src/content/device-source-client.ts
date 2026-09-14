import {
  canonicalizeOfficialAcademicUrl,
  normalizeTrustedContentCollection,
  officialDomainForUrl,
  type TrustedContentCollection,
} from "./content-trust";
import { isDeviceSourceCurrentlyTrusted, type DeviceContentSource } from "./device-source-manifest";
import { parseDeviceSourceDocument } from "./device-source-parser";

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
  fetchImpl?: typeof fetch;
  now?: Date;
  signal?: AbortSignal;
  timeoutMs?: number;
  maximumResponseBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 1_500_000;

export async function fetchDeviceContentSource(
  source: DeviceContentSource,
  options: DeviceSourceFetchOptions = {},
): Promise<TrustedContentCollection> {
  const now = options.now ?? new Date();
  if (!isDeviceSourceCurrentlyTrusted(source, now)) throw new DeviceSourceFetchError("source_expired");
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(source.sourceUrl, {
        method: "GET",
        headers: { Accept: "text/html,application/json,application/rss+xml,application/xml;q=0.9,text/plain;q=0.8" },
        credentials: "omit",
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      throw new DeviceSourceFetchError("network_failed");
    }
    if (!response.ok) throw new DeviceSourceFetchError("request_failed");
    assertAcceptedFinalUrl(response.url, source);
    assertAcceptedMediaType(response.headers.get("content-type"));
    const maximumBytes = options.maximumResponseBytes ?? DEFAULT_MAXIMUM_RESPONSE_BYTES;
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw new DeviceSourceFetchError("response_too_large");
    }
    const body = await response.text();
    if (utf8ByteLength(body) > maximumBytes) throw new DeviceSourceFetchError("response_too_large");
    if (!isDeviceSourceCurrentlyTrusted(source, options.now ?? new Date())) {
      throw new DeviceSourceFetchError("source_expired");
    }
    const collection = normalizeTrustedContentCollection(parseDeviceSourceDocument(body, source, now));
    if (collection.items.length === 0) throw new DeviceSourceFetchError("source_empty");
    return collection;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

function assertAcceptedFinalUrl(value: string, source: DeviceContentSource): void {
  const canonical = canonicalizeOfficialAcademicUrl(value);
  if (
    !canonical
    || officialDomainForUrl(canonical) !== officialDomainForUrl(source.sourceUrl)
  ) throw new DeviceSourceFetchError("redirect_rejected");
}

function assertAcceptedMediaType(value: string | null): void {
  const mediaType = value?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
  if (!mediaType || !(
    mediaType === "text/html"
    || mediaType === "application/xhtml+xml"
    || mediaType === "application/json"
    || mediaType === "text/json"
    || mediaType === "application/xml"
    || mediaType === "text/xml"
    || mediaType === "application/rss+xml"
    || mediaType === "application/atom+xml"
    || mediaType === "text/plain"
  )) throw new DeviceSourceFetchError("media_type_rejected");
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
