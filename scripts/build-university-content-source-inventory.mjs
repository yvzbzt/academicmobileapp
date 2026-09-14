import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = fileURLToPath(new URL("../apps/api/src/bootstrap/verified-university-sources.json", import.meta.url));
const authorityPath = fileURLToPath(new URL("../apps/api/src/bootstrap/verified-source-authorities.json", import.meta.url));
const catalogPath = fileURLToPath(new URL("../apps/api/src/bootstrap/turkiye-catalog-seed.json", import.meta.url));
const outputPath = fileURLToPath(new URL("../apps/api/src/bootstrap/university-content-source-inventory.json", import.meta.url));
const contentDefinitions = [
  {
    contentType: "announcement",
    urlField: "announcementUrl",
    statusField: "announcementStatus",
    evidenceField: "announcementUrl",
    kind: "listing",
    description: "Duyuru liste sayfası; bağlantı, başlık ve tarih otomatik algılanır.",
    selectorHints: {
      item: ["article", ".announcement", ".duyuru", ".news-item", "li"],
      title: ["h1", "h2", "h3", ".title", ".baslik", "a"],
      link: ["a[href]"],
      date: ["time", "[datetime]", ".date", ".tarih"],
      content: ["main", "article", ".content", ".icerik"]
    }
  },
  {
    contentType: "news",
    urlField: "newsUrl",
    statusField: "newsStatus",
    evidenceField: "newsUrl",
    kind: "listing",
    description: "Haber liste sayfası; bağlantı, başlık ve tarih otomatik algılanır.",
    selectorHints: {
      item: ["article", ".news", ".haber", ".news-item", "li"],
      title: ["h1", "h2", "h3", ".title", ".baslik", "a"],
      link: ["a[href]"],
      date: ["time", "[datetime]", ".date", ".tarih"],
      content: ["main", "article", ".content", ".icerik"]
    }
  },
  {
    contentType: "event",
    urlField: "eventUrl",
    statusField: "eventStatus",
    evidenceField: "eventUrl",
    kind: "listing",
    description: "Etkinlik liste sayfası; bağlantı, başlık ve etkinlik tarihi otomatik algılanır.",
    selectorHints: {
      item: ["article", ".event", ".etkinlik", ".event-item", "li"],
      title: ["h1", "h2", "h3", ".title", ".baslik", "a"],
      link: ["a[href]"],
      date: ["time", "[datetime]", ".date", ".tarih"],
      content: ["main", "article", ".content", ".icerik"]
    }
  },
  {
    contentType: "academic_calendar",
    urlField: "calendarUrl",
    statusField: "calendarStatus",
    evidenceField: "calendarUrl",
    kind: "calendar_document_or_page",
    description: "Akademik takvim HTML sayfası veya PDF/Office belge bağlantısı; tablo ve tarih aralıkları otomatik algılanır.",
    selectorHints: {
      item: ["table tbody tr", ".calendar-item", ".takvim-item", "article"],
      title: ["th", "td", "h1", "h2", ".title", ".baslik"],
      link: ["a[href$='.pdf']", "a[href$='.doc']", "a[href$='.docx']", "a[href]"],
      date: ["time", "[datetime]", "td", ".date", ".tarih"],
      content: ["main", "article", "table", ".content", ".icerik"]
    }
  }
];

const checkOnly = process.argv.includes("--check");
const [sources, authorityDocument, catalog, currentOutput] = await Promise.all([
  readJson(sourcePath),
  readJson(authorityPath),
  readJson(catalogPath),
  readJson(outputPath).catch(() => null)
]);

if (!Array.isArray(sources)) fail("verified university sources must be an array");
if (!authorityDocument || !Array.isArray(authorityDocument.authorities)) fail("authority registry is invalid");
if (!catalog || !Array.isArray(catalog.universities)) fail("catalog is invalid");

const authorityByUniversity = new Map(authorityDocument.authorities.map((authority) => [authority.universityId, authority]));
const generatedAt = currentOutput?.generatedAt ?? new Date().toISOString();
const universities = sources.map((source) => buildUniversity(source, authorityByUniversity.get(source.universityId)));
const inventory = {
  schemaVersion: 1,
  generatedAt,
  summary: buildSummary(universities),
  universities
};

validateInventory(inventory, new Set(catalog.universities.map((university) => university.slug)));
const serialized = `${JSON.stringify(inventory, null, 2)}\n`;
if (checkOnly) {
  if (!currentOutput) fail("inventory has not been generated");
  const currentSerialized = `${JSON.stringify(currentOutput, null, 2)}\n`;
  if (serialized !== currentSerialized) fail("inventory is stale; run node scripts/build-university-content-source-inventory.mjs");
  console.log(JSON.stringify(inventory.summary));
} else {
  await writeFile(outputPath, serialized, "utf8");
  console.log(`${outputPath.slice(root.length)}: ${JSON.stringify(inventory.summary)}`);
}

