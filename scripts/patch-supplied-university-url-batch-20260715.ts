import { readFile, writeFile } from "node:fs/promises";

type UnitType = "faculty" | "institute" | "school" | "vocational_school" | "academic_unit" | "department";

interface UrlBatch {
  universityId: string;
  name: string;
  homepageUrl: string;
  lookup: string[];
  source: string;
}

interface CatalogSeed {
  universities: SeedUniversity[];
}

interface SeedUniversity {
  name: string;
  slug: string;
  faculties: SeedFaculty[];
}

interface SeedFaculty {
  name: string;
  slug: string;
  departments: SeedDepartment[];
}

interface SeedDepartment {
  name: string;
  slug: string;
}

interface FacultyTreeRecord {
  name: string;
  url: string;
  unitType?: UnitType;
  sourcePageUrl?: string;
  confidence?: number;
  departments?: FacultyTreeRecord[];
  [key: string]: unknown;
}

interface FacultyTreeFile {
  generatedAt: string;
  summary?: Record<string, unknown>;
  universities: Array<{
    name?: string;
    homepageUrl?: string;
    finalHomepageUrl?: string;
    hostname?: string;
    status?: string;
    checkedPageCount?: number;
    facultyCount?: number;
    faculties?: FacultyTreeRecord[];
    errors?: string[];
    cleanup?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
}

interface VerifiedAcademicUnitSource {
  scopeType: "faculty" | "department";
  universityId: string;
  universityName?: string;
  facultyId?: string;
  facultyName?: string;
  departmentId?: string;
  departmentName?: string;
  websiteUrl?: string;
  announcementUrl?: string;
  courseScheduleUrl?: string;
  examScheduleUrl?: string;
}

interface LinkCandidate {
  url: string;
  order: number;
  text: string;
  title?: string;
}

interface PatchResult {
  batch: UrlBatch;
  facultyUrls: Map<string, string>;
  departmentUrls: Map<string, Map<string, string>>;
  unmatchedUrls: string[];
}

const treePath = "data/yok-university-faculty-tree.json";
const registryPath = "apps/api/src/bootstrap/verified-academic-unit-sources.json";
const catalogPath = "apps/api/src/bootstrap/turkiye-catalog-seed.json";
const shouldFetchTitles = process.env.URL_BATCH_FETCH_TITLES === "true";
const fetchTimeoutMs = Number(process.env.URL_BATCH_FETCH_TIMEOUT_MS ?? 7000);
const fetchConcurrency = Number(process.env.URL_BATCH_FETCH_CONCURRENCY ?? 12);

const batches: UrlBatch[] = [
  attachmentBatch("balikesir-universitesi", "BALIKESİR ÜNİVERSİTESİ", "https://www.balikesir.edu.tr/", ["balikesir.edu.tr"], "C:/Users/buyuk/.codex/attachments/ff82dbd7-a0d0-47ea-94d6-69bd8bd6c8eb/pasted-text.txt"),
  attachmentBatch("baskent-universitesi-ankara", "BAŞKENT ÜNİVERSİTESİ", "https://www.baskent.edu.tr/tr/", ["baskent.edu.tr"], "C:/Users/buyuk/.codex/attachments/7ef99132-d4d0-43ce-bd16-5330c0d2d42b/pasted-text.txt"),
  attachmentBatch("bayburt-universitesi", "BAYBURT ÜNİVERSİTESİ", "https://bayburt.edu.tr/tr", ["bayburt.edu.tr"], "C:/Users/buyuk/.codex/attachments/c826ed4b-6c3f-43d1-a76f-c06f095b5a89/pasted-text.txt"),
  attachmentBatch("bitlis-eren-universitesi", "BİTLİS EREN ÜNİVERSİTESİ", "https://www.beu.edu.tr/", ["beu.edu.tr"], "C:/Users/buyuk/.codex/attachments/18b99570-9ef2-41a7-ae00-dc587c5bc9af/pasted-text.txt"),
  {
    universityId: "bahcesehir-universitesi-istanbul",
    name: "BAHÇEŞEHİR ÜNİVERSİTESİ",
    homepageUrl: "https://www.bahcesehir.edu.tr/",
    lookup: ["bahcesehir.edu.tr", "bau.edu.tr"],
    source: `
https://bau.edu.tr/
https://bau.edu.tr/akademik/12568-yabanci-diller-yuksekokulu
https://bau.edu.tr/akademik/12618-saglik-hizmetleri-meslek-yuksekokulu
https://bau.edu.tr/icerik/14403-agiz-ve-dis-sagligi
https://bau.edu.tr/icerik/12701-anestezi-programi
https://bau.edu.tr/icerik/14404-dis-protez-teknolojisi
https://bau.edu.tr/icerik/12705-fizyoterapi
https://bau.edu.tr/icerik/12698-ilk-ve-acil-yardim-programi
https://bau.edu.tr/icerik/14405-optisyenlik
https://bau.edu.tr/icerik/12703-tibbi-laboratuvar-teknikleri
https://bau.edu.tr/icerik/12707-yurt-disi-egitim-programlari
https://bau.edu.tr/akademik/12569-uygulamali-bilimler-yuksekokulu
https://bau.edu.tr/icerik/10653-uygulamali-bilimler-yuksekokulu-gastronomi
https://bau.edu.tr/icerik/17059-uygulamali-bilimler-yuksekokulu-gastronomi-ve-mutfak-sanatlari
https://bau.edu.tr/icerik/14385-pilotaj
https://bau.edu.tr/akademik/12550-konservatuvar
https://bau.edu.tr/icerik/15561-muzik-bolumu-hakkinda
https://bau.edu.tr/icerik/15560-sahne-sanatlari-bolumu-hakkinda
https://bau.edu.tr/icerik/17174-muzik-teknolojisi
https://bau.edu.tr/icerik/18455-ses-egitimi-bolumu-hakkinda
https://bau.edu.tr/akademik/12545-dis-hekimligi-fakultesi
https://bau.edu.tr/akademik/12628-eczacilik-fakultesi
https://bau.edu.tr/akademik/12547-egitim-bilimleri-fakultesi
https://bau.edu.tr/icerik/3369-psikolojik-danismanlik-ve-rehberlik
https://bau.edu.tr/icerik/3048-ilkogretim-bolumu
https://bau.edu.tr/icerik/2680-yabanci-diller-egitimi-bolumu
https://bau.edu.tr/icerik/3312-bilgisayar-ve-ogretim-teknolojileri-egitimi
https://bau.edu.tr/akademik/12548-hukuk-fakultesi
https://bau.edu.tr/akademik/12549-iletisim-fakultesi
https://bau.edu.tr/icerik/11878-iletisim-fakultesi-cizgi-film-ve-animasyon
https://bau.edu.tr/icerik/10427-iletisim-fakultesi-dijital-oyun-tasarimi
https://bau.edu.tr/icerik/3907-iletisim-ve-tasarimi
https://bau.edu.tr/icerik/3906-halkla-iliskiler-ve-tanitim
https://bau.edu.tr/icerik/3905-reklamcilik
https://bau.edu.tr/icerik/3767-sinema-ve-televizyon
https://bau.edu.tr/icerik/3904-yeni-medya
https://bau.edu.tr/akademik/12546-iktisadi-idari-ve-sosyal-bilimler-fakultesi
https://bau.edu.tr/icerik/3419-isletme
https://bau.edu.tr/icerik/4180-ekonomi
https://bau.edu.tr/icerik/3913-uluslararasi-ticaret-ve-isletmecilik
https://bau.edu.tr/icerik/3914-uluslararasi-finans
https://bau.edu.tr/icerik/4417-ekonomi-ve-finans
https://bau.edu.tr/icerik/4392-lojistik-yonetimi
https://bau.edu.tr/icerik/8914-siyaset-bilimi-ve-uluslararasi-iliskiler-hakkinda
https://bau.edu.tr/icerik/3148-fen-edebiyat-fakultesi-sosyoloji
https://bau.edu.tr/icerik/2728-fen-edebiyat-fakultesi-psikoloji
https://bau.edu.tr/icerik/17176-mutercim-ve-tercumanlik
https://bau.edu.tr/akademik/12551-mimarlik-ve-tasarim-fakultesi
https://bau.edu.tr/icerik/3897-mimarlik
https://bau.edu.tr/icerik/3896-ic-mimarlik-ve-cevre-tasarimi
https://bau.edu.tr/icerik/3410-endustri-urunleri-tasarimi
https://bau.edu.tr/akademik/12552-muhendislik-ve-doga-bilimleri-fakultesi
https://bau.edu.tr/icerik/18540-bilgi-guvenligi-teknolojisi
https://bau.edu.tr/icerik/3890-bilgisayar-muhendisligi
https://bau.edu.tr/icerik/3124-biyomedikal-muhendisligi
https://bau.edu.tr/icerik/3888-elektrik-elektronik-muhendisligi
https://bau.edu.tr/icerik/3348-endustri-muhendisligi
https://bau.edu.tr/icerik/3128-enerji-sistemleri-muhendisligi
https://bau.edu.tr/icerik/2817-insaat-muhendisligi
https://bau.edu.tr/icerik/2933-isletme-muhendisligi
https://bau.edu.tr/icerik/3146-mekatronik-muhendisligi
http://bahcesehir.edu.tr/icerik/3307-fen-edebiyat-fakultesi-genetik-ve-biyoinformatik-bolumu
https://bau.edu.tr/icerik/15822-yapay-zeka-muhendisligi
https://bau.edu.tr/icerik/3885-yazilim-muhendisligi
https://bau.edu.tr/akademik/12553-saglik-bilimleri-fakultesi
https://bau.edu.tr/icerik/2799-beslenme-ve-diyetetik
https://bau.edu.tr/icerik/16537-dil-ve-konusma-terapisi
https://bau.edu.tr/icerik/3575-fizyoterapi-ve-rehabilitasyon
https://bau.edu.tr/icerik/3576-hemsirelik
https://bau.edu.tr/icerik/10435-odyoloji
https://bau.edu.tr/akademik/12554-tip-fakultesi`
  },
  {
    universityId: "batman-universitesi",
    name: "BATMAN ÜNİVERSİTESİ",
    homepageUrl: "https://batman.edu.tr/",
    lookup: ["batman.edu.tr"],
    source: `
https://batman.edu.tr/
https://batman.edu.tr/Birimler/dhf
https://batman.edu.tr/Birimler/1673
https://batman.edu.tr/Birimler/1678
https://batman.edu.tr/Birimler/1675
https://batman.edu.tr/Birimler/1674
https://batman.edu.tr/Birimler/1680
https://batman.edu.tr/Birimler/1676
https://batman.edu.tr/Birimler/1677
https://batman.edu.tr/Birimler/1679
https://batman.edu.tr/Birimler/fef
https://batman.edu.tr/Birimler/1395
https://batman.edu.tr/Birimler/1383
https://batman.edu.tr/Birimler/1388
https://batman.edu.tr/Birimler/1386
https://batman.edu.tr/Birimler/1435
https://batman.edu.tr/Birimler/1387
https://batman.edu.tr/Birimler/1392
https://batman.edu.tr/Birimler/1393
https://batman.edu.tr/Birimler/1385
https://batman.edu.tr/Birimler/1394
https://batman.edu.tr/Birimler/1384
https://batman.edu.tr/Birimler/1390
https://batman.edu.tr/Birimler/1381
https://batman.edu.tr/Birimler/gsf
https://batman.edu.tr/Birimler/iibf
https://batman.edu.tr/Birimler/1398
https://batman.edu.tr/Birimler/1399
https://batman.edu.tr/Birimler/1401
https://batman.edu.tr/Birimler/1402
https://batman.edu.tr/Birimler/1702
https://batman.edu.tr/Birimler/iif
https://batman.edu.tr/Birimler/1413
https://batman.edu.tr/Birimler/1412
https://batman.edu.tr/Birimler/1411
https://batman.edu.tr/Birimler/mmf
https://batman.edu.tr/Birimler/1362
https://batman.edu.tr/Birimler/1363
https://batman.edu.tr/Birimler/1364
https://batman.edu.tr/Birimler/1373
https://batman.edu.tr/Birimler/1365
https://batman.edu.tr/Birimler/1375
https://batman.edu.tr/Birimler/1378
https://batman.edu.tr/Birimler/sbf
https://batman.edu.tr/Birimler/1574
https://batman.edu.tr/Birimler/1575
https://batman.edu.tr/Birimler/1576
https://batman.edu.tr/Birimler/1577
https://batman.edu.tr/Birimler/1573
https://batman.edu.tr/Birimler/1578
https://batman.edu.tr/Birimler/1579
https://batman.edu.tr/Birimler/1437
https://batman.edu.tr/Birimler/1441
https://batman.edu.tr/Birimler/1438
https://batman.edu.tr/Birimler/1440
https://batman.edu.tr/Birimler/tf
https://batman.edu.tr/Birimler/turizm
https://batman.edu.tr/Birimler/1430
https://batman.edu.tr/Birimler/1525
https://batman.edu.tr/Birimler/1429
https://batman.edu.tr/Birimler/1432
https://batman.edu.tr/Birimler/bosmy
https://batman.edu.tr/Birimler/1496
https://batman.edu.tr/Birimler/1498
https://batman.edu.tr/Birimler/1497
https://batman.edu.tr/Birimler/1499
https://batman.edu.tr/Birimler/hmy
https://batman.edu.tr/Birimler/1481
https://batman.edu.tr/Birimler/kmy
https://batman.edu.tr/Birimler/1484
https://batman.edu.tr/Birimler/1487
https://batman.edu.tr/Birimler/1485
https://batman.edu.tr/Birimler/1708
https://batman.edu.tr/Birimler/1488
https://batman.edu.tr/Birimler/1486
https://batman.edu.tr/Birimler/shmy
https://batman.edu.tr/Birimler/1452
https://batman.edu.tr/Birimler/1453
https://batman.edu.tr/Birimler/1454
https://batman.edu.tr/Birimler/1455
https://batman.edu.tr/Birimler/1456
http://batman.edu.tr/Birimler/smy
https://batman.edu.tr/Birimler/1490
https://batman.edu.tr/Birimler/1491
https://batman.edu.tr/Birimler/1492
https://batman.edu.tr/Birimler/1493
https://batman.edu.tr/Birimler/1494
https://batman.edu.tr/Birimler/tbmy
https://batman.edu.tr/Birimler/1459
https://batman.edu.tr/Birimler/1462
https://batman.edu.tr/Birimler/1463
https://batman.edu.tr/Birimler/1461
https://batman.edu.tr/Birimler/1464
https://batman.edu.tr/Birimler/1465
https://batman.edu.tr/Birimler/1466
https://batman.edu.tr/Birimler/1458
https://batman.edu.tr/Birimler/1471
https://batman.edu.tr/Birimler/1468
https://batman.edu.tr/Birimler/1469
https://batman.edu.tr/Birimler/1470
https://batman.edu.tr/Birimler/1581`
  },
  {
    universityId: "bogazici-universitesi-istanbul",
    name: "BOĞAZİÇİ ÜNİVERSİTESİ",
    homepageUrl: "https://www.bogazici.edu.tr/tr",
    lookup: ["bogazici.edu.tr", "boun.edu.tr"],
    source: `
https://bogazici.edu.tr/tr
https://fed.bogazici.edu.tr/tr
https://cet.bogazici.edu.tr/tr
https://ed.bogazici.edu.tr/tr
https://pred.bogazici.edu.tr/tr
https://sced.bogazici.edu.tr/tr
http://fled.bogazici.edu.tr/
https://fen.bogazici.edu.tr/tr
https://phys.bogazici.edu.tr/tr
https://chem.bogazici.edu.tr/?lang=tr
https://math.bogazici.edu.tr/tr
https://mbg.bogazici.edu.tr/
https://hf.bogazici.edu.tr/
https://iibf.bogazici.edu.tr/
https://econ.bogazici.edu.tr/tr
https://mgmt.bogazici.edu.tr/tr
https://pols.bogazici.edu.tr/?q=tr
https://tourism.bogazici.edu.tr/
https://intt.bogazici.edu.tr/
https://mis.bogazici.edu.tr/
https://itbf.bogazici.edu.tr/
https://sociology.bogazici.edu.tr/tr
https://psychology.bogazici.edu.tr/tr
https://hist.bogazici.edu.tr/tr
https://turkishliterature.bogazici.edu.tr/
https://westlanglit.bogazici.edu.tr/
https://transint.bogazici.edu.tr/tr
https://linguistics.bogazici.edu.tr/tr
https://phil.bogazici.edu.tr/tr
https://eng.bogazici.edu.tr/
https://cmpe.bogazici.edu.tr/tr
https://ee.bogazici.edu.tr/tr
https://ie.bogazici.edu.tr/tr
http://ce.boun.edu.tr/
https://che.bogazici.edu.tr/tr
https://me.bogazici.edu.tr/tr
https://yadyok.bogazici.edu.tr/`
  }
];

async function main(): Promise<void> {
  const tree = JSON.parse(await readFile(treePath, "utf8")) as FacultyTreeFile;
  const registry = JSON.parse(await readFile(registryPath, "utf8")) as VerifiedAcademicUnitSource[];
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as CatalogSeed;
  const seedById = new Map(catalog.universities.map((university) => [university.slug, university]));

  const loadedBatches = await Promise.all(batches.map(loadBatchSource));
  const links = loadedBatches.flatMap((batch) => extractUrls(batch.source).map((url, index) => ({ batch, url, order: index })));
  const candidates = uniqueBy(links, (link) => link.url).map((link, index) => ({
    url: link.url,
    order: index,
    text: textFromUrl(link.url)
  }));
  const titleMap = shouldFetchTitles ? await fetchTitles(candidates) : new Map<string, string>();

  const results: PatchResult[] = [];
  for (const batch of loadedBatches) {
    const seed = seedById.get(batch.universityId);
    if (!seed) throw new Error(`Catalog seed not found: ${batch.universityId}`);
    const batchLinks = extractUrls(batch.source).map((url, order) => ({
      url,
      order,
      text: `${textFromUrl(url)} ${titleMap.get(url) ?? ""}`.trim(),
      title: titleMap.get(url)
    }));
    const result = buildPatchResult(batch, seed, batchLinks);
    results.push(result);
    mergeTreeRecord(tree, seed, result);
  }

  const additions = results.flatMap((result) => {
    const seed = seedById.get(result.batch.universityId);
    return seed ? buildRegistryRecords(result, seed) : [];
  });
  const mergedRegistry = mergeRegistry(registry, additions);
  tree.generatedAt = new Date().toISOString();
  tree.summary = buildTreeSummary(tree.universities);

  await writeFile(treePath, `${JSON.stringify(tree, null, 2)}\n`, "utf8");
  await writeFile(registryPath, `${JSON.stringify(mergedRegistry, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(results.map((result) => {
    const records = mergedRegistry.filter((source) => source.universityId === result.batch.universityId);
    return {
      university: result.batch.name,
      suppliedUrls: extractUrls(result.batch.source).length,
      matchedFaculties: result.facultyUrls.size,
      matchedDepartments: [...result.departmentUrls.values()].reduce((total, departments) => total + departments.size, 0),
      unmatchedUrls: result.unmatchedUrls.length,
      runtimeRecords: records.length,
      runtimeFaculties: records.filter((source) => source.scopeType === "faculty").length,
      runtimeDepartments: records.filter((source) => source.scopeType === "department").length
    };
  }), null, 2));
}

function attachmentBatch(universityId: string, name: string, homepageUrl: string, lookup: string[], path: string): UrlBatch {
  return { universityId, name, homepageUrl, lookup, source: `@${path}` };
}

async function loadBatchSource(batch: UrlBatch): Promise<UrlBatch> {
  if (!batch.source.startsWith("@")) return batch;
  const path = batch.source.slice(1);
  return { ...batch, source: await readFile(path, "utf8") };
}

function buildPatchResult(batch: UrlBatch, seed: SeedUniversity, links: LinkCandidate[]): PatchResult {
  const facultyUrls = new Map<string, string>();
  const departmentUrls = new Map<string, Map<string, string>>();
  const unmatchedUrls: string[] = [];
  let currentFaculty: SeedFaculty | undefined;

  for (const link of links.slice(1)) {
    const facultyMatch = bestFacultyMatch(seed, link);
    const universityDepartmentMatch = bestDepartmentMatchAcrossUniversity(seed, link);
    if (currentFaculty) {
      const contextualDepartmentMatch = bestDepartmentMatch(currentFaculty, link);
      if (
        contextualDepartmentMatch &&
        contextualDepartmentMatch.score >= 45 &&
        contextualDepartmentMatch.score >= (universityDepartmentMatch?.score ?? 0)
      ) {
        const group = getDepartmentGroup(departmentUrls, currentFaculty.name);
        setBest(group, contextualDepartmentMatch.department.name, link.url);
        continue;
      }
    }

    if (facultyMatch && facultyMatch.score >= 85) {
      currentFaculty = facultyMatch.faculty;
      setBest(facultyUrls, currentFaculty.name, link.url);
      continue;
    }

    const departmentMatch = universityDepartmentMatch;
    if (departmentMatch && departmentMatch.score >= 75) {
      currentFaculty = departmentMatch.faculty;
      const group = getDepartmentGroup(departmentUrls, currentFaculty.name);
      setBest(group, departmentMatch.department.name, link.url);
      continue;
    }

    if (facultyMatch && facultyMatch.score >= 60 && looksLikeFacultyLanding(link.url, facultyMatch.faculty)) {
      currentFaculty = facultyMatch.faculty;
      setBest(facultyUrls, currentFaculty.name, link.url);
      continue;
    }

    unmatchedUrls.push(link.url);
  }

  for (const [facultyName] of departmentUrls) {
    if (!facultyUrls.has(facultyName)) {
      const faculty = seed.faculties.find((item) => item.name === facultyName);
      if (faculty) setBest(facultyUrls, facultyName, links.find((link) => bestFacultyMatch({ ...seed, faculties: [faculty] }, link)?.score >= 60)?.url ?? batch.homepageUrl);
    }
  }

  applyKnownOverrides(batch.universityId, seed, facultyUrls, departmentUrls);
  return { batch, facultyUrls, departmentUrls, unmatchedUrls };
}

function applyKnownOverrides(universityId: string, seed: SeedUniversity, facultyUrls: Map<string, string>, departmentUrls: Map<string, Map<string, string>>): void {
  applySlugOverrides(universityId, seed, facultyUrls, departmentUrls);
  return;

  if (universityId === "bogazici-universitesi-istanbul") {
    setBest(facultyUrls, "Eğitim Fakültesi", "https://fed.bogazici.edu.tr/tr");
    setBest(facultyUrls, "Fen Fakültesi", "https://fen.bogazici.edu.tr/tr");
    setBest(facultyUrls, "Hukuk Fakültesi", "https://hf.bogazici.edu.tr/");
    setBest(facultyUrls, "İktisadi ve İdari Bilimler Fakültesi", "https://iibf.bogazici.edu.tr/");
    setBest(facultyUrls, "İnsan ve Toplum Bilimleri Fakültesi", "https://itbf.bogazici.edu.tr/");
    setBest(facultyUrls, "Mühendislik Fakültesi", "https://eng.bogazici.edu.tr/");
    const egitim = getDepartmentGroup(departmentUrls, "Eğitim Fakültesi");
    setBest(egitim, "Bilgisayar ve Öğretim Teknolojileri Öğretmenliği", "https://cet.bogazici.edu.tr/tr");
    setBest(egitim, "İngilizce Öğretmenliği", "http://fled.bogazici.edu.tr/");
    setBest(egitim, "Okul Öncesi Öğretmenliği", "https://pred.bogazici.edu.tr/tr");
    setBest(egitim, "Rehberlik ve Psikolojik Danışmanlık", "https://ed.bogazici.edu.tr/tr");
    const fen = getDepartmentGroup(departmentUrls, "Fen Fakültesi");
    setBest(fen, "Fizik", "https://phys.bogazici.edu.tr/tr");
    setBest(fen, "Kimya", "https://chem.bogazici.edu.tr/?lang=tr");
    setBest(fen, "Matematik", "https://math.bogazici.edu.tr/tr");
    setBest(fen, "Moleküler Biyoloji ve Genetik", "https://mbg.bogazici.edu.tr/");
    const iibf = getDepartmentGroup(departmentUrls, "İktisadi ve İdari Bilimler Fakültesi");
    setBest(iibf, "İktisat", "https://econ.bogazici.edu.tr/tr");
    setBest(iibf, "İşletme", "https://mgmt.bogazici.edu.tr/tr");
    setBest(iibf, "Siyaset Bilimi ve Uluslararası İlişkiler", "https://pols.bogazici.edu.tr/?q=tr");
    setBest(iibf, "Turizm İşletmeciliği", "https://tourism.bogazici.edu.tr/");
    setBest(iibf, "Uluslararası Ticaret", "https://intt.bogazici.edu.tr/");
    setBest(iibf, "Yönetim Bilişim Sistemleri", "https://mis.bogazici.edu.tr/");
    const itbf = getDepartmentGroup(departmentUrls, "İnsan ve Toplum Bilimleri Fakültesi");
    setBest(itbf, "Sosyoloji", "https://sociology.bogazici.edu.tr/tr");
    setBest(itbf, "Psikoloji", "https://psychology.bogazici.edu.tr/tr");
    setBest(itbf, "Tarih", "https://hist.bogazici.edu.tr/tr");
    setBest(itbf, "Türk Dili ve Edebiyatı", "https://turkishliterature.bogazici.edu.tr/");
    setBest(itbf, "İngiliz Dili ve Edebiyatı", "https://westlanglit.bogazici.edu.tr/");
    setBest(itbf, "Çeviribilimi", "https://transint.bogazici.edu.tr/tr");
    setBest(itbf, "Dilbilimi", "https://linguistics.bogazici.edu.tr/tr");
    setBest(itbf, "Felsefe", "https://phil.bogazici.edu.tr/tr");
    const muh = getDepartmentGroup(departmentUrls, "Mühendislik Fakültesi");
    setBest(muh, "Bilgisayar Mühendisliği", "https://cmpe.bogazici.edu.tr/tr");
    setBest(muh, "Elektrik-Elektronik Mühendisliği", "https://ee.bogazici.edu.tr/tr");
    setBest(muh, "Endüstri Mühendisliği", "https://ie.bogazici.edu.tr/tr");
    setBest(muh, "İnşaat Mühendisliği", "http://ce.boun.edu.tr/");
    setBest(muh, "Kimya Mühendisliği", "https://che.bogazici.edu.tr/tr");
    setBest(muh, "Makine Mühendisliği", "https://me.bogazici.edu.tr/tr");
  }
}

function applySlugOverrides(
  universityId: string,
  seed: SeedUniversity,
  facultyUrls: Map<string, string>,
  departmentUrls: Map<string, Map<string, string>>
): void {
  const faculty = (facultySlug: string, url: string) => setFacultyUrl(seed, facultyUrls, facultySlug, url);
  const department = (facultySlug: string, departmentSlug: string, url: string) =>
    setDepartmentUrl(seed, departmentUrls, facultySlug, departmentSlug, url);

  if (universityId === "balikesir-universitesi") {
    [
      ["altinoluk-meslek-yuksekokulu", "https://altinolukmyo.balikesir.edu.tr/"],
      ["ayvalik-meslek-yuksekokulu", "https://ayvalikmyo.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "https://balikesirmyo.balikesir.edu.tr/"],
      ["bigadic-meslek-yuksekokulu", "https://bigadicmyo.balikesir.edu.tr/"],
      ["burhaniye-meslek-yuksekokulu", "https://burhaniyemyo.balikesir.edu.tr/"],
      ["burhaniye-uygulamali-bilimler-fakultesi", "https://bubfa.balikesir.edu.tr/"],
      ["dursunbey-meslek-yuksekokulu", "https://dursunbeymyo.balikesir.edu.tr/"],
      ["edremit-meslek-yuksekokulu", "https://edremitmyo.balikesir.edu.tr/"],
      ["edremit-sivil-havacilik-yuksekokulu", "https://edremitshyo.balikesir.edu.tr/"],
      ["fen-edebiyat-fakultesi", "https://fef.balikesir.edu.tr/"],
      ["havran-meslek-yuksekokulu", "https://havranmyo.balikesir.edu.tr/"],
      ["hukuk-fakultesi", "https://hukuk.balikesir.edu.tr/"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "https://iibf.balikesir.edu.tr/"],
      ["ilahiyat-fakultesi", "https://ilahiyat.balikesir.edu.tr/"],
      ["ivrindi-saglik-hizmetleri-meslek-yuksekokulu", "https://ivrindishmyo.balikesir.edu.tr/"],
      ["kepsut-meslek-yuksekokulu", "https://kepsutmyo.balikesir.edu.tr/"],
      ["mimarlik-fakultesi", "https://mimarlik.balikesir.edu.tr/"],
      ["muhendislik-fakultesi", "https://mf.balikesir.edu.tr/"],
      ["necatibey-egitim-fakultesi", "https://nef.balikesir.edu.tr/"],
      ["saglik-bilimleri-fakultesi", "https://sbf.balikesir.edu.tr/"],
      ["savastepe-meslek-yuksekokulu", "https://savastepemyo.balikesir.edu.tr/"],
      ["sindirgi-meslek-yuksekokulu", "https://sindirgimyo.balikesir.edu.tr/"],
      ["spor-bilimleri-fakultesi", "https://sporbilimleri.balikesir.edu.tr/"],
      ["tip-fakultesi", "https://tip.balikesir.edu.tr/"],
      ["turizm-fakultesi", "https://turizm.balikesir.edu.tr/"],
      ["veteriner-fakultesi", "https://veteriner.balikesir.edu.tr/"]
    ].forEach(([facultySlug, url]) => faculty(facultySlug, url));

    [
      ["burhaniye-uygulamali-bilimler-fakultesi", "turizm-isletmeciligi", "https://bubfa-tib.balikesir.edu.tr/"],
      ["burhaniye-uygulamali-bilimler-fakultesi", "gastronomi-ve-mutfak-sanatlari", "https://bubfa-gmsb.balikesir.edu.tr/"],
      ["burhaniye-uygulamali-bilimler-fakultesi", "finans-ve-bankacilik", "https://bubfa-fbb.balikesir.edu.tr/"],
      ["burhaniye-uygulamali-bilimler-fakultesi", "uluslararasi-ticaret", "https://bubfa-utb.balikesir.edu.tr/"],
      ["fen-edebiyat-fakultesi", "biyoloji", "https://biyoloji.balikesir.edu.tr/"],
      ["fen-edebiyat-fakultesi", "cografya", "https://cografya.balikesir.edu.tr/"],
      ["fen-edebiyat-fakultesi", "fizik", "https://fizik.balikesir.edu.tr/"],
      ["fen-edebiyat-fakultesi", "kimya", "https://fef-kimya.balikesir.edu.tr/"],
      ["fen-edebiyat-fakultesi", "matematik", "https://matematik.balikesir.edu.tr/"],
      ["fen-edebiyat-fakultesi", "molekuler-biyoloji-ve-genetik", "https://molbiyoloji.balikesir.edu.tr/"],
      ["fen-edebiyat-fakultesi", "psikoloji", "https://psikoloji.balikesir.edu.tr/"],
      ["fen-edebiyat-fakultesi", "sosyoloji", "https://sosyoloji.balikesir.edu.tr/"],
      ["fen-edebiyat-fakultesi", "tarih", "https://tarih.balikesir.edu.tr/"],
      ["fen-edebiyat-fakultesi", "turk-dili-ve-edebiyati", "https://tdeb.balikesir.edu.tr/"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "isletme", "https://isletme.balikesir.edu.tr/"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "iktisat", "https://iktisat.balikesir.edu.tr/"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "uluslararasi-ticaret-ve-lojistik", "https://utlb.balikesir.edu.tr/"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "maliye", "https://maliye.balikesir.edu.tr/"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "siyaset-bilimi-ve-kamu-yonetimi", "https://sbky.balikesir.edu.tr/"],
      ["muhendislik-fakultesi", "bilgisayar-muhendisligi", "https://ceng.balikesir.edu.tr/"],
      ["muhendislik-fakultesi", "cevre-muhendisligi", "https://cevre.balikesir.edu.tr/"],
      ["muhendislik-fakultesi", "elektrik-elektronik-muhendisligi", "https://eem.balikesir.edu.tr/"],
      ["muhendislik-fakultesi", "endustri-muhendisligi", "https://endustri.balikesir.edu.tr/"],
      ["muhendislik-fakultesi", "gida-muhendisligi", "https://gida.balikesir.edu.tr/"],
      ["muhendislik-fakultesi", "insaat-muhendisligi", "https://insaat.balikesir.edu.tr/"],
      ["muhendislik-fakultesi", "makine-muhendisligi", "https://makine.balikesir.edu.tr/"],
      ["saglik-bilimleri-fakultesi", "ebelik", "https://sbf-ebelik.balikesir.edu.tr/"],
      ["saglik-bilimleri-fakultesi", "fizyoterapi-ve-rehabilitasyon", "https://sbf-fizyoterapi.balikesir.edu.tr/"],
      ["saglik-bilimleri-fakultesi", "gerontoloji", "https://sbf-gerontoloji.balikesir.edu.tr/"],
      ["saglik-bilimleri-fakultesi", "hemsirelik", "https://sbf-hemsirelik.balikesir.edu.tr/"],
      ["spor-bilimleri-fakultesi", "spor-yoneticiligi", "https://sporyoneticiligi.balikesir.edu.tr/"],
      ["turizm-fakultesi", "turizm-isletmeciligi", "https://turizmisletmeciligi.balikesir.edu.tr/"],
      ["turizm-fakultesi", "turizm-rehberligi", "https://turizmrehberligi.balikesir.edu.tr/"],
      ["turizm-fakultesi", "gastronomi-ve-mutfak-sanatlari", "https://gastronomi.balikesir.edu.tr/"],
      ["turizm-fakultesi", "rekreasyon-yonetimi", "https://rekreasyon.balikesir.edu.tr/"],
      ["veteriner-fakultesi", "veteriner", "https://veteriner.balikesir.edu.tr/"],
      ["altinoluk-meslek-yuksekokulu", "bilgisayar-programciligi", "https://altinolukmyo-bil.balikesir.edu.tr/"],
      ["altinoluk-meslek-yuksekokulu", "kimya-teknolojisi", "https://altinolukmyo-kimya.balikesir.edu.tr/"],
      ["ayvalik-meslek-yuksekokulu", "mimari-restorasyon", "https://ayvalikmyo-mspb.balikesir.edu.tr/"],
      ["ayvalik-meslek-yuksekokulu", "turizm-ve-otel-isletmeciligi", "https://ayvalikmyo-otel.balikesir.edu.tr/"],
      ["ayvalik-meslek-yuksekokulu", "pazarlama", "https://ayvalikmyo-paz.balikesir.edu.tr/"],
      ["ayvalik-meslek-yuksekokulu", "isletme-yonetimi", "https://ayvalikmyo-yon.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "bilgisayar-programciligi", "https://balikesirmyo-bil.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "buro-yonetimi-ve-yonetici-asistanligi", "https://balikesirmyo-buro.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "cocuk-gelisimi", "https://balikesirmyo-cocuk.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "elektrik", "https://balikesirmyo-elk.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "elektronik-haberlesme-teknolojisi", "https://balikesirmyo-els.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "kontrol-ve-otomasyon-teknolojisi", "https://balikesirmyo-elkotm.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "insaat-teknolojisi", "https://balikesirmyo-insaat.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "madencilik-teknolojisi", "https://balikesirmyo-maden.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "makine", "https://balikesirmyo-makine.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "muhasebe-ve-vergi-uygulamalari", "https://balikesirmyo-muh.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "otomotiv-teknolojisi", "https://balikesirmyo-mot.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "pazarlama", "https://balikesirmyo-paz.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "tekstil-teknolojisi", "https://balikesirmyo-tekstil.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "grafik-tasarimi", "https://balikesirmyo-tasarim.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "turizm-ve-otel-isletmeciligi", "https://balikesirmyo-otel.balikesir.edu.tr/"],
      ["balikesir-meslek-yuksekokulu", "isletme-yonetimi", "https://balikesirmyo-yon.balikesir.edu.tr/"],
      ["bigadic-meslek-yuksekokulu", "elektrik", "https://bigadicmyo-elk.balikesir.edu.tr/"],
      ["bigadic-meslek-yuksekokulu", "bankacilik-ve-sigortacilik", "https://bigadicmyo-fbsb.balikesir.edu.tr/"],
      ["bigadic-meslek-yuksekokulu", "muhasebe-ve-vergi-uygulamalari", "https://bigadicmyo-muh.balikesir.edu.tr/"],
      ["bigadic-meslek-yuksekokulu", "fizyoterapi", "https://bigadicmyo-terapi.balikesir.edu.tr/"],
      ["bigadic-meslek-yuksekokulu", "ulastirma-ve-trafik-hizmetleri", "https://bigadicmyo-utb.balikesir.edu.tr/"],
      ["burhaniye-meslek-yuksekokulu", "isletme-yonetimi", "https://burhaniyemyo-yon.balikesir.edu.tr/"],
      ["burhaniye-meslek-yuksekokulu", "muhasebe-ve-vergi-uygulamalari", "https://burhaniyemyo-muh.balikesir.edu.tr/"],
      ["burhaniye-meslek-yuksekokulu", "pazarlama", "https://burhaniyemyo-paz.balikesir.edu.tr/"],
      ["burhaniye-meslek-yuksekokulu", "turizm-ve-otel-isletmeciligi", "https://burhaniyemyo-otel.balikesir.edu.tr/"],
      ["dursunbey-meslek-yuksekokulu", "ormancilik-ve-orman-urunleri", "http://dursunbeymyo-orm.balikesir.edu.tr/"],
      ["dursunbey-meslek-yuksekokulu", "is-sagligi-ve-guvenligi", "https://dursunbeymyo-elsb.balikesir.edu.tr/"],
      ["dursunbey-meslek-yuksekokulu", "insaat-teknolojisi", "http://dursunbeymyo-insaat.balikesir.edu.tr/"],
      ["dursunbey-meslek-yuksekokulu", "kuyumculuk-ve-taki-tasarimi", "https://dursunbeymyo-mkgb.balikesir.edu.tr/"],
      ["edremit-meslek-yuksekokulu", "bilgisayar-programciligi", "https://edremitmyo-bil.balikesir.edu.tr/"],
      ["edremit-meslek-yuksekokulu", "elektrik", "https://edremitmyo-elk.balikesir.edu.tr/"],
      ["edremit-meslek-yuksekokulu", "mekatronik", "https://edremitmyo-elkotm.balikesir.edu.tr/"],
      ["edremit-meslek-yuksekokulu", "insaat-teknolojisi", "https://edremitmyo-insaat.balikesir.edu.tr/"],
      ["edremit-meslek-yuksekokulu", "makine", "https://edremitmyo-makine.balikesir.edu.tr/"],
      ["havran-meslek-yuksekokulu", "muhasebe-ve-vergi-uygulamalari", "https://havranmyo-muh.balikesir.edu.tr/"],
      ["havran-meslek-yuksekokulu", "isletme-yonetimi", "https://havranmyo-yon.balikesir.edu.tr/"],
      ["havran-meslek-yuksekokulu", "buro-yonetimi-ve-yonetici-asistanligi", "https://havranmyo-buro.balikesir.edu.tr/"],
      ["kepsut-meslek-yuksekokulu", "bankacilik-ve-sigortacilik", "https://kepsutmyo-fbsb.balikesir.edu.tr/"],
      ["kepsut-meslek-yuksekokulu", "laborant-ve-veteriner-saglik", "https://kepsutmyo-vet.balikesir.edu.tr/"],
      ["sindirgi-meslek-yuksekokulu", "dis-ticaret", "https://sindirgimyo-distic.balikesir.edu.tr/"],
      ["sindirgi-meslek-yuksekokulu", "saglik-kurumlari-isletmeciligi", "https://sindirgimyo-yon.balikesir.edu.tr/"],
      ["sindirgi-meslek-yuksekokulu", "turizm-ve-otel-isletmeciligi", "https://sindirgimyo-otel.balikesir.edu.tr/"],
      ["sindirgi-meslek-yuksekokulu", "elektrik", "https://sindirgimyo-elk.balikesir.edu.tr/"]
    ].forEach(([facultySlug, departmentSlug, url]) => department(facultySlug, departmentSlug, url));
  }

  if (universityId === "batman-universitesi") {
    [
      ["besiri-organize-sanayi-bolgesi-meslek-yuksekokulu", "https://batman.edu.tr/Birimler/bosmy"],
      ["dis-hekimligi-fakultesi", "https://batman.edu.tr/Birimler/dhf"],
      ["fen-edebiyat-fakultesi", "https://batman.edu.tr/Birimler/fef"],
      ["hasankeyf-meslek-yuksekokulu", "https://batman.edu.tr/Birimler/hmy"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "https://batman.edu.tr/Birimler/iibf"],
      ["islami-ilimler-fakultesi", "https://batman.edu.tr/Birimler/iif"],
      ["kozluk-meslek-yuksekokulu", "https://batman.edu.tr/Birimler/kmy"],
      ["muhendislik-mimarlik-fakultesi", "https://batman.edu.tr/Birimler/mmf"],
      ["saglik-bilimleri-fakultesi", "https://batman.edu.tr/Birimler/sbf"],
      ["saglik-hizmetleri-meslek-yuksekokulu", "https://batman.edu.tr/Birimler/shmy"],
      ["sason-meslek-yuksekokulu", "http://batman.edu.tr/Birimler/smy"],
      ["sosyal-bilimler-meslek-yuksekokulu", "https://batman.edu.tr/Birimler/1472"],
      ["spor-bilimleri-fakultesi", "https://batman.edu.tr/Birimler/1437"],
      ["teknik-bilimler-meslek-yuksekokulu", "https://batman.edu.tr/Birimler/tbmy"],
      ["turizm-fakultesi", "https://batman.edu.tr/Birimler/turizm"]
    ].forEach(([facultySlug, url]) => faculty(facultySlug, url));

    [
      ["dis-hekimligi-fakultesi", "dis-hekimligi", "https://batman.edu.tr/Birimler/dhf"],
      ["fen-edebiyat-fakultesi", "matematik", "https://batman.edu.tr/Birimler/1393"],
      ["fen-edebiyat-fakultesi", "sanat-tarihi", "https://batman.edu.tr/Birimler/1394"],
      ["fen-edebiyat-fakultesi", "sosyoloji", "https://batman.edu.tr/Birimler/1384"],
      ["fen-edebiyat-fakultesi", "tarih", "https://batman.edu.tr/Birimler/1390"],
      ["fen-edebiyat-fakultesi", "turk-dili-ve-edebiyati", "https://batman.edu.tr/Birimler/1381"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "iktisat", "https://batman.edu.tr/Birimler/1398"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "isletme", "https://batman.edu.tr/Birimler/1399"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "siyaset-bilimi-ve-kamu-yonetimi", "https://batman.edu.tr/Birimler/1401"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "uluslararasi-iliskiler", "https://batman.edu.tr/Birimler/1402"],
      ["muhendislik-mimarlik-fakultesi", "bilgisayar-muhendisligi", "https://batman.edu.tr/Birimler/1362"],
      ["muhendislik-mimarlik-fakultesi", "elektrik-elektronik-muhendisligi", "https://batman.edu.tr/Birimler/1363"],
      ["muhendislik-mimarlik-fakultesi", "insaat-muhendisligi", "https://batman.edu.tr/Birimler/1364"],
      ["muhendislik-mimarlik-fakultesi", "makine-muhendisligi", "https://batman.edu.tr/Birimler/1365"],
      ["muhendislik-mimarlik-fakultesi", "petrol-ve-dogalgaz-muhendisligi", "https://batman.edu.tr/Birimler/1375"],
      ["saglik-bilimleri-fakultesi", "hemsirelik", "https://batman.edu.tr/Birimler/1573"],
      ["saglik-bilimleri-fakultesi", "saglik-yonetimi", "https://batman.edu.tr/Birimler/1578"],
      ["sosyal-bilimler-meslek-yuksekokulu", "buro-yonetimi-ve-yonetici-asistanligi", "https://batman.edu.tr/Birimler/1474"],
      ["sosyal-bilimler-meslek-yuksekokulu", "cocuk-gelisimi", "https://batman.edu.tr/Birimler/1473"],
      ["sosyal-bilimler-meslek-yuksekokulu", "bankacilik-ve-sigortacilik", "https://batman.edu.tr/Birimler/1475"],
      ["sosyal-bilimler-meslek-yuksekokulu", "ozel-guvenlik-ve-koruma", "https://batman.edu.tr/Birimler/1477"],
      ["sosyal-bilimler-meslek-yuksekokulu", "muhasebe-ve-vergi-uygulamalari", "https://batman.edu.tr/Birimler/1478"],
      ["spor-bilimleri-fakultesi", "spor-yoneticiligi", "https://batman.edu.tr/Birimler/1440"],
      ["teknik-bilimler-meslek-yuksekokulu", "bilgisayar-teknolojisi", "https://batman.edu.tr/Birimler/1459"],
      ["teknik-bilimler-meslek-yuksekokulu", "elektrik", "https://batman.edu.tr/Birimler/1462"],
      ["teknik-bilimler-meslek-yuksekokulu", "geleneksel-el-sanatlari", "https://batman.edu.tr/Birimler/1461"],
      ["teknik-bilimler-meslek-yuksekokulu", "gida-teknolojisi", "https://batman.edu.tr/Birimler/1464"],
      ["teknik-bilimler-meslek-yuksekokulu", "insaat-teknolojisi", "https://batman.edu.tr/Birimler/1465"],
      ["teknik-bilimler-meslek-yuksekokulu", "makine", "https://batman.edu.tr/Birimler/1471"],
      ["teknik-bilimler-meslek-yuksekokulu", "otomotiv-teknolojisi", "https://batman.edu.tr/Birimler/1468"],
      ["teknik-bilimler-meslek-yuksekokulu", "ic-mekan-tasarimi", "https://batman.edu.tr/Birimler/1469"],
      ["teknik-bilimler-meslek-yuksekokulu", "giyim-uretim-teknolojisi", "https://batman.edu.tr/Birimler/1470"],
      ["teknik-bilimler-meslek-yuksekokulu", "laborant-ve-veteriner-saglik", "https://batman.edu.tr/Birimler/1581"],
      ["turizm-fakultesi", "gastronomi-ve-mutfak-sanatlari", "https://batman.edu.tr/Birimler/1430"],
      ["turizm-fakultesi", "turizm-isletmeciligi", "https://batman.edu.tr/Birimler/1429"],
      ["turizm-fakultesi", "turizm-rehberligi", "https://batman.edu.tr/Birimler/1432"],
      ["besiri-organize-sanayi-bolgesi-meslek-yuksekokulu", "alternatif-enerji-kaynaklari-teknolojisi", "https://batman.edu.tr/Birimler/1496"],
      ["besiri-organize-sanayi-bolgesi-meslek-yuksekokulu", "kaynak-teknolojisi", "https://batman.edu.tr/Birimler/1498"],
      ["besiri-organize-sanayi-bolgesi-meslek-yuksekokulu", "makine", "https://batman.edu.tr/Birimler/1497"],
      ["besiri-organize-sanayi-bolgesi-meslek-yuksekokulu", "mekatronik", "https://batman.edu.tr/Birimler/1499"]
    ].forEach(([facultySlug, departmentSlug, url]) => department(facultySlug, departmentSlug, url));
  }

  if (universityId === "bogazici-universitesi-istanbul") {
    [
      ["egitim-fakultesi", "https://fed.bogazici.edu.tr/tr"],
      ["fen-fakultesi", "https://fen.bogazici.edu.tr/tr"],
      ["hukuk-fakultesi", "https://hf.bogazici.edu.tr/"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "https://iibf.bogazici.edu.tr/"],
      ["insan-ve-toplum-bilimleri-fakultesi", "https://itbf.bogazici.edu.tr/"],
      ["muhendislik-fakultesi", "https://eng.bogazici.edu.tr/"]
    ].forEach(([facultySlug, url]) => faculty(facultySlug, url));

    [
      ["egitim-fakultesi", "bilgisayar-ve-ogretim-teknolojileri-ogretmenligi", "https://cet.bogazici.edu.tr/tr"],
      ["egitim-fakultesi", "ingilizce-ogretmenligi", "http://fled.bogazici.edu.tr/"],
      ["egitim-fakultesi", "okul-oncesi-ogretmenligi", "https://pred.bogazici.edu.tr/tr"],
      ["egitim-fakultesi", "rehberlik-ve-psikolojik-danismanlik", "https://ed.bogazici.edu.tr/tr"],
      ["fen-fakultesi", "fizik", "https://phys.bogazici.edu.tr/tr"],
      ["fen-fakultesi", "kimya", "https://chem.bogazici.edu.tr/?lang=tr"],
      ["fen-fakultesi", "matematik", "https://math.bogazici.edu.tr/tr"],
      ["fen-fakultesi", "molekuler-biyoloji-ve-genetik", "https://mbg.bogazici.edu.tr/"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "iktisat", "https://econ.bogazici.edu.tr/tr"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "isletme", "https://mgmt.bogazici.edu.tr/tr"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "siyaset-bilimi-ve-uluslararasi-iliskiler", "https://pols.bogazici.edu.tr/?q=tr"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "turizm-isletmeciligi", "https://tourism.bogazici.edu.tr/"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "uluslararasi-ticaret", "https://intt.bogazici.edu.tr/"],
      ["iktisadi-ve-idari-bilimler-fakultesi", "yonetim-bilisim-sistemleri", "https://mis.bogazici.edu.tr/"],
      ["insan-ve-toplum-bilimleri-fakultesi", "sosyoloji", "https://sociology.bogazici.edu.tr/tr"],
      ["insan-ve-toplum-bilimleri-fakultesi", "psikoloji", "https://psychology.bogazici.edu.tr/tr"],
      ["insan-ve-toplum-bilimleri-fakultesi", "tarih", "https://hist.bogazici.edu.tr/tr"],
      ["insan-ve-toplum-bilimleri-fakultesi", "turk-dili-ve-edebiyati", "https://turkishliterature.bogazici.edu.tr/"],
      ["insan-ve-toplum-bilimleri-fakultesi", "ingiliz-dili-ve-edebiyati", "https://westlanglit.bogazici.edu.tr/"],
      ["insan-ve-toplum-bilimleri-fakultesi", "ceviribilimi", "https://transint.bogazici.edu.tr/tr"],
      ["insan-ve-toplum-bilimleri-fakultesi", "dilbilimi", "https://linguistics.bogazici.edu.tr/tr"],
      ["insan-ve-toplum-bilimleri-fakultesi", "felsefe", "https://phil.bogazici.edu.tr/tr"],
      ["muhendislik-fakultesi", "bilgisayar-muhendisligi", "https://cmpe.bogazici.edu.tr/tr"],
      ["muhendislik-fakultesi", "elektrik-elektronik-muhendisligi", "https://ee.bogazici.edu.tr/tr"],
      ["muhendislik-fakultesi", "endustri-muhendisligi", "https://ie.bogazici.edu.tr/tr"],
      ["muhendislik-fakultesi", "insaat-muhendisligi", "http://ce.boun.edu.tr/"],
      ["muhendislik-fakultesi", "kimya-muhendisligi", "https://che.bogazici.edu.tr/tr"],
      ["muhendislik-fakultesi", "makine-muhendisligi", "https://me.bogazici.edu.tr/tr"]
    ].forEach(([facultySlug, departmentSlug, url]) => department(facultySlug, departmentSlug, url));
  }
}

function setFacultyUrl(seed: SeedUniversity, facultyUrls: Map<string, string>, facultySlug: string, url: string): void {
  const faculty = seed.faculties.find((item) => item.slug === facultySlug);
  if (faculty) setBest(facultyUrls, faculty.name, url);
}

function setDepartmentUrl(
  seed: SeedUniversity,
  departmentUrls: Map<string, Map<string, string>>,
  facultySlug: string,
  departmentSlug: string,
  url: string
): void {
  const faculty = seed.faculties.find((item) => item.slug === facultySlug);
  const department = faculty?.departments.find((item) => item.slug === departmentSlug);
  if (!faculty || !department) return;
  setBest(getDepartmentGroup(departmentUrls, faculty.name), department.name, url);
}

function bestFacultyMatch(seed: SeedUniversity, link: LinkCandidate): { faculty: SeedFaculty; score: number } | null {
  return best(seed.faculties.map((faculty) => ({ faculty, score: scoreLink(link, faculty.name, faculty.slug) })));
}

function bestDepartmentMatch(faculty: SeedFaculty, link: LinkCandidate): { faculty: SeedFaculty; department: SeedDepartment; score: number } | null {
  return best(faculty.departments.map((department) => ({ faculty, department, score: scoreLink(link, department.name, department.slug) })));
}

function bestDepartmentMatchAcrossUniversity(seed: SeedUniversity, link: LinkCandidate): { faculty: SeedFaculty; department: SeedDepartment; score: number } | null {
  return best(seed.faculties.flatMap((faculty) => faculty.departments.map((department) => ({ faculty, department, score: scoreLink(link, department.name, department.slug) }))));
}

function best<T extends { score: number }>(items: T[]): T | null {
  return [...items].sort((left, right) => right.score - left.score)[0] ?? null;
}

function scoreLink(link: LinkCandidate, name: string, slug: string): number {
  const haystack = foldText(link.text);
  const compactHaystack = compactText(link.text);
  const nameTokens = tokens(name);
  const slugTokens = tokens(slug.replace(/-/g, " "));
  const significant = unique([...nameTokens, ...slugTokens]);
  let score = 0;
  const compactName = compactText(removeGenericWords(name));
  const compactSlug = compactText(removeGenericWords(slug.replace(/-/g, " ")));
  if (compactName.length >= 5 && compactHaystack.includes(compactName)) score += 120;
  if (compactSlug.length >= 5 && compactHaystack.includes(compactSlug)) score += 100;
  const matched = significant.filter((token) => haystack.includes(token) || compactHaystack.includes(token));
  score += matched.length * 22;
  if (matched.length >= Math.min(2, significant.length)) score += 30;
  if (matched.length === significant.length && significant.length > 0) score += 30;
  if (/\b(kalite|akreditasyon|ekibi|yurt disi|egitim programlari|hakkinda|sayfa|sitelinki)\b/u.test(haystack)) score -= 35;
  return score;
}

function mergeTreeRecord(tree: FacultyTreeFile, seed: SeedUniversity, result: PatchResult): void {
  const university = findTreeRecord(tree, result.batch);
  if (!university) throw new Error(`University not found in tree: ${result.batch.name}`);
  const beforeFacultyCount = university.faculties?.length ?? 0;
  const faculties = new Map((university.faculties ?? []).map((faculty) => [treeKey(faculty.name), faculty]));

  for (const [facultyName, facultyUrl] of result.facultyUrls) {
    const faculty = seed.faculties.find((item) => item.name === facultyName);
    if (!faculty) continue;
    const current = faculties.get(treeKey(facultyName));
    faculties.set(treeKey(facultyName), {
      ...(current ?? {}),
      name: facultyName,
      url: normalizeDisplayUrl(facultyUrl),
      unitType: current?.unitType ?? inferUnitType(facultyName),
      sourcePageUrl: result.batch.homepageUrl,
      confidence: Math.max(current?.confidence ?? 0, 150),
      departments: mergeDepartmentTree(current?.departments ?? [], result.departmentUrls.get(facultyName) ?? new Map(), facultyUrl)
    });
  }

  const merged = [...faculties.values()].sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
  university.name = result.batch.name;
  university.homepageUrl = result.batch.homepageUrl;
  university.finalHomepageUrl = result.batch.homepageUrl;
  university.hostname = new URL(result.batch.homepageUrl).hostname;
  university.status = "manual_seeded";
  university.checkedPageCount = Math.max(Number(university.checkedPageCount ?? 0), 1);
  university.faculties = merged;
  university.facultyCount = merged.length;
  university.errors = [];
  university.cleanup = {
    ...(university.cleanup ?? {}),
    beforeFacultyCount,
    afterFacultyCount: merged.length,
    removedFacultyCount: Math.max(0, beforeFacultyCount - merged.length),
    manuallySeededFrom: "User-provided URL correction batch 2026-07-15"
  };
}

function mergeDepartmentTree(existing: FacultyTreeRecord[], departmentUrls: Map<string, string>, sourcePageUrl: string): FacultyTreeRecord[] {
  const byName = new Map(existing.map((department) => [treeKey(department.name), department]));
  for (const [departmentName, departmentUrl] of departmentUrls) {
    const current = byName.get(treeKey(departmentName));
    byName.set(treeKey(departmentName), {
      ...(current ?? {}),
      name: departmentName,
      url: normalizeDisplayUrl(departmentUrl),
      unitType: "department",
      sourcePageUrl: normalizeDisplayUrl(sourcePageUrl),
      confidence: Math.max(current?.confidence ?? 0, 145)
    });
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
}

function buildRegistryRecords(result: PatchResult, seed: SeedUniversity): VerifiedAcademicUnitSource[] {
  const records: VerifiedAcademicUnitSource[] = [];
  for (const [facultyName, facultyUrl] of result.facultyUrls) {
    const faculty = seed.faculties.find((item) => item.name === facultyName);
    if (!faculty) continue;
    const facultyId = `${seed.slug}__${faculty.slug}`;
    records.push({
      scopeType: "faculty",
      universityId: seed.slug,
      universityName: seed.name,
      facultyId,
      facultyName: faculty.name,
      websiteUrl: normalizeDisplayUrl(facultyUrl)
    });

    for (const [departmentName, departmentUrl] of result.departmentUrls.get(facultyName) ?? []) {
      const department = faculty.departments.find((item) => item.name === departmentName);
      if (!department) continue;
      records.push({
        scopeType: "department",
        universityId: seed.slug,
        universityName: seed.name,
        facultyId,
        facultyName: faculty.name,
        departmentId: `${facultyId}__${department.slug}`,
        departmentName: department.name,
        websiteUrl: normalizeDisplayUrl(departmentUrl)
      });
    }
  }
  return dedupeRegistry(records);
}

function mergeRegistry(existing: VerifiedAcademicUnitSource[], additions: VerifiedAcademicUnitSource[]): VerifiedAcademicUnitSource[] {
  const byKey = new Map(existing.map((record) => [registryKey(record), record]));
  for (const record of additions) byKey.set(registryKey(record), { ...byKey.get(registryKey(record)), ...record });
  return [...byKey.values()];
}

function dedupeRegistry(records: VerifiedAcademicUnitSource[]): VerifiedAcademicUnitSource[] {
  const byKey = new Map<string, VerifiedAcademicUnitSource>();
  for (const record of records) byKey.set(registryKey(record), { ...byKey.get(registryKey(record)), ...record });
  return [...byKey.values()];
}

function registryKey(record: VerifiedAcademicUnitSource): string {
  return record.scopeType === "faculty" ? `faculty:${record.facultyId}` : `department:${record.departmentId}`;
}

function findTreeRecord(tree: FacultyTreeFile, batch: UrlBatch): FacultyTreeFile["universities"][number] | undefined {
  return tree.universities.find((university) => {
    const homepage = String(university.homepageUrl ?? "");
    const name = String(university.name ?? "");
    return batch.lookup.some((lookup) => homepage.includes(lookup)) || foldText(name) === foldText(batch.name);
  });
}

function getDepartmentGroup(groups: Map<string, Map<string, string>>, facultyName: string): Map<string, string> {
  const existing = groups.get(facultyName);
  if (existing) return existing;
  const created = new Map<string, string>();
  groups.set(facultyName, created);
  return created;
}

function setBest(map: Map<string, string>, key: string, url: string): void {
  const normalized = normalizeDisplayUrl(url);
  const existing = map.get(key);
  if (!existing || rankUrl(normalized) > rankUrl(existing)) map.set(key, normalized);
}

function rankUrl(url: string): number {
  const parsed = new URL(url);
  let score = 0;
  if (parsed.protocol === "https:") score += 10;
  if (!/\b(kalite|akreditasyon|ekibi|hakkinda|sitelinki)\b/u.test(foldText(parsed.pathname))) score += 20;
  score -= parsed.pathname.split("/").filter(Boolean).length;
  return score;
}

function looksLikeFacultyLanding(input: string, faculty: SeedFaculty): boolean {
  const url = new URL(input);
  const foldedUrl = foldText(`${url.hostname} ${url.pathname}`);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.some((segment) => /^p\d+$/u.test(segment) || /^-\d+$/u.test(segment))) return false;
  if (/\b(bolum|program|icerik|birim)\b/u.test(foldedUrl) && segments.length > 2) return false;
  const compactHost = compactText(url.hostname.split(".")[0] ?? "");
  const compactFaculty = compactText(removeGenericWords(faculty.name));
  const compactSlug = compactText(removeGenericWords(faculty.slug.replace(/-/g, " ")));
  return segments.length <= 2 || compactHost === compactFaculty || compactHost === compactSlug;
}

function extractUrls(input: string): string[] {
  const fixed = input.replace(/(https?:\/\/[^\s]+?)(https?:\/\/)/giu, "$1\n$2");
  const urls = fixed.match(/\bhttps?:\/\/[^\s<>"'`]+/giu) ?? [];
  return unique(urls.map(cleanUrl).filter((url): url is string => Boolean(url)));
}

