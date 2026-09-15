import { describe, expect, it } from "vitest";
import { listVerifiedUniversitySources } from "../src/bootstrap/verified-source-registry.js";
import { parseDeviceSourceRuntimeDocument } from "../../../packages/shared/src/device-source-runtime.js";

const sources = await listVerifiedUniversitySources();

it.each(["announcement", "event"] as const)("Ege %s recipe selects the real list instead of the calendar's Bugün button", (contentType) => {
  const source = sources.find((candidate) => candidate.universityId === "ege-universitesi-izmir")!;
  expect(source[`${contentType}Url`]).toBe("https://egeduyuru.ege.edu.tr/tum_duyurular.html");
  expect(source.parserProfiles?.[contentType]?.parser).toBe("auto");
  const items = parseDeviceSourceRuntimeDocument(`<a href="/?date=2026-09-15">Bugün</a><table><tr>
    ${["Konu", "Türü", "Başlangıç Tarihi", "Düzenlenme Yeri", "Gönderen Birim", "Görüntüle"].map(label => `<th class="thbaslik">${label}</th>`).join("")}
    </tr><tr><td class="tdbaslik">2024 Proje Dönemi başvuru sonuçları</td><td class="tdbaslik">Genel</td>
    <td class="tdbaslik">11-09-2026</td><td class="tdbaslik">Ege Üniversitesi</td><td class="tdbaslik">Rektörlük</td>
    <td class="tdbaslik"><button onclick="icerikGetir(19963)">Görüntüle</button></td></tr>
    <tr><td class="tdbaslik">MATLAB Araçları Tanıtım Toplantısı</td><td class="tdbaslik">Toplantı/Kurultay</td>
    <td class="tdbaslik">16-09-2026</td><td class="tdbaslik">MS Teams</td><td class="tdbaslik">Rektörlük</td>
    <td class="tdbaslik"><button onclick="icerikGetir(20188)">Görüntüle</button></td></tr></table>`, {
    sourceUrl: source[`${contentType}Url`]!, allowedOfficialDomain: "ege.edu.tr", contentType, parser: "auto",
    checkedAt: "2026-09-15T12:00:00.000Z",
  });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    title: contentType === "event" ? "MATLAB Araçları Tanıtım Toplantısı" : "2024 Proje Dönemi başvuru sonuçları",
    link: `https://egeduyuru.ege.edu.tr/icerikgoster_5.php?id=${contentType === "event" ? "20188" : "19963"}`,
    keyDates: [{ label: contentType === "event" ? "Etkinlik tarihi" : "Başlangıç tarihi", startDate: contentType === "event" ? "2026-09-16" : "2026-09-11" }],
  });
  expect(items[0]?.publishedDate).toBeUndefined();
  expect(items[0]?.publishedAt).toBeUndefined();
});

it("Ege news uses the official university RSS domain and keeps publication dates", () => {
  const source = sources.find((candidate) => candidate.universityId === "ege-universitesi-izmir")!;
  expect(source.newsUrl).toBe("https://egeajans.ege.edu.tr/index.php/feed/");
  expect(source.parserProfiles?.news?.parser).toBe("rss");
  const items = parseDeviceSourceRuntimeDocument(`<rss><channel><title>Ege Ajans</title>
    <link>https://egeajans.ege.edu.tr/</link><item><title>Yeni Akademik Yıl Açılışı</title>
    <link>https://egeajans.ege.edu.tr/index.php/2026/09/15/acilis/</link>
    <pubDate>Tue, 15 Sep 2026 06:45:42 +0000</pubDate></item></channel></rss>`, {
    sourceUrl: source.newsUrl!, allowedOfficialDomain: "ege.edu.tr", contentType: "news", parser: "rss",
    checkedAt: "2026-09-15T12:00:00.000Z",
  });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ title: "Yeni Akademik Yıl Açılışı", publishedAt: "2026-09-15T06:45:42.000Z" });
});

describe("Bartın official archive profiles", () => {
  it.each([
    ["announcement", "duyurular"],
    ["news", "haberler"],
    ["event", "etkinlikler"],
  ] as const)("reads %s titles and dates without monthly archive navigation", (contentType, route) => {
    const source = sources.find((candidate) => candidate.universityId === "bartin-universitesi")!;
    const sourceUrl = source[`${contentType}Url`]!;
    const profile = source.parserProfiles![contentType]!;
    const listedDate = contentType === "event" ? "19/11/2026" : "11/09/2026";
    const items = parseDeviceSourceRuntimeDocument(`<main>
      <li class="list-group-item"><a href="/arsiv/2026/9/${route}-arsiv.html">2026/9 13</a></li>
      <li class="list-group-item"><div class="row col-12"><div class="col-2">${listedDate}</div>
      <div class="col-10"><a href="/${route}/yeni-akademik-yil.html">Yeni Akademik Yıl Bilgilendirmesi</a></div></div></li>
      <li class="list-group-item"><div class="row col-12"><div class="col-2">11/09/2026</div>
      <div class="col-10"><a href="https://untrusted.invalid/${route}/foreign.html">Kurum Dışı İçerik</a></div></div></li>
      </main>`, {
      sourceUrl, allowedOfficialDomain: "bartin.edu.tr", contentType, parser: profile.parser,
      ...(profile.parserConfig ? { parserConfig: profile.parserConfig } : {}),
      checkedAt: "2026-09-15T12:00:00.000Z",
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Yeni Akademik Yıl Bilgilendirmesi",
      link: `https://www.bartin.edu.tr/${route}/yeni-akademik-yil.html` });
    if (contentType === "event") {
      expect(items[0]?.keyDates).toEqual([{ label: "Etkinlik tarihi", startDate: "2026-11-19" }]);
      expect(items[0]?.publishedDate).toBeUndefined();
      expect(items[0]?.publishedAt).toBeUndefined();
    } else {
      expect(items[0]?.publishedDate).toBe("2026-09-11");
    }
  });
});