function buildUniversity(source, authority) {
  if (!authority) fail(`authority missing for ${source.universityId}`);
  const homepageUrl = firstAuthorityHttpsUrl(source.websiteUrl, authority.authorityUrls, authority);
  return {
    universityId: requiredText(source.universityId, "universityId"),
    universityName: requiredText(source.universityName, "universityName"),
    ...(optionalText(source.city) ? { city: source.city.trim() } : {}),
    authority: {
      status: authority.status,
      ...(homepageUrl ? { homepageUrl } : {}),
      domains: [...authority.authorityDomains],
      reasonCodes: [...authority.reasonCodes],
      evidence: [...authority.evidence]
    },
    ...(Array.isArray(source.unmappedContentUrls)
      ? { unmappedCandidateUrls: source.unmappedContentUrls.map(optionalUrl).filter(Boolean) }
      : {}),
    slots: contentDefinitions.map((definition) => buildSlot(source, authority, homepageUrl, definition))
  };
}

function buildSlot(source, authority, homepageUrl, definition) {
  const hasRawSourceUrl = Boolean(optionalText(source[definition.urlField]));
  const sourceUrl = authorityHttpsUrl(source[definition.urlField], authority);
  const effectiveUrl = sourceUrl ?? (!unavailableAuthority(authority, homepageUrl) ? homepageUrl : undefined);
  const verificationEvidence = sourceUrl ? source.verificationByField?.[definition.evidenceField] : undefined;
  const unavailable = unavailableAuthority(authority, homepageUrl);
  const directDocument = effectiveUrl ? /\.(?:pdf|docx?|xlsx?)(?:$|[?#])/iu.test(effectiveUrl) : false;
  const detectedFormat = directDocument ? "document" : detectSourceFormat(effectiveUrl);
  const parserProfile = sourceUrl
    ? readParserProfile(source.parserProfiles?.[definition.contentType], `${source.universityId}/${definition.contentType}`)
    : undefined;
  const parser = parserProfile?.parser ?? "auto";
  return {
    contentType: definition.contentType,
    ...(sourceUrl ? { sourceUrl } : !unavailable ? { candidateUrl: homepageUrl } : {}),
    status: sourceUrl ? "candidate_found" : unavailable ? "authority_unavailable" : "needs_review",
    resolution: sourceUrl ? "candidate" : unavailable ? "quarantined" : "missing",
    sourceStatus: hasRawSourceUrl && !sourceUrl
      ? "source_rejected"
      : optionalText(source[definition.statusField]) ?? (sourceUrl ? "source_found" : "source_not_found"),
    evidenceStatus: verificationEvidence ? "final_revalidated" : "not_attached",
    ...(verificationEvidence ? { verificationEvidence } : {}),
    parser,
    ...(parserProfile?.parserConfig ? { parserConfig: parserProfile.parserConfig } : {}),
    siteStructure: {
      kind: directDocument ? "direct_document" : definition.kind,
      detectedFormat,
      extractionMode: directDocument
        ? "document_text"
        : parserProfile?.parserConfig
          ? "html_dom_configured"
          : detectedFormat === "html" ? "html_dom_auto" : `${detectedFormat}_auto`,
      description: directDocument
        ? "Doğrudan PDF/Office belgesi; metin ve tablo tarihleri otomatik çıkarılır."
        : detectedFormat === "json"
          ? "Resmî JSON API; başlık, bağlantı ve tarih alanları otomatik ayrıştırılır."
          : detectedFormat === "feed"
            ? "Resmî RSS/Atom akışı; içerik öğeleri otomatik ayrıştırılır."
            : definition.description,
      selectorHints: definition.selectorHints
    }
  };
}

function detectSourceFormat(value) {
  if (!value) return "html";
  const { pathname } = new URL(value);
  if (/(?:^|\/)feed\/?$/iu.test(pathname) || /\.(?:rss|atom|xml)$/iu.test(pathname)) return "feed";
  if (/(?:^|\/)(?:api|json|wp-json)(?:\/|$)/iu.test(pathname)) return "json";
  return "html";
}

function readParserProfile(value, label) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || !["auto", "rss", "html"].includes(value.parser)) {
    fail(`parser profile is invalid for ${label}`);
  }
  const allowedFields = ["itemSelector", "titleSelector", "linkSelector", "dateSelector", "contentSelector"];
  const rawConfig = value.parserConfig;
  if (rawConfig === undefined) return { parser: value.parser };
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)
    || Object.keys(rawConfig).some((key) => !allowedFields.includes(key))) {
    fail(`parser config is invalid for ${label}`);
  }
  const parserConfig = {};
  for (const field of allowedFields) {
    if (rawConfig[field] === undefined) continue;
    const selector = optionalText(rawConfig[field]);
    if (!selector || selector.length > 300) fail(`parser selector is invalid for ${label}/${field}`);
    parserConfig[field] = selector;
  }
  if (Object.keys(parserConfig).length === 0) fail(`parser config is empty for ${label}`);
  return { parser: value.parser, parserConfig };
}

