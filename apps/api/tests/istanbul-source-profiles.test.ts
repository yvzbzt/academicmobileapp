import { expect, it } from "vitest";
import { listVerifiedUniversitySources } from "../src/bootstrap/verified-source-registry.js";
import { parseDeviceSourceRuntimeDocument } from "../../../packages/shared/src/device-source-runtime.js";

const source = (await listVerifiedUniversitySources()).find(candidate => candidate.universityId === "istanbul-universitesi")!;

it("uses only the official newspaper's university category as news, not as announcements or events", () => {
  expect(source.newsUrl).toBe("https://iletim.istanbul.edu.tr/index.php/category/universite/feed/");
  expect(source.parserProfiles).toEqual({ news: { parser: "rss" } });
  expect(source.announcementUrl).toBeUndefined();
  expect(source.eventUrl).toBeUndefined();
});

it("reads actual RSS headlines, publication timestamps and clean summaries while rejecting outside links", () => {
  const items = parseDeviceSourceRuntimeDocument(`<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><title>İstanbul Üniversitesi – İletim</title>
      <link>https://iletim.istanbul.edu.tr/index.php/category/universite/</link>
      <item><title>İstanbul Üniversitesi Ailece Tercih Günleri Başladı</title>
        <link>https://iletim.istanbul.edu.tr/index.php/2026/07/22/istanbul-universitesi-ailece-tercih-gunleri-basladi/</link>
        <pubDate>Wed, 22 Jul 2026 17:05:55 +0000</pubDate>
        <category><![CDATA[İstanbul Üniversitesi]]></category>
        <description><![CDATA[<p>İstanbul, (İÜ Haber Merkezi) – Üniversite adayları ve aileleri için tanıtım günleri düzenledi.</p>]]></description>
      </item>
      <item><title>Kurum dışı haber bağlantısı</title><link>https://untrusted.invalid/haber</link>
        <pubDate>Wed, 22 Jul 2026 17:05:55 +0000</pubDate></item>
    </channel></rss>`, {
    sourceUrl: source.newsUrl!,
    allowedOfficialDomain: "istanbul.edu.tr",
    contentType: "news",
    parser: source.parserProfiles!.news!.parser,
    checkedAt: "2026-09-15T17:00:00.000Z"
  });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    title: "İstanbul Üniversitesi Ailece Tercih Günleri Başladı",
    link: "https://iletim.istanbul.edu.tr/index.php/2026/07/22/istanbul-universitesi-ailece-tercih-gunleri-basladi",
    publishedAt: "2026-07-22T17:05:55.000Z",
    publicationKind: "timestamp",
    summary: "İstanbul, (İÜ Haber Merkezi) – Üniversite adayları ve aileleri için tanıtım günleri düzenledi."
  });
  expect(items[0]?.keyDates).toBeUndefined();
});
