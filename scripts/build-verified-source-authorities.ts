import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CatalogSeed = {
  universities: Array<{ slug: string; name: string }>;
};

type YokUniversityTree = {
  universities: Array<{
    name: string;
    homepageUrl: string;
    finalHomepageUrl?: string;
  }>;
};

export type VerifiedSourceAuthorityEvidence = {
  type: "YOK_HOMEPAGE" | "OBSERVED_OFFICIAL_REDIRECT" | "CHECKED_IN_AUTHORITY_ALIAS" | "CURATED_CATALOG_BINDING";
  url: string;
};

export type VerifiedSourceAuthority = {
  universityId: string;
  status: "verified" | "quarantined";
  authorityDomains: string[];
  authorityUrls: string[];
  evidence: VerifiedSourceAuthorityEvidence[];
  reasonCodes: Array<"owner_evidence_missing">;
};

export type VerifiedSourceAuthoritiesFile = {
  schemaVersion: 1;
  authorities: VerifiedSourceAuthority[];
};

const catalogPath = "apps/api/src/bootstrap/turkiye-catalog-seed.json";
const yokTreePath = "data/yok-university-faculty-tree.json";
const outputPath = "apps/api/src/bootstrap/verified-source-authorities.json";

/**
 * The checked-in YOK crawl has known identity/coverage defects. These bindings are
 * stable catalog-ID decisions, not hostname guesses:
 * - IYTE's YOK URL was crawled with an incorrect page title.
 * - Turk-Japanese Science and Technology University is absent from the crawl.
 * - Izmir Kavram has no checked-in YOK authority URL and remains quarantined.
 */
const curatedHomepageBindings: Readonly<Record<string, string>> = {
  "izmir-yuksek-teknoloji-enstitusu": "https://www.iyte.edu.tr/",
  "turk-japon-bilim-ve-teknoloji-universitesi": "https://www.tju.edu.tr/"
};

/**
 * Only aliases with checked-in ownership evidence belong here. Candidate
 * source URLs never become authority evidence by appearing in a source file.
 */
const checkedInAliases: Readonly<Record<string, readonly string[]>> = {
  // The checked-in YOK tree's Bahcesehir homepage links its faculties and
  // departments directly to this BAU root.
  "bahcesehir-universitesi-istanbul": ["https://bau.edu.tr/"]
};

/**
 * Explicit official-site bindings whose institution identity is displayed on
 * the bound root, independently of candidate source registries.
 */
const curatedOfficialAliases: Readonly<Record<string, readonly string[]>> = {
  "fatih-sultan-mehmet-vakif-universitesi-istanbul": ["https://www.fatihsultan.edu.tr/"],
  "izmir-katip-celebi-universitesi": ["https://ikcu.edu.tr/"],
  "manisa-cel-l-bayar-universitesi": ["https://www.mcbu.edu.tr/"],
  "sabanci-universitesi-istanbul": ["https://sabanciuniv.edu.tr/"]
};

