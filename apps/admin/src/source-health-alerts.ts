export const sourceHealthStaleAfterMs = 36 * 60 * 60 * 1_000;

export interface AdminSourceHealthInput {
  id: string;
  sourceName: string;
  sourceUrl?: string;
  contentType?: string;
  scopeType?: string;
  scopeId?: string;
  ownerUniversityId?: string;
  ownerFacultyId?: string;
  universityId?: string;
  universityName?: string;
  status?: string;
  healthProbeStatus?: string;
  healthProbeFailureCode?: string;
  lastHealthProbeAt?: string | Date;
  healthProbe?: {
    healthStatus?: string;
    lastCheckedAt?: string | Date;
    lastError?: string;
  };
  healthStatus?: string;
  lastCheckedAt?: string | Date;
  lastError?: string;
}

export interface AdminSourceHealthAlert {
  sourceId: string;
  sourceName: string;
  sourceUrl?: string;
  contentType?: string;
  universityId: string;
  universityName: string;
  status: string;
  severity: "failed" | "degraded" | "stale";
  problem: string;
  lastProbeAt?: string;
  stale: boolean;
}

const healthyStatuses = new Set(["healthy", "ok", "passing"]);
const pendingStatuses = new Set(["pending", "not_tested", "unknown"]);
const failureLabels: Record<string, string> = {
  SOURCE_ACCESS_CHALLENGE: "Kaynak güvenlik doğrulaması istiyor; içerik otomatik olarak okunamıyor.",
  EMPTY_LISTING: "Kaynakta duyuru, haber veya etkinlik bulunamadı.",
  INVALID_CONTENT_TYPE: "Kaynak beklenmeyen içerik türü döndürdü.",
  NO_ITEMS: "Kaynakta duyuru, haber veya etkinlik bulunamadı.",
  PARSER_FAILED: "Veri çekme yöntemi sayfayı ayrıştıramadı.",
  REQUEST_FAILED: "Kaynağa ulaşılamadı.",
  SOURCE_HEALTH_PROBE_EMPTY: "Kaynakta duyuru, haber veya etkinlik bulunamadı.",
  SOURCE_REDIRECT_UNOFFICIAL: "Kaynak güvenilmeyen bir adrese yönlendirdi.",
  SOURCE_REDIRECT_UNSAFE: "Kaynak güvenilmeyen bir adrese yönlendirdi.",
  SOURCE_UNREACHABLE: "Kaynağa ulaşılamadı.",
  UNSAFE_REDIRECT: "Kaynak güvenilmeyen bir adrese yönlendirdi.",
  UNSAFE_URL: "Kaynak adresi güvenlik kontrolünü geçemedi."
};

export function buildSourceHealthAlerts(
  sources: readonly AdminSourceHealthInput[],
  universityNames: Readonly<Record<string, string>> = {},
  now: Date = new Date(),
  staleAfterMs = sourceHealthStaleAfterMs
): AdminSourceHealthAlert[] {
  const uniqueSources = new Map<string, AdminSourceHealthInput>();
  for (const source of sources) uniqueSources.set(source.id, { ...uniqueSources.get(source.id), ...source });

  return [...uniqueSources.values()].flatMap((source) => {
    if (source.status === "inactive" || source.contentType === "academic_calendar") return [];

    const status = (source.healthProbeStatus ?? source.healthProbe?.healthStatus ?? source.healthStatus ?? "pending")
      .toLocaleLowerCase("en-US");
    const rawLastProbeAt = source.lastHealthProbeAt ?? source.healthProbe?.lastCheckedAt ?? source.lastCheckedAt;
    const lastProbeAt = validDate(rawLastProbeAt);
    const stale = !lastProbeAt || now.getTime() - lastProbeAt.getTime() > staleAfterMs;
    const unhealthy = !healthyStatuses.has(status) && !pendingStatuses.has(status);
    if (!unhealthy && !stale) return [];

    const ownerUniversityId = source.ownerUniversityId
      ?? source.universityId
      ?? (source.scopeType === "university" ? source.scopeId : undefined)
      ?? "unknown";
    const universityName = source.universityName
      ?? universityNames[ownerUniversityId]
      ?? (ownerUniversityId === "unknown" ? "Üniversitesi belirlenemedi" : ownerUniversityId);

    return [{
      sourceId: source.id,
      sourceName: source.sourceName,
      ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
      ...(source.contentType ? { contentType: source.contentType } : {}),
      universityId: ownerUniversityId,
      universityName,
      status,
      severity: sourceSeverity(status, stale),
      problem: sourceProblem(source, status, stale, lastProbeAt, staleAfterMs),
      ...(lastProbeAt ? { lastProbeAt: lastProbeAt.toISOString() } : {}),
      stale
    }];
  }).sort(compareSourceHealthAlerts);
}

