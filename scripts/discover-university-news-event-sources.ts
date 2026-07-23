import { readFile, writeFile } from "node:fs/promises";

const sourcePath = "apps/api/src/bootstrap/verified-university-sources.json";
const timeoutMs = Number(process.env.NEWS_EVENT_DISCOVERY_TIMEOUT_MS ?? 6000);
const concurrency = Number(process.env.NEWS_EVENT_DISCOVERY_CONCURRENCY ?? 8);

type SourceRecord = {
  universityId: string;
  universityName: string;
  announcementUrl?: string | null;
  newsUrl?: string | null;
  eventUrl?: string | null;
  calendarUrl?: string | null;
  summerSchoolUrl?: string | null;
  newsStatus?: string | null;
  eventStatus?: string | null;
};

type DiscoveryKind = "news" | "event";

type DiscoveryResult = {
  universityId: string;
  universityName: string;
  kind: DiscoveryKind;
  status: "source_found" | "source_not_found" | "homepage_not_found";
  url?: string;
  checked: number;
};

async function main() {
  const records = JSON.parse(stripBom(await readFile(sourcePath, "utf8"))) as SourceRecord[];
  const jobs = records.flatMap((record) => {
    const items: Array<() => Promise<DiscoveryResult>> = [];
    if (!record.newsUrl) items.push(() => discover(record, "news"));
    if (!record.eventUrl) items.push(() => discover(record, "event"));
    return items;
  });

  const results = await runWithConcurrency(jobs, concurrency, (job) => job());
  const byKey = new Map(results.map((result) => [`${result.universityId}:${result.kind}`, result]));

  for (const record of records) {
    const news = byKey.get(`${record.universityId}:news`);
    if (news) {
      record.newsStatus = news.status;
      if (news.url) record.newsUrl = news.url;
    }
    const event = byKey.get(`${record.universityId}:event`);
    if (event) {
      record.eventStatus = event.status;
      if (event.url) record.eventUrl = event.url;
    }
  }

  await writeFile(sourcePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");

  const foundNews = results.filter((result) => result.kind === "news" && result.status === "source_found").length;
  const foundEvents = results.filter((result) => result.kind === "event" && result.status === "source_found").length;
  console.log(`Checked ${results.length} news/event discovery jobs.`);
  console.log(`Found news sources: ${foundNews}`);
  console.log(`Found event sources: ${foundEvents}`);
}

async function discover(record: SourceRecord, kind: DiscoveryKind): Promise<DiscoveryResult> {
  const bases = homepageCandidates(record);
  if (bases.length === 0) return { universityId: record.universityId, universityName: record.universityName, kind, status: "homepage_not_found", checked: 0 };

  let checked = 0;
  for (const base of bases) {
    for (const path of sourcePaths(kind)) {
      checked += 1;
      const url = new URL(path, base).toString();
      if (await isLikelySourceUrl(url, kind)) return { universityId: record.universityId, universityName: record.universityName, kind, status: "source_found", url, checked };
    }
  }

  return { universityId: record.universityId, universityName: record.universityName, kind, status: "source_not_found", checked };
}

function homepageCandidates(record: SourceRecord): string[] {
  const candidates = new Set<string>();
  for (const value of [record.announcementUrl, record.newsUrl, record.eventUrl, record.calendarUrl, record.summerSchoolUrl]) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      candidates.add(new URL("/", parsed).toString());
    } catch {
      continue;
    }
  }
  return [...candidates];
}

function sourcePaths(kind: DiscoveryKind): string[] {
  if (kind === "news") {
    return ["/haberler/", "/haberler", "/tr/haberler/", "/tr/haberler", "/TR/haberler/", "/news/", "/news"];
  }
  return ["/etkinlikler/", "/etkinlikler", "/tr/etkinlikler/", "/tr/etkinlikler", "/TR/etkinlikler/", "/events/", "/events"];
}

async function isLikelySourceUrl(url: string, kind: DiscoveryKind): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return false;
    const text = await response.text();
    if (text.length < 300) return false;
    const folded = fold(`${response.url} ${text.slice(0, 20000)}`);
    if (/(404|not found|sayfa bulunamadi|sayfa bulunamadi|page not found)/u.test(folded.slice(0, 5000))) return false;
    if (kind === "news") return folded.includes("haber") || folded.includes("news");
    return folded.includes("etkinlik") || folded.includes("event");
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.7,en;q=0.6",
        "User-Agent": "AcademicCalendarSourceDiscovery/1.0"
      }
    });
  } finally {
    clearTimeout(handle);
  }
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I")
    .toLocaleLowerCase("en-US");
}

async function runWithConcurrency<TInput, TOutput>(items: TInput[], workerCount: number, worker: (item: TInput) => Promise<TOutput>): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workerCount, items.length || 1)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item);
    }
  }));
  return results;
}

function stripBom(input: string): string {
  return input.replace(/^\uFEFF/u, "");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
