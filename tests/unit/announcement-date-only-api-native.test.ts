import { describe, expect, it } from "vitest";
import {
  parseGenericAnnouncementHtml,
  toAnnouncementItems
} from "../../apps/api/src/modules/announcements/announcement-parser.js";
import { toTrustedAcademicContentDto } from "../../apps/api/src/modules/announcements/announcement-content-trust.js";
import type { AnnouncementSourceRecord } from "../../apps/api/src/modules/announcements/announcements.types.js";
import { buildContentFeed } from "../../apps/mobile-native/src/announcements/feed-model";
import {
  contentTimestampLabel,
  normalizeTrustedContentCollection
} from "../../apps/mobile-native/src/content/content-trust";

describe("announcement date-only API-to-native semantics", () => {
  it("preserves an Istanbul calendar date through parser, trusted DTO, feed, and detail label without a clock", () => {
    const source = trustedSource();
    const parsed = parseGenericAnnouncementHtml(`
      <main>
        <article>
          <time datetime="2026-08-04">4 Ağustos 2026</time>
          <a href="/duyuru/kayit">Öğrenci kayıt duyurusu</a>
          <p class="summary">Başvurular çevrim içi alınacaktır.</p>
        </article>
      </main>
    `, source.sourceUrl);
    const [item] = toAnnouncementItems(source, parsed, new Date("2026-08-04T10:00:00.000Z"));
    expect(item).toEqual(expect.objectContaining({
      publicationKind: "date",
      publishedDate: "2026-08-04",
      publicationTimeSource: "source"
    }));
    expect(item).not.toHaveProperty("publishedAt");

    const dto = toTrustedAcademicContentDto(item!, source);
    expect(dto).toEqual(expect.objectContaining({
      publicationKind: "date",
      publishedDate: "2026-08-04"
    }));
    expect(dto).not.toHaveProperty("publishedAt");

    const [native] = normalizeTrustedContentCollection([dto!]).items;
    const [feedItem] = buildContentFeed({ academic: [native!], yok: [], summerSchool: [] });
    const detailLabel = contentTimestampLabel(native!);
    expect(feedItem).toEqual(expect.objectContaining({
      displayTimestamp: "2026-08-04",
      displayTimestampKind: "published"
    }));
    expect(detailLabel).toBe("Yayınlandı 04 Ağu 2026");
    expect(dto).not.toHaveProperty("publishedAt");
    expect(detailLabel).not.toMatch(/(?:00:00|03:00|03 Ağu|05 Ağu)/u);
  });

  it.each([
    ["04.08.2026", "numeric"],
    ["04.08.2026 14:30", "numeric trailing clock without zone"],
    ["4 Ağustos 2026", "Turkish"],
    ["4 Ağustos 2026 saat 14.30", "Turkish trailing clock without zone"]
  ])("keeps a %s source calendar value as date-only (%s)", (sourceValue, slug) => {
    const source = trustedSource();
    const parsed = parseGenericAnnouncementHtml(`
      <article>
        <time>${sourceValue}</time>
        <a href="/duyuru/${slug.replace(/\s+/gu, "-")}">Kayıt başvurusu duyurusu</a>
      </article>
    `, source.sourceUrl);
    expect(parsed[0]).toEqual(expect.objectContaining({
      publicationKind: "date",
      publishedDate: "2026-08-04"
    }));
    expect(parsed[0]).not.toHaveProperty("publishedAt");
  });

  it("retains a source timestamp only when an explicit clock and offset are present", () => {
    const source = trustedSource();
    const parsed = parseGenericAnnouncementHtml(`
      <article>
        <time datetime="2026-08-04T14:30:00+03:00">4 Ağustos 2026 14:30</time>
        <a href="/duyuru/saatli">Saatli kayıt duyurusu</a>
      </article>
    `, source.sourceUrl);
    expect(parsed[0]?.publicationKind).toBe("timestamp");
    expect(parsed[0]?.publishedAt?.toISOString()).toBe("2026-08-04T11:30:00.000Z");
    expect(parsed[0]).not.toHaveProperty("publishedDate");
  });
});

function trustedSource(): AnnouncementSourceRecord {
  const now = new Date("2026-08-04T08:00:00.000Z");
  return {
    id: "source-1",
    scopeType: "university",
    scopeId: "university-1",
    sourceName: "Örnek Üniversitesi",
    sourceUrl: "https://www.example.edu.tr/duyurular",
    canonicalUrl: "https://www.example.edu.tr/duyurular",
    contentType: "announcement",
    parser: "html",
    priority: 20,
    status: "active",
    trustStatus: "trusted",
    createdAt: now,
    updatedAt: now
  };
}