export async function buildVerifiedSourceAuthorities(root = process.cwd()): Promise<VerifiedSourceAuthoritiesFile> {
  const catalog = JSON.parse(await readFile(resolve(root, catalogPath), "utf8")) as CatalogSeed;
  const yokTree = JSON.parse(await readFile(resolve(root, yokTreePath), "utf8")) as YokUniversityTree;
  const treeByName = groupBy(yokTree.universities, (university) => normalizeUniversityName(university.name));
  const treeByDomain = new Map<string, YokUniversityTree["universities"][number]>();
  for (const university of yokTree.universities) {
    const domain = authorityDomain(university.homepageUrl);
    if (domain) treeByDomain.set(domain, university);
  }

  const authorities = catalog.universities.map((university): VerifiedSourceAuthority => {
    const curatedHomepage = curatedHomepageBindings[university.slug];
    const matchedTreeRecords = curatedHomepage
      ? [treeByDomain.get(authorityDomain(curatedHomepage) ?? "")].filter(isDefined)
      : treeByName.get(normalizeUniversityName(university.name)) ?? [];
    const primary = matchedTreeRecords[0];
    if (!primary && !curatedHomepage) {
      return {
        universityId: university.slug,
        status: "quarantined",
        authorityDomains: [],
        authorityUrls: [],
        evidence: [],
        reasonCodes: ["owner_evidence_missing"]
      };
    }

    const evidence: VerifiedSourceAuthorityEvidence[] = primary
      ? [{ type: "YOK_HOMEPAGE", url: canonicalEvidenceUrl(primary.homepageUrl) }]
      : [];
    const domains = new Set<string>();
    if (primary) addAuthorityDomain(domains, primary.homepageUrl);

    if (curatedHomepage) {
      evidence.push({ type: "CURATED_CATALOG_BINDING", url: canonicalEvidenceUrl(curatedHomepage) });
      addAuthorityDomain(domains, curatedHomepage);
    }

    if (university.slug === "gaziantep-universitesi" && primary?.finalHomepageUrl) {
      evidence.push({ type: "OBSERVED_OFFICIAL_REDIRECT", url: canonicalEvidenceUrl(primary.finalHomepageUrl) });
      addAuthorityDomain(domains, primary.finalHomepageUrl);
    }

    for (const aliasUrl of checkedInAliases[university.slug] ?? []) {
      evidence.push({ type: "CHECKED_IN_AUTHORITY_ALIAS", url: canonicalEvidenceUrl(aliasUrl) });
      addAuthorityDomain(domains, aliasUrl);
    }

    for (const aliasUrl of curatedOfficialAliases[university.slug] ?? []) {
      evidence.push({ type: "CURATED_CATALOG_BINDING", url: canonicalEvidenceUrl(aliasUrl) });
      addAuthorityDomain(domains, aliasUrl);
    }

    // Hakkari is represented twice by the checked-in YOK tree. Keep both
    // roots as explicit evidence for the same stable catalog owner.
    if (university.slug === "hakkari-universitesi") {
      for (const record of matchedTreeRecords.slice(1)) {
        evidence.push({ type: "YOK_HOMEPAGE", url: canonicalEvidenceUrl(record.homepageUrl) });
        addAuthorityDomain(domains, record.homepageUrl);
      }
    }

    return {
      universityId: university.slug,
      status: "verified",
      authorityDomains: [...domains].sort(compareText),
      authorityUrls: [...new Set(evidence.map((item) => new URL("/", item.url).toString()))].sort(compareText),
      evidence: dedupeEvidence(evidence).sort((left, right) => compareText(`${left.type}\u0000${left.url}`, `${right.type}\u0000${right.url}`)),
      reasonCodes: []
    };
  }).sort((left, right) => compareText(left.universityId, right.universityId));

  assertUniqueAuthorityDomains(authorities);

  return { schemaVersion: 1, authorities };
}

function assertUniqueAuthorityDomains(authorities: readonly VerifiedSourceAuthority[]): void {
  const ownerByDomain = new Map<string, string>();
  for (const authority of authorities) {
    if (authority.status !== "verified") continue;
    for (const domain of authority.authorityDomains) {
      const existingOwner = ownerByDomain.get(domain);
      if (existingOwner && existingOwner !== authority.universityId) {
        throw new Error(`SOURCE_AUTHORITY_DOMAIN_AMBIGUOUS:${domain}:${[existingOwner, authority.universityId].sort(compareText).join(",")}`);
      }
      ownerByDomain.set(domain, authority.universityId);
    }
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) {
    throw new Error(`SOURCE_AUTHORITY_ARGUMENT_UNSUPPORTED:${args.join(",")}`);
  }
  const payload = await buildVerifiedSourceAuthorities(root);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  if (args.includes("--check")) {
    const checkedIn = await readFile(resolve(root, outputPath), "utf8");
    if (normalizeGeneratedText(checkedIn) !== normalizeGeneratedText(serialized)) {
      throw new Error("SOURCE_AUTHORITY_REGISTRY_OUT_OF_DATE");
    }
  } else {
    await writeFile(resolve(root, outputPath), serialized, "utf8");
  }
  const verified = payload.authorities.filter((authority) => authority.status === "verified").length;
  const quarantined = payload.authorities.length - verified;
  console.log(JSON.stringify({ authorities: payload.authorities.length, verified, quarantined, checked: args.includes("--check") }));
}

function normalizeGeneratedText(value: string): string {
  return value.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
}

function normalizeUniversityName(input: string): string {
  return input
    .replace(/\([^)]*\)/gu, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9\u0131]+/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function authorityDomain(input: string): string | null {
  try {
    const labels = new URL(input).hostname.toLocaleLowerCase("en-US").replace(/^www\./u, "").split(".").filter(Boolean);
    if (labels.length < 2) return null;
    if (labels.slice(-2).join(".") === "edu.tr" || labels.slice(-2).join(".") === "gov.tr") {
      return labels.length >= 3 ? labels.slice(-3).join(".") : null;
    }
    return labels.slice(-2).join(".");
  } catch {
    return null;
  }
}

function addAuthorityDomain(domains: Set<string>, input: string): void {
  const domain = authorityDomain(input);
  if (domain) domains.add(domain);
}

function canonicalEvidenceUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

function dedupeEvidence(evidence: VerifiedSourceAuthorityEvidence[]): VerifiedSourceAuthorityEvidence[] {
  return [...new Map(evidence.map((item) => [`${item.type}\u0000${item.url}`, item])).values()];
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en-US");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