function sourceSeverity(status: string, stale: boolean): AdminSourceHealthAlert["severity"] {
  if (status === "stale") return "stale";
  if (["failed", "error", "unhealthy", "unsafe", "blocked"].includes(status)) return "failed";
  if (!healthyStatuses.has(status) && !pendingStatuses.has(status)) return "degraded";
  return stale ? "stale" : "degraded";
}

function sourceProblem(
  source: AdminSourceHealthInput,
  status: string,
  stale: boolean,
  lastProbeAt: Date | undefined,
  staleAfterMs: number
): string {
  const code = source.healthProbeFailureCode ?? source.healthProbe?.lastError ?? source.lastError;
  const failure = sourceHealthFailureLabel(code);
  const genericFailure = status === "degraded"
    ? "Kaynak sağlık kontrolü sorunlu sonuçlandı."
    : "Kaynak sağlık kontrolü başarısız oldu.";
  const staleProblem = lastProbeAt
    ? `Günlük sağlık kontrolü ${Math.ceil(staleAfterMs / 3_600_000)} saatten eski.`
    : "Günlük sağlık kontrolü henüz tamamlanmadı.";

  if (failure && stale) return `${failure} ${staleProblem}`;
  return failure ?? (stale ? staleProblem : genericFailure);
}

export function sourceHealthFailureLabel(value: string | undefined): string | undefined {
  const code = value?.trim().toLocaleUpperCase("en-US");
  if (!code) return undefined;
  if (!/^[A-Z0-9_:-]{1,128}$/u.test(code)) return "Kaynak kontrolü teknik bir hata ile sonuçlandı.";
  if (failureLabels[code]) return failureLabels[code];
  if (/(EMPTY|NO_ITEMS)/u.test(code)) return "Kaynakta duyuru, haber veya etkinlik bulunamadı.";
  if (/(TIMEOUT|FETCH|REQUEST|UNREACHABLE|HTTP)/u.test(code)) return "Kaynağa ulaşılamadı.";
  if (/(PARSER|SELECTOR|LAYOUT|RESPONSE_INVALID|JSON_INVALID|FEED_INVALID)/u.test(code)) {
    return "Veri çekme yöntemi sayfayı ayrıştıramadı.";
  }
  if (/(REDIRECT|AUTHORITY|UNSAFE|UNOFFICIAL|DOMAIN_MISMATCH)/u.test(code)) {
    return "Kaynak adresi güvenlik veya resmî alan adı kontrolünü geçemedi.";
  }
  if (/CONTENT_TYPE/u.test(code)) return "Kaynak beklenmeyen içerik türü döndürdü.";
  if (/(DEFINITION_CHANGED|CONFLICT)/u.test(code)) return "Kaynak tanımı kontrol sırasında değişti; yeniden deneyin.";
  return "Kaynak kontrolü teknik bir hata ile sonuçlandı.";
}

function validDate(value: string | Date | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function compareSourceHealthAlerts(left: AdminSourceHealthAlert, right: AdminSourceHealthAlert): number {
  const university = left.universityName.localeCompare(right.universityName, "tr-TR");
  if (university !== 0) return university;
  const source = left.sourceName.localeCompare(right.sourceName, "tr-TR");
  if (source !== 0) return source;
  return left.problem.localeCompare(right.problem, "tr-TR");
}
