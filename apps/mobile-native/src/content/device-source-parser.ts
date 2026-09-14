import {
  parseDeviceSourceRuntimeDocument,
  type DeviceSourceRuntimeItem,
} from "../../../../packages/shared/src/device-source-runtime";
import {
  normalizeDisplayText,
  type MobileContentRecordInput,
} from "./content-trust";
import type { DeviceContentSource } from "./device-source-manifest";

export function parseDeviceSourceDocument(
  input: string,
  source: DeviceContentSource,
  fetchedAt = new Date(),
  baseUrl = source.sourceUrl,
): MobileContentRecordInput[] {
  return parseDeviceSourceRuntimeDocument(input, source, baseUrl).map((item) => (
    toMobileRecord(item, source, fetchedAt)
  ));
}

export function toMobileRecord(
  item: DeviceSourceRuntimeItem,
  source: DeviceContentSource,
  fetchedAt: Date,
): MobileContentRecordInput {
  const summary = normalizeDisplayText(item.summary).slice(0, 1_200);
  return {
    id: `device-${source.id}-${stableTextHash(item.link)}`,
    sourceId: source.id,
    sourceName: source.sourceName,
    contentType: source.contentType,
    scopeType: source.scopeType,
    scopeId: source.scopeId,
    ...(source.universityId ? { universityId: source.universityId } : {}),
    ...(source.universityName ? { universityName: source.universityName } : {}),
    ...(source.facultyId ? { facultyId: source.facultyId } : {}),
    ...(source.facultyName ? { facultyName: source.facultyName } : {}),
    ...(source.departmentId ? { departmentId: source.departmentId } : {}),
    ...(source.departmentName ? { departmentName: source.departmentName } : {}),
    title: item.title,
    link: item.link,
    canonicalUrl: item.link,
    officialSourceUrl: source.sourceUrl,
    sourceRelationships: [{
      sourceId: source.id,
      sourceName: source.sourceName,
      officialSourceUrl: source.sourceUrl,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      canonicalUrl: item.link,
    }],
    fetchedAt: fetchedAt.toISOString(),
    ...(item.publicationKind === "date" && item.publishedDate
      ? { publicationKind: "date", publishedDate: item.publishedDate }
      : item.publishedAt ? { publicationKind: "timestamp", publishedAt: item.publishedAt } : {}),
    ...(item.sourceUpdatedAt ? { sourceUpdatedAt: item.sourceUpdatedAt } : {}),
    ...(summary ? { summary } : {}),
    ...(item.body?.length ? { body: item.body } : summary ? { body: [{ type: "paragraph", text: summary }] } : {}),
    ...(item.keyDates?.length ? { keyDates: item.keyDates } : {}),
    freshness: "fresh",
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
  };
}

function stableTextHash(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}