function unavailableAuthority(authority, homepageUrl) {
  return authority.status !== "verified" || !homepageUrl;
}

function buildSummary(universities) {
  const slots = universities.flatMap((university) => university.slots);
  const byContentType = Object.fromEntries(contentDefinitions.map(({ contentType }) => {
    const matches = slots.filter((slot) => slot.contentType === contentType);
    return [contentType, {
      total: matches.length,
      candidateFound: matches.filter((slot) => slot.status === "candidate_found").length,
      needsReview: matches.filter((slot) => slot.status === "needs_review").length,
      authorityUnavailable: matches.filter((slot) => slot.status === "authority_unavailable").length,
      finalRevalidated: matches.filter((slot) => slot.evidenceStatus === "final_revalidated").length,
      directDocuments: matches.filter((slot) => slot.siteStructure.detectedFormat === "document").length
    }];
  }));
  return {
    universities: universities.length,
    sourceSlots: slots.length,
    authoritiesVerified: universities.filter((university) => university.authority.status === "verified").length,
    authoritiesQuarantined: universities.filter((university) => university.authority.status === "quarantined").length,
    byContentType
  };
}

function validateInventory(inventory, catalogIds) {
  if (inventory.universities.length !== 208) fail(`expected 208 universities, got ${inventory.universities.length}`);
  const ids = new Set();
  for (const university of inventory.universities) {
    if (ids.has(university.universityId)) fail(`duplicate university ${university.universityId}`);
    ids.add(university.universityId);
    if (!catalogIds.has(university.universityId)) fail(`university is absent from catalog: ${university.universityId}`);
    if (university.slots.length !== contentDefinitions.length) fail(`slot count invalid for ${university.universityId}`);
    const types = new Set(university.slots.map((slot) => slot.contentType));
    if (types.size !== contentDefinitions.length) fail(`duplicate content slot for ${university.universityId}`);
    for (const slot of university.slots) {
      if (slot.status === "candidate_found" && !slot.sourceUrl) fail(`candidate source URL missing for ${university.universityId}/${slot.contentType}`);
      if (slot.status === "needs_review" && (!slot.candidateUrl || slot.sourceUrl)) fail(`review candidate invalid for ${university.universityId}/${slot.contentType}`);
      if (slot.status === "authority_unavailable" && (slot.sourceUrl || slot.candidateUrl)) fail(`unavailable authority has URL for ${university.universityId}/${slot.contentType}`);
    }
  }
  const missingCatalogIds = [...catalogIds].filter((id) => !ids.has(id));
  if (missingCatalogIds.length) fail(`catalog universities are absent from inventory: ${missingCatalogIds.join(",")}`);
  if (inventory.summary.sourceSlots !== 832) fail(`expected 832 source slots, got ${inventory.summary.sourceSlots}`);
}

function firstAuthorityHttpsUrl(value, values, authority) {
  return [value, ...(Array.isArray(values) ? values : [])]
    .map((candidate) => authorityHttpsUrl(candidate, authority))
    .find(Boolean);
}

function authorityHttpsUrl(value, authority) {
  const normalized = optionalUrl(value);
  if (!normalized || authority.status !== "verified" || !Array.isArray(authority.authorityDomains)) return undefined;
  const url = new URL(normalized);
  if (url.protocol !== "https:") return undefined;
  const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/u, "");
  return authority.authorityDomains.some((domain) => {
    const normalizedDomain = optionalText(domain)?.toLocaleLowerCase("en-US").replace(/\.$/u, "");
    return normalizedDomain && (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`));
  }) ? normalized : undefined;
}

function optionalUrl(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function optionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredText(value, field) {
  const normalized = optionalText(value);
  if (!normalized) fail(`${field} is required`);
  return normalized;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function fail(message) {
  throw new Error(message);
}