function cleanUrl(input: string): string | null {
  const trimmed = input.trim().replace(/[),.;]+$/u, "");
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

function textFromUrl(input: string): string {
  const url = new URL(input);
  return decodeURIComponentSafe(`${url.hostname} ${url.pathname} ${url.search}`)
    .replace(/[\/_\-.?=&]+/gu, " ");
}

async function fetchTitles(links: LinkCandidate[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.max(1, fetchConcurrency) }, async () => {
    for (;;) {
      const link = links[cursor++];
      if (!link) return;
      const title = await fetchTitle(link.url);
      if (title) titles.set(link.url, title);
    }
  }));
  return titles;
}

async function fetchTitle(url: string): Promise<string | undefined> {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { Range: "bytes=0-65535", "User-Agent": "Mozilla/5.0 academic-mobile-url-audit" }
    });
    if (!response.ok) return undefined;
    const html = await response.text();
    const title = readTagText(html, "title");
    const h1 = readTagText(html, "h1");
    const h2 = readTagText(html, "h2");
    return [title, h1, h2].filter(Boolean).join(" ");
  } catch {
    return undefined;
  } finally {
    clearTimeout(handle);
  }
}

function readTagText(html: string, tag: string): string | undefined {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "iu"));
  if (!match?.[1]) return undefined;
  return decodeHtml(match[1].replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim());
}

