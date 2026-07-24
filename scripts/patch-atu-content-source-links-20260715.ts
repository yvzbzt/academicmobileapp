import { readFile, writeFile } from "node:fs/promises";

const universitySourcesPath = "apps/api/src/bootstrap/verified-university-sources.json";
const academicUnitSourcesPath = "apps/api/src/bootstrap/verified-academic-unit-sources.json";
const atuId = "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi";

type UniversitySource = {
  universityId: string;
  announcementUrl?: string | null;
  newsUrl?: string | null;
  eventUrl?: string | null;
  calendarUrl?: string | null;
  announcementStatus?: string | null;
  newsStatus?: string | null;
  eventStatus?: string | null;
  calendarStatus?: string | null;
  unmappedContentUrls?: string[];
};

type AcademicUnitSource = {
  universityId: string;
  websiteUrl?: string;
  announcementUrl?: string | null;
  newsUrl?: string | null;
  eventUrl?: string | null;
};

const atuUniversityPatch = {
  announcementUrl: "https://www.atu.edu.tr/#!/TR/duyurular/",
  newsUrl: "https://www.atu.edu.tr/#!/TR/haberler/",
  calendarUrl: "https://www.atu.edu.tr/#!/sayfa/2061/51/f4d5eeb2-c7bf-4f04-b8d6-720c00de186f/",
  announcementStatus: "source_found",
  newsStatus: "source_found",
  eventStatus: "source_not_found",
  calendarStatus: "source_found"
};

const atuUnitPatches: Record<string, { announcementUrl?: string; newsUrl?: string; eventUrl?: string }> = {
  "https://bbf.atu.edu.tr/": { newsUrl: "https://bbf.atu.edu.tr/#!/TR/haberler/" },
  "https://compeng.atu.edu.tr/": { announcementUrl: "https://compeng.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://compeng.atu.edu.tr/#!/TR/haberler/" },
  "https://yazilim.atu.edu.tr/": { announcementUrl: "https://yazilim.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://yazilim.atu.edu.tr/#!/TR/haberler/" },
  "https://yapayzeka.atu.edu.tr/": { announcementUrl: "https://yapayzeka.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://yapayzeka.atu.edu.tr/#!/TR/haberler/" },
  "https://vba.atu.edu.tr/": { announcementUrl: "https://vba.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://vba.atu.edu.tr/#!/TR/haberler/" },
  "https://bst.atu.edu.tr/": { announcementUrl: "https://bst.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://bst.atu.edu.tr/#!/TR/haberler/" },
  "https://bgt.atu.edu.tr/": { announcementUrl: "https://bgt.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://bgt.atu.edu.tr/#!/TR/haberler/" },
  "https://hubf.atu.edu.tr/": { announcementUrl: "https://hubf.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://hubf.atu.edu.tr/#!/TR/haberler/" },
  "https://havacilik.atu.edu.tr/": { announcementUrl: "https://havacilik.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://havacilik.atu.edu.tr/#!/TR/haberler/" },
  "https://meteoroloji.atu.edu.tr/": { announcementUrl: "https://meteoroloji.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://meteoroloji.atu.edu.tr/#!/TR/haberler/" },
  "https://havacilikyonetimi.atu.edu.tr/": { announcementUrl: "https://havacilikyonetimi.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://havacilikyonetimi.atu.edu.tr/#!/TR/haberler/" },
  "https://iisbf.atu.edu.tr/": { newsUrl: "https://iisbf.atu.edu.tr/#!/TR/haberler/", eventUrl: "https://iisbf.atu.edu.tr/#!/TR/etkinlikler/" },
  "https://mis.atu.edu.tr/": { announcementUrl: "https://mis.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://mis.atu.edu.tr/#!/TR/haberler/" },
  "https://intf.atu.edu.tr/": { announcementUrl: "https://intf.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://intf.atu.edu.tr/#!/TR/haberler/" },
  "https://isletme.atu.edu.tr/": { announcementUrl: "https://isletme.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://isletme.atu.edu.tr/#!/TR/haberler/" },
  "https://tourism.atu.edu.tr/": { announcementUrl: "https://tourism.atu.edu.tr/#!/TR/duyurular/" },
  "https://psapa.atu.edu.tr/": { announcementUrl: "https://psapa.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://psapa.atu.edu.tr/#!/TR/haberler/" },
  "https://intrel.atu.edu.tr/": { newsUrl: "https://intrel.atu.edu.tr/#!/TR/haberler/", eventUrl: "https://intrel.atu.edu.tr/#!/TR/etkinlikler/" },
  "https://psych.atu.edu.tr/": { announcementUrl: "https://psych.atu.edu.tr/#!/TR/duyurular/" },
  "https://mtb.atu.edu.tr/": { announcementUrl: "https://mtb.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://mtb.atu.edu.tr/#!/TR/haberler/" },
  "https://gastronomi.atu.edu.tr/": { announcementUrl: "https://gastronomi.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://gastronomi.atu.edu.tr/#!/TR/haberler/" },
  "https://mtf.atu.edu.tr/": { announcementUrl: "https://mtf.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://mtf.atu.edu.tr/#!/TR/haberler/", eventUrl: "https://mtf.atu.edu.tr/#!/TR/etkinlikler/" },
  "https://mimarlik.atu.edu.tr/": { announcementUrl: "https://mimarlik.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://mimarlik.atu.edu.tr/#!/TR/haberler/", eventUrl: "https://mimarlik.atu.edu.tr/#!/TR/etkinlikler/" },
  "https://mf.atu.edu.tr/": { announcementUrl: "https://mf.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://mf.atu.edu.tr/#!/TR/haberler/" },
  "https://eee.atu.edu.tr/": { announcementUrl: "https://eee.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://eee.atu.edu.tr/#!/TR/haberler/" },
  "https://ieng.atu.edu.tr/": { announcementUrl: "https://ieng.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://ieng.atu.edu.tr/#!/TR/haberler/" },
  "https://enerji.atu.edu.tr/": { announcementUrl: "https://enerji.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://enerji.atu.edu.tr/#!/TR/haberler/" },
  "https://food.atu.edu.tr/": { announcementUrl: "https://food.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://food.atu.edu.tr/#!/TR/haberler/" },
  "https://civeng.atu.edu.tr/": { announcementUrl: "https://civeng.atu.edu.tr/#!/TR/duyurular/" },
  "https://mech.atu.edu.tr/": { announcementUrl: "https://mech.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://mech.atu.edu.tr/#!/TR/haberler/" },
  "https://mateng.atu.edu.tr/": { announcementUrl: "https://mateng.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://mateng.atu.edu.tr/#!/TR/haberler/", eventUrl: "https://mateng.atu.edu.tr/#!/TR/etkinlikler/" },
  "https://bilisimtekmyo.atu.edu.tr/": { announcementUrl: "https://bilisimtekmyo.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://bilisimtekmyo.atu.edu.tr/#!/TR/haberler/" },
  "https://bioeng.atu.edu.tr/": { announcementUrl: "https://bioeng.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://bioeng.atu.edu.tr/#!/TR/haberler/", eventUrl: "https://bioeng.atu.edu.tr/#!/TR/etkinlikler/" },
  "https://maden.atu.edu.tr/": { newsUrl: "https://maden.atu.edu.tr/#!/TR/haberler/" },
  "https://uygulamagelistirme.atu.edu.tr/": { announcementUrl: "https://uygulamagelistirme.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://uygulamagelistirme.atu.edu.tr/#!/TR/haberler/" },
  "https://vtagtasarim.atu.edu.tr/": { announcementUrl: "https://vtagtasarim.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://vtagtasarim.atu.edu.tr/#!/TR/haberler/", eventUrl: "https://vtagtasarim.atu.edu.tr/#!/TR/etkinlikler/" },
  "https://istatistik.atu.edu.tr/": { announcementUrl: "https://istatistik.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://istatistik.atu.edu.tr/#!/TR/haberler/" },
  "https://elektronikotomasyon.atu.edu.tr/": { announcementUrl: "https://elektronikotomasyon.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://elektronikotomasyon.atu.edu.tr/#!/TR/haberler/" },
  "https://yadyo.atu.edu.tr/": { announcementUrl: "https://yadyo.atu.edu.tr/#!/TR/duyurular/", newsUrl: "https://yadyo.atu.edu.tr/#!/TR/haberler/" }
};