function decodeHtml(input: string): string {
  return input
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

function tokens(value: string): string[] {
  return foldText(removeGenericWords(value))
    .split(/\s+/u)
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function removeGenericWords(value: string): string {
  return foldText(value).replace(/\b(fakultesi|fakulte|bolumu|bolum|programi|program|meslek|yuksekokulu|yuksekokul|universitesi|anasanat|dali|egitimi|ogretmenligi|ingilizce|turkce)\b/gu, " ");
}

function inferUnitType(name: string): UnitType {
  const folded = foldText(name);
  if (folded.includes("meslek yuksekokulu")) return "vocational_school";
  if (folded.includes("yuksekokulu") || folded.includes("okulu")) return "school";
  if (folded.includes("enstitu")) return "institute";
  if (folded.includes("fakulte")) return "faculty";
  return "academic_unit";
}

function normalizeDisplayUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

function buildTreeSummary(universities: FacultyTreeFile["universities"]): Record<string, unknown> {
  return {
    totalUniversities: universities.length,
    completedUniversities: universities.filter((university) => university.status !== "pending").length,
    okUniversities: universities.filter((university) => university.status === "ok").length,
    manualSeededUniversities: universities.filter((university) => university.status === "manual_seeded").length,
    partialUniversities: universities.filter((university) => university.status === "partial").length,
    failedUniversities: universities.filter((university) => university.status === "failed").length,
    universitiesWithFaculties: universities.filter((university) => Number(university.facultyCount ?? 0) > 0).length,
    totalFacultyLinks: universities.reduce((total, university) => total + Number(university.facultyCount ?? 0), 0)
  };
}

function treeKey(value: string): string {
  return compactText(value);
}

function compactText(value: string): string {
  return foldText(value).replace(/[^a-z0-9]+/gu, "");
}

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "I")
    .replace(/\u011f/gu, "g")
    .replace(/\u011e/gu, "G")
    .replace(/\u00fc/gu, "u")
    .replace(/\u00dc/gu, "U")
    .replace(/\u015f/gu, "s")
    .replace(/\u015e/gu, "S")
    .replace(/\u00f6/gu, "o")
    .replace(/\u00d6/gu, "O")
    .replace(/\u00e7/gu, "c")
    .replace(/\u00c7/gu, "C")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function decodeURIComponentSafe(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(value);
  }
  return result;
}

const stopWords = new Set([
  "ve",
  "ile",
  "the",
  "and",
  "for",
  "birimi",
  "ana",
  "sayfa",
  "hakkinda",
  "kalite",
  "akreditasyon",
  "ekibi"
]);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