async function main() {
  const universities = JSON.parse(stripBom(await readFile(universitySourcesPath, "utf8"))) as UniversitySource[];
  const academicUnits = JSON.parse(stripBom(await readFile(academicUnitSourcesPath, "utf8"))) as AcademicUnitSource[];

  const university = universities.find((record) => record.universityId === atuId);
  if (!university) throw new Error(`ATU source record not found: ${atuId}`);
  Object.assign(university, atuUniversityPatch);

  const patchedWebsites = new Set<string>();
  for (const unit of academicUnits) {
    if (unit.universityId !== atuId || !unit.websiteUrl) continue;
    const patch = atuUnitPatches[normalizeUrl(unit.websiteUrl)];
    if (!patch) continue;
    Object.assign(unit, patch);
    patchedWebsites.add(normalizeUrl(unit.websiteUrl));
  }

  const unmatched = Object.keys(atuUnitPatches).filter((url) => !patchedWebsites.has(normalizeUrl(url)));
  university.unmappedContentUrls = unmatched;

  await writeFile(universitySourcesPath, `${JSON.stringify(universities, null, 2)}\n`, "utf8");
  await writeFile(academicUnitSourcesPath, `${JSON.stringify(academicUnits, null, 2)}\n`, "utf8");

  console.log(`Patched ATU university source and ${patchedWebsites.size} academic-unit source records.`);
  if (unmatched.length > 0) {
    console.log("Unmatched ATU content URLs:");
    for (const url of unmatched) console.log(`- ${url}`);
  }
}

function normalizeUrl(input: string): string {
  return input.replace(/#.*$/u, "").replace(/\/+$/u, "/");
}

function stripBom(input: string): string {
  return input.replace(/^\uFEFF/u, "");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
