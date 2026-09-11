import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

type JsonRecord = Record<string, any>;

const cwd = process.cwd();
const adminPort = 3314;
const adminUrl = `http://127.0.0.1:${adminPort}/admin/`;
const apiBaseUrl = "http://admin-api.qa";
const evidenceDir = resolve(cwd, "artifacts", "admin-audit");

let adminProcess: ChildProcessWithoutNullStreams | undefined;
let adminOutput = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(evidenceDir, { recursive: true });
  const viteBin = resolve(cwd, "node_modules", "vite", "bin", "vite.js");
  adminProcess = spawn(process.execPath, [
    viteBin,
    "--config",
    "apps/admin/vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(adminPort),
    "--strictPort"
  ], {
    cwd,
    env: { ...process.env, VITE_API_BASE_URL: apiBaseUrl },
    windowsHide: true
  });
  adminProcess.stdout.on("data", (chunk) => { adminOutput += chunk.toString(); });
  adminProcess.stderr.on("data", (chunk) => { adminOutput += chunk.toString(); });
  await waitForUrl(adminUrl, 30_000);
});

test.afterAll(() => {
  adminProcess?.kill();
});

test("auth, logout, stored-session verification and role routing are enforced", async ({ page }) => {
  const mock = await installMockApi(page);
  await page.goto(adminUrl);

  await login(page, "invalid@qa.local");
  await expect(page.getByText("E-posta veya şifre doğru değil.")).toBeVisible();

  await login(page, "student@qa.local");
  await expect(page.getByText("Bu hesap yönetici paneline erişemez.")).toBeVisible();

  await login(page, "editor@qa.local");
  await expect(page.getByText("editor@qa.local")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Yönetici bölümleri" }).getByRole("link")).toHaveCount(4);
  await expect(page.getByRole("link", { name: "Katalog", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Yayınla", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Kullanıcılar", exact: true })).toHaveCount(0);

  await page.evaluate(() => { window.location.hash = "#/users"; });
  await expect(page.getByRole("heading", { name: "Panel", exact: true })).toBeVisible();
  await expect(page.getByText("Bu bölüm için hesabınızın yetkisi yok.")).toBeVisible();

  await page.getByRole("link", { name: "Girişler", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ders Programı", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Üniversiteler, Bölümler ve Alan Adları" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Manuel Akademik Takvim" })).toHaveCount(0);
  expect(mock.requests.some((request) => request.path.includes("academic-unit-suggestions"))).toBe(false);

  await page.getByRole("button", { name: "Çıkış Yap" }).click();
  await expect(page.getByRole("heading", { name: "Admin Girişi" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  expect(writeCount(mock.writes, "POST", "/auth/logout")).toBe(1);
  expect(mock.writes.find((write) => write.path === "/auth/logout")?.body).toEqual({
    refreshToken: "content_editor-refresh"
  });

  await login(page, "editor@qa.local");
  mock.logoutShouldFail = true;
  await page.getByRole("button", { name: "Çıkış Yap" }).click();
  await expect(page.getByRole("heading", { name: "Admin Girişi" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  expect(writeCount(mock.writes, "POST", "/auth/logout")).toBe(2);

  await login(page, "editor@qa.local");
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    const observedWindow = window as Window & { __logoutRevocationAborted?: boolean };
    observedWindow.__logoutRevocationAborted = false;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith("/auth/logout")) return originalFetch(input, init);
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          observedWindow.__logoutRevocationAborted = true;
          reject(init?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    }) as typeof window.fetch;
  });
  await page.getByRole("button", { name: "Çıkış Yap" }).click();
  await expect(page.getByRole("heading", { name: "Admin Girişi" })).toBeVisible({ timeout: 1_000 });
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as Window & { __logoutRevocationAborted?: boolean }).__logoutRevocationAborted)
  ), { timeout: 4_000 }).toBe(true);

  await page.evaluate(() => {
    sessionStorage.setItem("academic-calendar-admin-session", JSON.stringify({
      accessToken: "expired-token",
      user: { id: "forged", fullName: "Forged Admin", email: "forged@qa.local", role: "super_admin" }
    }));
  });
  mock.expireStoredSession = true;
  await page.goto(`${adminUrl}?stored-session=1#/users`);
  await expect(page.getByRole("heading", { name: "Yönetici Paneli Açılıyor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kullanıcılar", exact: true })).toHaveCount(0);
  await expect(page.getByText("Yönetici oturumunuzun süresi doldu.")).toBeVisible();

  mock.expireStoredSession = false;
  await page.goto(`${adminUrl}?handoff=1#/handoff?accessToken=one-time-admin-token`);
  await expect(page.getByText("super@qa.local")).toBeVisible();
  await expect(page).not.toHaveURL(/one-time-admin-token/);
  expect(await page.evaluate(() => sessionStorage.getItem("academic-calendar-admin-session"))).toContain('"role":"super_admin"');
});

test("protected caches are isolated across same-tab session changes", async ({ page }) => {
  const mock = await installMockApi(page);
  mock.roleScopedSources = true;
  await page.goto(adminUrl);

  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();
  await expect(page.getByText("QA duyuru kaynağı")).toBeVisible();
  await expect.poll(() => mock.requests.filter((request) => request.path === "/admin/announcements/sources").length).toBe(1);
  mock.superSourceDelayMs = 2_000;
  const sourceStatusPanel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Kaynak Durumu" }) });
  await sourceStatusPanel.getByRole("button", { name: "Yenile", exact: true }).click();
  await expect.poll(() => mock.requests.filter((request) => request.path === "/admin/announcements/sources").length).toBe(2);

  await page.getByRole("button", { name: "Çıkış Yap" }).click();
  await expect(page.getByRole("heading", { name: "Admin Girişi" })).toBeVisible();
  await login(page, "university@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  await expect(page.getByText("Üniversite yöneticisi kaynağı")).toBeVisible();
  await expect.poll(() => mock.requests.filter((request) => request.path === "/admin/announcements/sources").length).toBe(3);
  await page.waitForTimeout(2_200);
  await expect(page.getByText("QA duyuru kaynağı")).toHaveCount(0);
  await expect(page.getByText("Üniversite yöneticisi kaynağı")).toBeVisible();
});

test("all nine super-admin routes and their primary controls render", async ({ page }) => {
  await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");

  const routes = [
    { link: "Panel", heading: "Panel", controls: ["Duyuru Kaynakları", "Katalog", "Girişler", "PDF İşlemleri", "Yayınlama", "Kullanıcılar"] },
    { link: "Girişler", heading: "Girişler", controls: ["Üniversite Ekle", "Alan Adını İlişkilendir", "Fakülte Ekle", "Bölüm Ekle", "Dersi Yayınla", "Satır Ekle", "Manuel Taslak Oluştur"] },
    { link: "Katalog", heading: "Katalog", controls: ["Yenile", "Oluştur", "Fakülte Ekle", "Bölüm Ekle"] },
    { link: "Duyuru Kaynakları", heading: "Duyuru Kaynakları", controls: ["Kaynağı Ekle", "Yenile"] },
    { link: "PDF İşlemleri", heading: "PDF İşlemleri", controls: ["Kaynak Oluştur", "İşle", "Kuyruğu Yükle"] },
    { link: "Yayınla", heading: "Yayınla", controls: ["Taslak Oluştur", "Yayınla", "Geri Al"] },
    { link: "Bildirimler", heading: "Bildirimler", controls: ["Zamanı Gelenleri İşle", "Başarısız İşler", "Teslimatlar"] },
    { link: "Denetim", heading: "Denetim", controls: ["Denetimi Yükle", "JSONL Dışa Aktar"] },
    { link: "Kullanıcılar", heading: "Kullanıcılar", controls: ["Yenile", "Ara", "Düzenle", "Sil"] }
  ];

  await expect(page.getByRole("navigation", { name: "Yönetici bölümleri" }).getByRole("link")).toHaveCount(9);
  for (const route of routes) {
    await page.getByRole("link", { name: route.link, exact: true }).click();
    await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
    for (const control of route.controls) {
      const locator = route.link === "Panel"
        ? page.locator(".dashboardGrid").getByRole("link", { name: new RegExp(control) }).first()
        : page.getByRole("button", { name: control, exact: true }).first();
      await expect(locator).toBeVisible();
    }
  }
});

test("global catalog, suggestion and manual-calendar CRUD buttons call the expected mock API", async ({ page }) => {
  const mock = await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Girişler", exact: true }).click();

  const catalogPanel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Üniversiteler, Bölümler ve Alan Adları" }) });
  const universityForm = catalogPanel.locator("form").first();
  await universityForm.getByLabel("Üniversite adı").fill("Yeni QA Üniversitesi");
  await universityForm.getByLabel("Üniversite şehri").fill("İzmir");
  await universityForm.getByLabel("E-posta alan adları").fill("yeni.edu.tr, ogr.yeni.edu.tr");
  await universityForm.getByRole("button", { name: "Üniversite Ekle" }).click();
  await expect(page.getByText("Üniversite oluşturuldu")).toBeVisible();

  await catalogPanel.getByRole("button", { name: "Seç", exact: true }).first().click();
  await catalogPanel.getByLabel("E-posta alan adı", { exact: true }).fill("qa.edu.tr");
  await catalogPanel.getByRole("button", { name: "Alan Adını İlişkilendir" }).click();
  await expect(page.getByText("E-posta alan adı ilişkilendirildi")).toBeVisible();

  await catalogPanel.getByLabel("Fakülte adı").fill("Fen Fakültesi");
  await catalogPanel.getByRole("button", { name: "Fakülte Ekle" }).click();
  await expect(page.getByText("Fakülte oluşturuldu")).toBeVisible();
  await catalogPanel.getByRole("button", { name: "Mühendislik Fakültesi" }).click();
  await catalogPanel.getByLabel("Bölüm adı").fill("Yazılım Mühendisliği");
  await catalogPanel.getByRole("button", { name: "Bölüm Ekle" }).click();
  await expect(page.getByText("Bölüm oluşturuldu")).toBeVisible();

  const reviewPanel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Fakülte ve Bölüm İncelemesi" }) });
  await reviewPanel.getByRole("button", { name: "Onayla" }).first().click();
  await expect(page.getByText("Akademik birim önerisi onaylandı")).toBeVisible();
  const rejectSuggestion = reviewPanel.getByRole("button", { name: "Reddet" }).first();
  const rejectedSuggestionWrites = writeCount(mock.writes, "POST", "/admin/users/academic-unit-suggestions/suggestion-reject/reject");
  await answerConfirmation(page, rejectSuggestion, "Bu akademik birim önerisini reddetmek istiyor musunuz?", false);
  expect(writeCount(mock.writes, "POST", "/admin/users/academic-unit-suggestions/suggestion-reject/reject")).toBe(rejectedSuggestionWrites);
  await expect(rejectSuggestion).toBeVisible();
  await answerConfirmation(page, rejectSuggestion, "Bu akademik birim önerisini reddetmek istiyor musunuz?", true);
  await expect(page.getByText("Akademik birim önerisi reddedildi")).toBeVisible();

  const manualPanel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Manuel Akademik Takvim" }) });
  await manualPanel.getByLabel("Manuel takvim üniversite ID").fill("qa-university");
  await manualPanel.getByLabel("Manuel takvim akademik yılı").fill("2026-2027");
  await manualPanel.getByLabel("Manuel takvim başlığı").fill("QA Akademik Takvimi");
  await manualPanel.getByLabel("1. etkinlik başlığı").fill("Kayıt Haftası");
  await manualPanel.getByLabel("1. etkinlik başlangıç tarihi").fill("2026-09-01");
  await expect(manualPanel.getByRole("button", { name: "1. etkinlik satırını kaldır" })).toBeDisabled();
  await manualPanel.getByRole("button", { name: "Satır Ekle" }).click();
  await manualPanel.getByLabel("2. etkinlik başlığı").fill("Ders Başlangıcı");
  await manualPanel.getByLabel("2. etkinlik başlangıç tarihi").fill("2026-09-15");
  await manualPanel.getByRole("button", { name: "2. etkinlik satırını kaldır" }).click();
  await manualPanel.getByRole("button", { name: "Manuel Taslak Oluştur" }).click();
  await expect(page.getByText("Manuel takvim taslağı oluşturuldu")).toBeVisible();

  await page.getByRole("link", { name: "Katalog", exact: true }).click();
  const catalogRoutePanel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Üniversiteler", exact: true }) });
  await catalogRoutePanel.getByRole("button", { name: "Fakülteler", exact: true }).first().click();
  const archiveUniversity = catalogRoutePanel.getByRole("button", { name: "Arşivle" }).first();
  const archiveWrites = writeCount(mock.writes, "DELETE", "/admin/universities/qa-university");
  await answerConfirmation(page, archiveUniversity, "Bu üniversiteyi arşivlemek istiyor musunuz? Üniversite aktif listelerden kaldırılacaktır.", false);
  expect(writeCount(mock.writes, "DELETE", "/admin/universities/qa-university")).toBe(archiveWrites);
  await answerConfirmation(page, archiveUniversity, "Bu üniversiteyi arşivlemek istiyor musunuz? Üniversite aktif listelerden kaldırılacaktır.", true);

  expect(mock.writes).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: "POST", path: "/admin/universities" }),
    expect.objectContaining({ method: "POST", path: "/admin/universities/qa-university/email-domains" }),
    expect.objectContaining({ method: "POST", path: "/admin/universities/qa-university/faculties" }),
    expect.objectContaining({ method: "POST", path: "/admin/users/academic-unit-suggestions/suggestion-approve/approve" }),
    expect.objectContaining({ method: "POST", path: "/admin/users/academic-unit-suggestions/suggestion-reject/reject" }),
    expect.objectContaining({ method: "POST", path: "/admin/calendars/manual" }),
    expect.objectContaining({ method: "DELETE", path: "/admin/universities/qa-university" })
  ]));
});

test("PDF review, publishing, notifications, audit export and user management flows work against mocks", async ({ page }) => {
  const mock = await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");

  await page.getByRole("link", { name: "PDF İşlemleri", exact: true }).click();
  const pdfForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaynak Oluştur" }) });
  await pdfForm.getByLabel("PDF kaynağı için üniversite ID").fill("qa-university");
  await pdfForm.getByLabel("Akademik yıl").fill("2026-2027");
  await pdfForm.getByLabel("Dosya adı").fill("calendar.pdf");
  await pdfForm.getByLabel("Resmî doğrudan PDF adresi").fill("https://qa.edu.tr/calendar.pdf");
  await pdfForm.getByRole("button", { name: "Kaynak Oluştur" }).click();
  await expect(page.getByText("PDF kaynağı oluşturuldu")).toBeVisible();
  await page.getByRole("button", { name: "İşle", exact: true }).click();
  await expect(page.getByText("PDF işlendi: 2 etkinlik çıkarıldı")).toBeVisible();
  await page.getByRole("button", { name: "Onayla" }).first().click();
  const rejectEvent = page.getByRole("button", { name: "Reddet" }).first();
  const rejectedEventWrites = writeCount(mock.writes, "POST", "/admin/extracted-events/event-2/reject");
  await answerConfirmation(page, rejectEvent, "Bu çıkarılmış etkinliği reddetmek istiyor musunuz?", false);
  expect(writeCount(mock.writes, "POST", "/admin/extracted-events/event-2/reject")).toBe(rejectedEventWrites);
  await expect(rejectEvent).toBeVisible();
  await answerConfirmation(page, rejectEvent, "Bu çıkarılmış etkinliği reddetmek istiyor musunuz?", true);

  await page.getByRole("link", { name: "Yayınla", exact: true }).click();
  const draftForm = page.locator("form");
  await draftForm.getByLabel("Taslak için üniversite ID").fill("qa-university");
  await draftForm.getByLabel("Kaynak PDF ID").fill("pdf-1");
  await draftForm.getByLabel("Taslak akademik yılı").fill("2026-2027");
  await draftForm.getByLabel("Takvim başlığı").fill("2026 Takvimi");
  await draftForm.getByRole("button", { name: "Taslak Oluştur" }).click();
  await page.getByRole("button", { name: "Yayınla", exact: true }).click();
  await expect(page.getByText("Takvim yayınlandı")).toBeVisible();
  const rollbackCalendar = page.getByRole("button", { name: "Geri Al" });
  const rollbackWrites = writeCount(mock.writes, "POST", "/admin/calendars/calendar-1/rollback");
  await answerConfirmation(page, rollbackCalendar, "Bu yayınlanmış takvimi geri almak istiyor musunuz? Öğrencilerin takvim görünümü etkilenebilir.", false);
  expect(writeCount(mock.writes, "POST", "/admin/calendars/calendar-1/rollback")).toBe(rollbackWrites);
  await answerConfirmation(page, rollbackCalendar, "Bu yayınlanmış takvimi geri almak istiyor musunuz? Öğrencilerin takvim görünümü etkilenebilir.", true);
  await expect(page.getByText("Takvim geri alındı")).toBeVisible();

  await page.getByRole("link", { name: "Bildirimler", exact: true }).click();
  await page.getByRole("button", { name: "Zamanı Gelenleri İşle" }).click();
  await expect(page.getByText("Gönderilen").locator("..")).toContainText("2");
  await page.getByRole("button", { name: "Başarısız İşler" }).click();
  await page.getByRole("button", { name: "Tekrar Dene" }).click();
  await page.getByRole("button", { name: "Başarısız İşler" }).click();
  await page.getByRole("button", { name: "Teslimatlar" }).last().click();
  await expect(page.getByText("provider-message-1")).toBeVisible();

  await page.getByRole("link", { name: "Denetim", exact: true }).click();
  await page.getByLabel("Denetim varlık ID").fill("calendar-1");
  await page.getByRole("button", { name: "Denetimi Yükle" }).click();
  await expect(page.getByText("Takvim yayınlandı")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSONL Dışa Aktar" }).click();
  expect((await download).suggestedFilename()).toBe("calendar-1.jsonl");

  await page.getByRole("link", { name: "Kullanıcılar", exact: true }).click();
  await page.getByLabel("Kullanıcı ara").fill("öğrenci");
  await page.getByLabel("Kullanıcı durumuna göre filtrele").selectOption("active");
  await page.getByRole("button", { name: "Ara" }).click();
  await page.getByRole("button", { name: "Düzenle" }).click();
  await page.getByLabel("Ad soyad").fill("Güncel Öğrenci");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Kullanıcı güncellendi")).toBeVisible();
  await page.getByRole("button", { name: "Düzenle" }).click();
  await page.getByRole("button", { name: "İptal" }).click();
  const deleteUser = page.getByRole("button", { name: "Sil" });
  const deleteWrites = writeCount(mock.writes, "DELETE", "/admin/users/user-1");
  await answerConfirmation(page, deleteUser, "Bu kullanıcıyı yönetimden silmek istiyor musunuz?", false);
  expect(writeCount(mock.writes, "DELETE", "/admin/users/user-1")).toBe(deleteWrites);
  await expect(page.getByText("Güncel Öğrenci")).toBeVisible();
  await answerConfirmation(page, deleteUser, "Bu kullanıcıyı yönetimden silmek istiyor musunuz?", true);
  await expect(page.getByText("Kullanıcı silindi")).toBeVisible();

  expect(mock.writes).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: "POST", path: "/admin/pdf-sources" }),
    expect.objectContaining({ method: "POST", path: "/admin/pdf-sources/pdf-1/process" }),
    expect.objectContaining({ method: "POST", path: "/admin/extracted-events/event-1/approve" }),
    expect.objectContaining({ method: "POST", path: "/admin/extracted-events/event-2/reject" }),
    expect.objectContaining({ method: "POST", path: "/admin/calendars/calendar-1/publish" }),
    expect.objectContaining({ method: "POST", path: "/admin/calendars/calendar-1/rollback" }),
    expect.objectContaining({ method: "POST", path: "/admin/notification-jobs/process-due" }),
    expect.objectContaining({ method: "PATCH", path: "/admin/users/user-1" }),
    expect.objectContaining({ method: "DELETE", path: "/admin/users/user-1" })
  ]));
  const pdfSourceWrite = mock.writes.find((write) => write.method === "POST" && write.path === "/admin/pdf-sources");
  expect(pdfSourceWrite?.body).toMatchObject({ url: "https://qa.edu.tr/calendar.pdf" });
  expect(pdfSourceWrite?.body.rawText).toBeUndefined();
});

test("source coverage shows the exact summary and selects a missing department for correction", async ({ page }) => {
  await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  const coverage = page.locator("section.sourceCoveragePanel");
  const summary = coverage.locator(".coverageSummary");
  await expect(summary).toBeVisible();
  await expect(summary.locator("strong")).toHaveText(["208", "17.360", "1", "0", "0", "0"]);

  const row = coverage.locator("article.coverageItem").filter({ hasText: "Bilgisayar Mühendisliği" });
  await expect(row).toContainText("QA Üniversitesi");
  await expect(row).toContainText("Mühendislik Fakültesi");
  await expect(row).toContainText("no_registered_department_announcement_source");
  await row.getByRole("button").click();

  const sourceForm = page.locator("form.sourceManagerForm");
  await expect(sourceForm.locator('select[name="universityId"]')).toHaveValue("qa-university");
  await sourceForm.locator('select[name="scopeType"]').selectOption("department");
  await expect(sourceForm.locator('select[name="facultyId"]')).toHaveValue("qa-faculty");
  await expect(sourceForm.locator('select[name="departmentId"]')).toHaveValue("qa-department");
});

test("source coverage filters and renders the inherited university academic calendar slot", async ({ page }) => {
  await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  const coverage = page.locator("section.sourceCoveragePanel");
  const sourceType = coverage.getByLabel("Kaynak türü");
  await expect(sourceType.locator('option[value="academic_calendar"]')).toHaveText("Akademik takvim");

  const calendarRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/admin/source-coverage"
      && url.searchParams.get("sourceType") === "academic_calendar"
      && url.searchParams.get("resolution") === "verified";
  });
  await sourceType.selectOption("academic_calendar");
  await expect(sourceType).toHaveValue("academic_calendar");
  await coverage.getByLabel("Kaynak çözüm durumu").selectOption("verified");
  await calendarRequest;

  const row = coverage.locator("article.coverageItem").filter({ hasText: "Akademik takvim" });
  await expect(row).toContainText("Final doğrulandı");
  await expect(row).toContainText("Üniversite geneli akademik takvimden devralındı");
  await expect(row.getByRole("link", { name: "https://qa.edu.tr/akademik-takvim.pdf" })).toBeVisible();
  await expect(coverage.locator(".coverageSummary strong")).toHaveText(["208", "17.360", "0", "0", "0", "1"]);
});

test("208-university source workbench exposes editable URL, parser, structure and live previews", async ({ page }) => {
  const mock = await installMockApi(page);
  const qaUniversity = {
    ...mock.universities[0],
    websiteUrl: "https://qa.edu.tr",
    announcementUrl: "https://qa.edu.tr/duyurular",
    academicCalendarUrl: "https://qa.edu.tr/akademik-takvim.pdf"
  };
  mock.universities = [
    qaUniversity,
    ...Array.from({ length: 207 }, (_, index) => ({
      id: `university-${String(index + 2).padStart(3, "0")}`,
      name: `Test Üniversitesi ${String(index + 2).padStart(3, "0")}`,
      city: index % 2 === 0 ? "İstanbul" : "Ankara",
      type: "state",
      status: "active",
      emailDomains: []
    }))
  ] as any;
  mock.announcementSources = [{
    ...mock.announcementSources[0],
    ownerUniversityId: "qa-university",
    homepageUrl: "https://qa.edu.tr",
    discoveryMethod: "catalog_website",
    status: "active",
    trustStatus: "trusted",
    healthStatus: "healthy",
    itemCount: 3,
    lastCheckedAt: "2026-09-11T08:30:00.000Z",
    parserConfig: {
      itemSelector: "main article a",
      titleSelector: ".title",
      linkSelector: "a",
      dateSelector: "time",
      contentSelector: ".summary"
    },
    evidence: {
      parserProfile: "html",
      selector: "main article a",
      sampleItemUrls: ["https://qa.edu.tr/duyurular/ornek"]
    }
  }];

  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  const workbench = page.locator("section.universitySourceWorkbench");
  await expect(workbench.getByText("208 üniversite · 832 kaynak alanı", { exact: true })).toBeVisible();
  await expect(workbench.locator(".universityPickerItem")).toHaveCount(208);
  await workbench.getByLabel("208 üniversitede ara").fill("QA Üniversitesi");
  await expect(workbench.locator(".universityPickerItem")).toHaveCount(1);
  await workbench.locator(".universityPickerItem").click();
  await expect(workbench.locator("article.universitySourceCard")).toHaveCount(4);

  const announcementCard = workbench.locator('[data-source-type="announcement"]');
  await expect(announcementCard).toContainText("Duyuru liste sayfası");
  await expect(announcementCard).toContainText("https://qa.edu.tr/duyurular");
  await expect(announcementCard.getByLabel("Duyuru liste öğesi seçici")).toHaveValue("main article a");
  await announcementCard.getByRole("button", { name: "Test Et / Önizle ve Devreye Al", exact: true }).click();
  await expect(announcementCard.getByRole("status")).toContainText("3/3 içerik");
  await expect(announcementCard.getByRole("status")).toContainText("Kayıt Yenileme Duyurusu");
  await expect(announcementCard.getByRole("status")).toContainText("Devreye alma: Aktif");
  expect(mock.writes.find((write) => write.method === "POST" && write.path === "/admin/announcements/source-profiles/qa-university/announcement/preview")?.body)
    .toEqual({ activateWhenHealthy: true });

  await announcementCard.getByLabel("Duyuru çekilen URL").fill("https://qa.edu.tr/yeni-duyurular");
  await announcementCard.getByLabel("Duyuru parser").selectOption("rss");
  await announcementCard.getByLabel("Duyuru liste öğesi seçici").fill(".notice-row");
  await announcementCard.getByLabel("Duyuru başlık seçici").fill("h3");
  await announcementCard.getByLabel("Duyuru içerik bağlantısı seçici").fill("a.details");
  await announcementCard.getByLabel("Duyuru tarih seçici").fill(".published-at");
  await announcementCard.getByLabel("Duyuru özet / gövde seçici").fill(".description");
  await announcementCard.getByRole("button", { name: "Kaydet", exact: true }).click();
  expect(mock.writes.find((write) => write.method === "PUT" && write.path === "/admin/announcements/source-profiles/qa-university/announcement")?.body)
    .toMatchObject({
      sourceUrl: "https://qa.edu.tr/yeni-duyurular",
      parser: "rss",
      parserConfig: {
        itemSelector: ".notice-row",
        titleSelector: "h3",
        linkSelector: "a.details",
        dateSelector: ".published-at",
        contentSelector: ".description"
      }
    });

  const calendarCard = workbench.locator('[data-source-type="academic_calendar"]');
  await expect(calendarCard).toContainText("Akademik takvim HTML sayfası veya PDF");
  await calendarCard.getByLabel("Akademik Takvim çekilen URL").fill("https://qa.edu.tr/takvim-2026.pdf");
  await calendarCard.getByRole("button", { name: "Kaydet", exact: true }).click();
  expect(mock.writes.find((write) => write.method === "PUT" && write.path === "/admin/announcements/source-profiles/qa-university/academic_calendar")?.body)
    .toMatchObject({ sourceUrl: "https://qa.edu.tr/takvim-2026.pdf", parser: "auto" });
  await calendarCard.getByRole("button", { name: "Test Et / Önizle ve Devreye Al", exact: true }).click();
  await expect(calendarCard.getByRole("status")).toContainText("2026-2027 Akademik Takvim");
  await workbench.screenshot({ path: resolve(evidenceDir, "university-source-workbench-208.png") });
});

test("announcement source filters are sent to the server with the bounded page size", async ({ page }) => {
  const mock = await installMockApi(page);
  mock.announcementSources = [{
    ...mock.announcementSources[0],
    scopeType: "department",
    scopeId: "qa-department",
    sourceName: "QA öğrenci bülteni",
    contentType: "news",
    status: "active",
    trustStatus: "trusted"
  }];
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  const filterForm = page.locator("form.sourceFilterForm");
  await filterForm.locator('input[name="search"]').fill("  öğrenci bülteni  ");
  await filterForm.locator('select[name="trustStatus"]').selectOption("trusted");
  await filterForm.locator('select[name="contentType"]').selectOption("news");
  await filterForm.locator('select[name="scopeType"]').selectOption("department");
  const requestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/admin/announcements/sources"
      && url.searchParams.get("search") === "öğrenci bülteni";
  });
  await filterForm.getByRole("button", { name: "Filtrele", exact: true }).click();

  const requestUrl = new URL((await requestPromise).url());
  expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
    limit: "101",
    offset: "0",
    search: "öğrenci bülteni",
    trustStatus: "trusted",
    contentType: "news",
    scopeType: "department"
  });
  await expect(page.locator("form.sourceEditor")).toHaveCount(1);
  await expect(page.locator("form.sourceEditor")).toContainText("QA öğrenci bülteni");
});

test("announcement source next and previous buttons request server-side 100-row pages", async ({ page }) => {
  const mock = await installMockApi(page);
  mock.announcementSources = Array.from({ length: 205 }, (_, index) => ({
    ...mock.announcementSources[0],
    id: `paged-source-${String(index + 1).padStart(3, "0")}`,
    scopeId: `paged-scope-${String(index + 1).padStart(3, "0")}`,
    sourceName: `Paged source ${String(index + 1).padStart(3, "0")}`,
    sourceUrl: `https://qa.edu.tr/sources/${index + 1}`,
    canonicalUrl: `https://qa.edu.tr/sources/${index + 1}`
  }));
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  const statusPanel = page.locator("section.panel").filter({ has: page.locator("form.sourceFilterForm") });
  await expect(statusPanel.locator("form.sourceEditor")).toHaveCount(100);
  await expect(statusPanel.locator("form.sourceEditor").first()).toContainText("Paged source 001");
  const pagination = statusPanel.locator(".reviewPagination");
  await expect(pagination).toContainText("1");
  await expect(pagination).toContainText("100");

  const nextRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/admin/announcements/sources"
      && url.searchParams.get("offset") === "100";
  });
  await pagination.getByRole("button", { name: "Sonraki", exact: true }).click();
  const nextUrl = new URL((await nextRequest).url());
  expect(nextUrl.searchParams.get("limit")).toBe("101");
  await expect(statusPanel.locator("form.sourceEditor")).toHaveCount(100);
  await expect(statusPanel.locator("form.sourceEditor").first()).toContainText("Paged source 101");
  await expect(statusPanel.locator("form.sourceEditor").last()).toContainText("Paged source 200");

  const previousRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/admin/announcements/sources"
      && url.searchParams.get("offset") === "0";
  });
  await pagination.getByRole("button", { name: "Önceki", exact: true }).click();
  const previousUrl = new URL((await previousRequest).url());
  expect(previousUrl.searchParams.get("limit")).toBe("101");
  await expect(statusPanel.locator("form.sourceEditor")).toHaveCount(100);
  await expect(statusPanel.locator("form.sourceEditor").first()).toContainText("Paged source 001");
});

test("source review submits the exact source CAS fence shown in the admin UI", async ({ page }) => {
  const mock = await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  await page.getByLabel("QA duyuru kaynağı inceleme notu").fill("Resmî menü doğrulandı");
  await page.getByRole("button", { name: "Güvenilir Olarak Onayla", exact: true }).click();

  const write = mock.writes.find((entry) =>
    entry.method === "POST" && entry.path === "/admin/announcements/sources/source-review-cas/approve");
  expect(write?.body).toEqual({
    expectedSourceDefinitionVersion: "source-definition-v1",
    expectedCanonicalUrl: "https://qa.edu.tr/duyurular",
    expectedTrustStatus: "quarantined",
    expectedSourceStatus: "inactive",
    expectedApprovalPending: false,
    note: "Resmî menü doğrulandı"
  });
  await expect(page.getByText("Kaynak güvenilir olarak onaylandı")).toBeVisible();
});

test("a crash-stuck source remains visibly pending and its approval can be retried", async ({ page }) => {
  const mock = await installMockApi(page);
  mock.announcementSources = [{
    ...mock.announcementSources[0],
    status: "active",
    trustStatus: "trusted",
    approvalPending: true,
    healthStatus: "healthy",
    itemCount: 1,
    updatedAt: "2026-09-10T08:02:00.000Z"
  }];
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  const sourceForm = page.locator("form.sourceEditor");
  await expect(sourceForm.getByText("İnceleme bekliyor", { exact: true })).toBeVisible();
  await expect(sourceForm.getByRole("button", { name: "Şimdi Tara", exact: true })).toBeDisabled();
  const approve = sourceForm.getByRole("button", { name: "Güvenilir Olarak Onayla", exact: true });
  await expect(approve).toBeEnabled();
  await approve.click();

  const write = mock.writes.find((entry) =>
    entry.method === "POST" && entry.path === "/admin/announcements/sources/source-review-cas/approve");
  expect(write?.body).toMatchObject({
    expectedSourceDefinitionVersion: "source-definition-v1",
    expectedCanonicalUrl: "https://qa.edu.tr/duyurular",
    expectedTrustStatus: "trusted",
    expectedSourceStatus: "active",
    expectedApprovalPending: true
  });
  await expect(page.getByText("Kaynak güvenilir olarak onaylandı")).toBeVisible();
  await expect(approve).toBeDisabled();
});

test("source metadata edit submits its exact optimistic-concurrency fence", async ({ page }) => {
  const mock = await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  const sourceForm = page.locator("form.sourceEditor");
  await sourceForm.getByLabel("Kaynak adı").fill("Düzeltilmiş QA kaynağı");
  await sourceForm.getByRole("button", { name: "Kaydet", exact: true }).click();

  const write = mock.writes.find((entry) =>
    entry.method === "PUT" && entry.path === "/admin/announcements/sources/source-review-cas");
  expect(write?.body).toMatchObject({
    expectedSourceDefinitionVersion: "source-definition-v1",
    expectedCanonicalUrl: "https://qa.edu.tr/duyurular",
    expectedTrustStatus: "quarantined",
    expectedSourceStatus: "inactive",
    expectedApprovalPending: false,
    expectedUpdatedAt: "2026-09-10T08:00:00.000Z",
    sourceName: "Düzeltilmiş QA kaynağı"
  });
  await expect(page.getByText("Kaynak ayarları güncellendi")).toBeVisible();
});

test("source deactivation sends its observed fence and refreshes instead of applying a stale request", async ({ page }) => {
  const mock = await installMockApi(page);
  mock.announcementSources = [{
    ...mock.announcementSources[0],
    status: "active",
    trustStatus: "trusted",
    approvalPending: false
  }];
  mock.failSourceDeactivateConflict = true;
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  const sourceForm = page.locator("form.sourceEditor");
  const deactivate = sourceForm.getByRole("button", { name: "Pasife Al", exact: true });
  await answerConfirmation(page, deactivate, "Bu duyuru kaynağını pasife almak istiyor musunuz? Otomatik veri alımı duracaktır.", true);
  await expect(page.getByText("Kaynak başka bir işlemde değişti; eski pasife alma isteği uygulanmadı ve liste yenilendi")).toBeVisible();
  expect(mock.announcementSources[0]?.status).toBe("active");

  const staleWrite = mock.writes.filter((entry) =>
    entry.method === "DELETE" && entry.path === "/admin/announcements/sources/source-review-cas").at(-1);
  expect(staleWrite?.body).toEqual({
    expectedSourceDefinitionVersion: "source-definition-v1",
    expectedCanonicalUrl: "https://qa.edu.tr/duyurular",
    expectedTrustStatus: "trusted",
    expectedSourceStatus: "active",
    expectedApprovalPending: false
  });

  mock.failSourceDeactivateConflict = false;
  await answerConfirmation(page, deactivate, "Bu duyuru kaynağını pasife almak istiyor musunuz? Otomatik veri alımı duracaktır.", true);
  await expect(page.getByText("Kaynak pasife alındı")).toBeVisible();
  expect(mock.announcementSources[0]?.status).toBe("inactive");
});

test("content review resets drafts on a new CAS fence and preserves API-safe body blocks", async ({ page }) => {
  const mock = await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  let card = page.locator("details.reviewItemCard").filter({ hasText: "Sunucudaki eski başlık" });
  await expect(card).toBeVisible();
  await card.locator("summary").click();
  await card.getByLabel("Çekilen başlık").fill("Tarayıcıdaki eski taslak");

  mock.reviewItems = [{
    ...mock.reviewItems[0],
    snapshotId: "snapshot-2",
    contentFingerprint: "b".repeat(64),
    reviewRevision: "revision-2",
    title: "Sunucudaki yeni başlık",
    summary: "Sunucudaki yeni özet",
    body: [{ type: "bullet", text: "Sunucudaki yeni madde" }]
  }];
  await page.getByRole("button", { name: "Kuyruğu Yenile", exact: true }).click();

  card = page.locator("details.reviewItemCard").filter({ hasText: "Sunucudaki yeni başlık" });
  await expect(card).toBeVisible();
  await card.locator("summary").click();
  await expect(card.getByLabel("Çekilen başlık")).toHaveValue("Sunucudaki yeni başlık");
  await expect(card.getByLabel("1. içerik bloğu türü")).toHaveValue("bullet");
  await expect(card.getByLabel("1. içerik bloğu metni")).toHaveValue("Sunucudaki yeni madde");

  const longBody = "x".repeat(1_605);
  await card.getByLabel("1. içerik bloğu metni").fill(longBody);
  await card.getByRole("button", { name: "Düzeltmeleri Kaydet", exact: true }).click();
  await expect(page.getByText("İçerik ve sınıflandırma düzeltmeleri kaydedildi")).toBeVisible();

  const write = mock.writes.filter((entry) => entry.method === "PATCH" && entry.path === "/admin/announcements/review-items/review-item-1").at(-1);
  expect(write?.body).toMatchObject({
    expectedSnapshotId: "snapshot-2",
    expectedContentFingerprint: "b".repeat(64),
    expectedReviewRevision: "revision-2",
    title: "Sunucudaki yeni başlık"
  });
  expect(write?.body.body).toHaveLength(3);
  expect(write?.body.body.every((block: JsonRecord) => block.type === "bullet" && block.text.length <= 800)).toBe(true);
  expect(write?.body.body.map((block: JsonRecord) => block.text).join("")).toBe(longBody);
});

test("content approval atomically submits the current edited draft", async ({ page }) => {
  const mock = await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  const card = page.locator("details.reviewItemCard").filter({ hasText: "Sunucudaki eski başlık" });
  await card.locator("summary").click();
  await card.getByLabel("Çekilen başlık").fill("İnsan tarafından düzeltilen başlık");
  await card.getByLabel("Özet").fill("İnsan tarafından düzeltilen özet");
  await card.getByLabel("Grup").selectOption("course_registration");
  await card.getByRole("button", { name: "Onayla", exact: true }).click();

  const write = mock.writes.filter((entry) =>
    entry.method === "PATCH" && entry.path === "/admin/announcements/review-items/review-item-1").at(-1);
  expect(write?.body).toMatchObject({
    title: "İnsan tarafından düzeltilen başlık",
    summary: "İnsan tarafından düzeltilen özet",
    topic: "course_registration",
    reviewStatus: "approved",
    expectedSnapshotId: "snapshot-1",
    expectedContentFingerprint: "a".repeat(64),
    expectedReviewRevision: "revision-1"
  });
  await expect(page.getByText("İçerik, düzeltmeleriyle birlikte onaylandı")).toBeVisible();
});

test("LLM review controls expose retry state and suppress duplicate in-flight submissions", async ({ page }) => {
  const mock = await installMockApi(page);
  mock.llmSettings = {
    enabled: true,
    provider: "openai",
    model: "gpt-5-mini",
    apiKeyConfigured: true,
    keyLastFour: "1234",
    lastTestStatus: "success",
    revision: 1
  };
  mock.llmReviewDelayMs = 300;
  mock.llmReviewShouldFail = true;
  mock.reviewItems = [{
    ...mock.reviewItems[0],
    llmReviewFailure: {
      disposition: "retry_scheduled",
      reasonCode: "provider_unavailable",
      attemptCount: 1,
      lastAttemptedAt: "2026-09-10T09:00:00.000Z",
      retryAfter: "2026-09-10T09:01:00.000Z"
    }
  }];
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  const card = page.locator("details.reviewItemCard").first();
  await card.locator("summary").click();
  await expect(card.getByText(/Sağlayıcı geçici olarak kullanılamadı/u)).toBeVisible();
  const single = card.getByRole("button", { name: "LLM ile İncele", exact: true });
  await single.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(card.getByRole("button", { name: "LLM İnceliyor...", exact: true })).toBeDisabled();
  await expect(page.getByText(/503 LLM provider is temporarily unavailable/u)).toBeVisible();
  await card.locator("summary").click();
  await expect(card.getByText(/Deneme: 2/u)).toBeVisible();
  expect(writeCount(mock.writes, "POST", "/admin/announcements/review-items/review-item-1/llm-review")).toBe(1);

  mock.llmReviewShouldFail = false;
  await single.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(card.getByRole("button", { name: "LLM İnceliyor...", exact: true })).toBeDisabled();
  await expect(page.getByText("İçerik LLM ile incelendi; insan onayı bekliyor")).toBeVisible();
  expect(writeCount(mock.writes, "POST", "/admin/announcements/review-items/review-item-1/llm-review")).toBe(2);

  const batchBase = { ...mock.reviewItems[0], llmClassification: null, llmReviewFailure: null };
  mock.batchLlmFailureItemId = "review-batch-b";
  mock.reviewItems = [
    { ...batchBase, id: "review-batch-a", title: "First same-source item", contentFingerprint: "b".repeat(64), snapshotId: "snapshot-batch-0", reviewRevision: "revision-batch-a" },
    { ...batchBase, id: "review-batch-b", title: "Failing same-source item", contentFingerprint: "c".repeat(64), snapshotId: "snapshot-batch-0", reviewRevision: "revision-batch-b" },
    { ...batchBase, id: "review-batch-c", title: "Last same-source item", contentFingerprint: "d".repeat(64), snapshotId: "snapshot-batch-0", reviewRevision: "revision-batch-c" }
  ];
  await page.getByRole("button", { name: "Kuyruğu Yenile", exact: true }).click();

  const batch = page.getByRole("button", { name: "Bekleyenleri LLM ile İncele", exact: true });
  await batch.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole("button", { name: "LLM İnceliyor...", exact: true })).toBeDisabled();
  await expect(page.getByText("LLM kuyruğu: 2/3 incelendi, 1 başarısız")).toBeVisible();
  expect(writeCount(mock.writes, "POST", "/admin/announcements/review-items/review-item-1/llm-review")).toBe(2);
  const batchWrites = mock.writes.filter((write) =>
    write.method === "POST" && write.path === "/admin/announcements/review-items/llm-review");
  expect(batchWrites).toHaveLength(3);
  expect(batchWrites.map((write) => write.body)).toEqual([
    { limit: 1 }, { limit: 1 }, { limit: 1 }
  ]);
  expect(mock.reviewItems.filter((item) => item.llmClassification).map((item) => item.id)).toEqual([
    "review-batch-a", "review-batch-c"
  ]);
  expect(mock.reviewItems.find((item) => item.id === "review-batch-b")?.llmReviewFailure).toMatchObject({
    disposition: "manual_review"
  });
  expect(new Set(mock.reviewItems.map((item) => item.snapshotId))).toEqual(new Set(["snapshot-batch-3"]));

  mock.batchLlmFailureItemId = "";
  mock.reviewItems = Array.from({ length: 21 }, (_, index) => ({
    ...batchBase,
    id: `review-cap-${index + 1}`,
    title: `Capped item ${index + 1}`,
    contentFingerprint: (index + 1).toString(16).padStart(2, "0").repeat(32),
    snapshotId: "snapshot-cap-0",
    reviewRevision: `revision-cap-${index + 1}`
  }));
  await page.getByRole("button", { name: "Kuyruğu Yenile", exact: true }).click();
  const writesBeforeCap = writeCount(mock.writes, "POST", "/admin/announcements/review-items/llm-review");
  await batch.click();
  await expect(page.getByText(/ilk 20 kayıt işlendi, kuyrukta içerik kaldı/u)).toBeVisible();
  expect(writeCount(mock.writes, "POST", "/admin/announcements/review-items/llm-review") - writesBeforeCap).toBe(20);
  expect(mock.reviewItems.filter((item) => !item.llmClassification && !item.llmReviewFailure)).toHaveLength(1);

  mock.reviewItems = [{
    ...batchBase,
    id: "review-http-failure",
    title: "HTTP failure item",
    contentFingerprint: "e".repeat(64),
    snapshotId: "snapshot-http-failure",
    reviewRevision: "revision-http-failure"
  }];
  mock.batchLlmShouldFailHttp = true;
  await page.getByRole("button", { name: "Kuyruğu Yenile", exact: true }).click();
  const reloadsBeforeFailure = mock.requests.filter((request) =>
    request.method === "GET" && request.path === "/admin/announcements/review-items").length;
  await batch.click();
  await expect(page.getByText("503 batch LLM unavailable")).toBeVisible();
  await expect.poll(() => mock.requests.filter((request) =>
    request.method === "GET" && request.path === "/admin/announcements/review-items").length
  ).toBeGreaterThan(reloadsBeforeFailure);
});

test("LLM settings form sends its loaded revision and cannot overwrite a newer server decision", async ({ page }) => {
  const mock = await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.evaluate(() => { window.location.hash = "#/sources"; });

  const panel = page.locator('section[aria-labelledby="llm-settings-heading"]');
  const form = panel.locator("form.llmSettingsForm");
  await expect(form.locator('input[name="expectedRevision"]')).toHaveValue("0");
  await form.locator('input[name="model"]').fill("saved-model");
  await form.locator("button").click();

  let write = mock.writes.filter((entry) =>
    entry.method === "PUT" && entry.path === "/admin/announcements/llm-settings").at(-1);
  expect(write?.body).toMatchObject({ expectedRevision: 0, provider: "openai", model: "saved-model", enabled: false });
  await expect(form.locator('input[name="expectedRevision"]')).toHaveValue("1");

  await form.locator('input[name="model"]').fill("stale-form-model");
  mock.llmSettings = {
    enabled: true,
    provider: "openai",
    model: "server-winner-model",
    apiKeyConfigured: true,
    keyLastFour: "9876",
    lastTestStatus: "untested",
    revision: 2
  };
  await form.locator("button").click();

  write = mock.writes.filter((entry) =>
    entry.method === "PUT" && entry.path === "/admin/announcements/llm-settings").at(-1);
  expect(write?.body).toMatchObject({ expectedRevision: 1, model: "stale-form-model", enabled: false });
  expect(mock.llmSettings).toMatchObject({
    enabled: true,
    model: "server-winner-model",
    apiKeyConfigured: true,
    keyLastFour: "9876",
    revision: 2
  });
  await expect(page.getByText("409 LLM settings changed after they were loaded. Refresh and retry.")).toBeVisible();
});

test("schedule source review uses server filters and pages beyond the first 50 rows", async ({ page }) => {
  const mock = await installMockApi(page);
  mock.scheduleReviewSources = Array.from({ length: 55 }, (_, index) => ({
    ...mock.scheduleReviewSources[0],
    id: `schedule-paged-${String(index + 1).padStart(3, "0")}`,
    departmentId: `schedule-department-${String(index + 1).padStart(3, "0")}`,
    scheduleType: index % 2 === 0 ? "course_schedule" : "exam_schedule",
    lifecycle: "review_required",
    revision: index + 1
  }));
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  const panel = page.locator("section.scheduleReviewPanel");
  await expect(panel.locator("article.scheduleReviewCard")).toHaveCount(50);
  const nextRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/admin/calendars/schedule-sources" && url.searchParams.get("offset") === "50";
  });
  await panel.getByRole("button", { name: "Sonraki", exact: true }).click();
  const nextUrl = new URL((await nextRequest).url());
  expect(nextUrl.searchParams.get("limit")).toBe("51");
  await expect(panel.locator("article.scheduleReviewCard")).toHaveCount(5);

  const filterRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/admin/calendars/schedule-sources"
      && url.searchParams.get("scheduleType") === "exam_schedule";
  });
  await panel.getByLabel("Program türü").selectOption("exam_schedule");
  const filterUrl = new URL((await filterRequest).url());
  expect(filterUrl.searchParams.get("offset")).toBe("0");
  expect(filterUrl.searchParams.get("limit")).toBe("51");
  await expect(panel.locator("article.scheduleReviewCard")).toHaveCount(27);
});

test("schedule candidates can be reopened for correction before explicit super-admin publication", async ({ page }) => {
  const mock = await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();

  let card = page.locator("article.scheduleReviewCard").filter({ hasText: "Matematik" });
  await expect(card.getByText("İnsan incelemesi gerekli", { exact: true })).toBeVisible();
  await card.getByLabel("7. satır başlığı").fill("Matematik I");
  await card.getByLabel("7. satır konumu").fill("B202");
  await card.getByRole("button", { name: "Satırı Kaydet", exact: true }).click();
  await expect(page.getByText("Program satırı 7 kaydedildi")).toBeVisible();

  const editWrite = mock.writes.find((entry) => entry.method === "PATCH" && entry.path.endsWith("/candidates/7"));
  expect(editWrite?.body).toEqual({
    expectedRevision: 2,
    title: "Matematik I",
    date: null,
    dayOfWeek: 1,
    startTime: "09:00",
    endTime: "10:00",
    location: "B202"
  });

  card = page.locator("article.scheduleReviewCard").filter({ hasText: "qa-department" });
  await card.getByLabel("Program akademik yılı").fill("2026-2027");
  await card.getByLabel("Program dönemi").selectOption("fall");
  await card.getByLabel("Ders başlangıç tarihi").fill("2026-09-01");
  await card.getByLabel("Ders bitiş tarihi").fill("2026-12-31");
  await card.getByRole("button", { name: "Seçilenleri Onayla ve Sahnele", exact: true }).click();
  await expect(page.getByText("Onaylı program satırları görünmez olarak sahnelendi; süper yönetici yayını bekleniyor")).toBeVisible();

  const reviewWrite = mock.writes.find((entry) => entry.method === "POST" && entry.path.endsWith("/schedule-source-1/review"));
  expect(reviewWrite?.body).toMatchObject({
    expectedRevision: 3,
    decision: "approve",
    academicYear: "2026-2027",
    term: "fall",
    courseRangeStart: "2026-09-01",
    courseRangeEnd: "2026-12-31",
    approvedRowNumbers: [7]
  });

  card = page.locator("article.scheduleReviewCard").filter({ hasText: "qa-department" });
  await expect(card.getByText("Yayın bekliyor", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "İncelemeye Geri Aç", exact: true }).click();
  const reopenWrite = mock.writes.find((entry) => entry.method === "POST" && entry.path.endsWith("/schedule-source-1/reopen-review"));
  expect(reopenWrite?.body).toEqual({ expectedRevision: 5 });
  await expect(page.getByText("Sahnelenen program geri alındı; kaynak yeniden insan incelemesine açıldı")).toBeVisible();

  card = page.locator("article.scheduleReviewCard").filter({ hasText: "qa-department" });
  await expect(card.getByText("İnsan incelemesi gerekli", { exact: true })).toBeVisible();
  await card.getByLabel("Program akademik yılı").fill("2026-2027");
  await card.getByLabel("Program dönemi").selectOption("fall");
  await card.getByLabel("Ders başlangıç tarihi").fill("2026-09-01");
  await card.getByLabel("Ders bitiş tarihi").fill("2026-12-31");
  await card.getByRole("button", { name: "Seçilenleri Onayla ve Sahnele", exact: true }).click();

  card = page.locator("article.scheduleReviewCard").filter({ hasText: "qa-department" });
  await card.getByRole("button", { name: "Sahnelenen Programı Yayınla", exact: true }).click();
  const publishWrite = mock.writes.find((entry) => entry.method === "POST" && entry.path.endsWith("/schedule-source-1/publish"));
  expect(publishWrite?.body).toEqual({ expectedRevision: 9 });
  await expect(page.getByText("Sahnelenen program satırları süper yönetici tarafından yayınlandı")).toBeVisible();
});

test("native validation blocks malformed forms and API mutation errors stay visible without page errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const mock = await installMockApi(page);
  await page.goto(adminUrl);
  await login(page, "super@qa.local");
  await page.getByRole("link", { name: "Girişler", exact: true }).click();

  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Üniversite Ekle" }) });
  const writesBefore = mock.writes.length;
  await form.getByRole("button", { name: "Üniversite Ekle" }).click();
  expect(mock.writes).toHaveLength(writesBefore);
  expect(await form.locator(":invalid").count()).toBeGreaterThan(0);

  await form.getByLabel("Üniversite adı").fill("Hata Üniversitesi");
  await form.getByLabel("Üniversite şehri").fill("Ankara");
  await form.getByLabel("Resmî web sitesi").fill("geçersiz-adres");
  await form.getByRole("button", { name: "Üniversite Ekle" }).click();
  expect(mock.writes).toHaveLength(writesBefore);
  await form.getByLabel("Resmî web sitesi").fill("https://qa.edu.tr");
  mock.failUniversityCreate = true;
  await form.getByRole("button", { name: "Üniversite Ekle" }).click();
  await expect(page.getByRole("alert")).toContainText("422");
  await expect(page.getByRole("alert")).not.toContainText("database-secret");
  expect(pageErrors).toEqual([]);

  const scheduleForm = page.locator("form.scheduleForm");
  await scheduleForm.getByLabel("Üniversite").selectOption("qa-university");
  await scheduleForm.getByLabel("Fakülte").selectOption("qa-faculty");
  await scheduleForm.getByLabel("Bölüm").selectOption("qa-department");
  await scheduleForm.getByLabel("Akademik yıl").fill("2026-2027");
  await scheduleForm.getByLabel("Ders başlığı").fill("Tek Seferlik Seminer");
  await scheduleForm.locator('input[name="startDate"]').fill("2026-09-18");
  await scheduleForm.getByLabel("Haftalık tekrarla").uncheck();
  await expect(scheduleForm.getByLabel("Tekrar sonu")).toBeDisabled();
  expect(await scheduleForm.evaluate((element: HTMLFormElement) => element.checkValidity())).toBe(true);

  await page.getByRole("link", { name: "Katalog", exact: true }).click();
  const xssPayload = '<img src=x onerror="window.__adminXss=1">';
  await expect(page.getByText(xssPayload)).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__adminXss)).toBeUndefined();
});

test("interactive controls are named and representative routes do not overflow 320-1440px viewports", async ({ page }) => {
  await installMockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(adminUrl);
  await login(page, "super@qa.local");

  for (const route of ["dashboard", "inputs", "catalog", "sources", "pdf", "calendar", "notifications", "audit", "users"]) {
    await page.goto(`${adminUrl}#/${route}`);
    await expect(page.locator("main.shell")).toBeVisible();
    expect(await unnamedInteractiveControls(page), `${route} has unnamed controls`).toEqual([]);
    const layout = await documentLayout(page);
    expect(layout.scrollWidth, `${route} overflows at 390px: ${layout.widest.join(" | ")}`).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(await trappedHorizontalTables(page), `${route} has unreachable table actions`).toEqual([]);
  }

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    for (const route of ["dashboard", "inputs", "sources", "users"]) {
      await page.goto(`${adminUrl}#/${route}`);
      const layout = await documentLayout(page);
      expect(layout.scrollWidth, `${route} overflows at ${viewport.width}px: ${layout.widest.join(" | ")}`).toBeLessThanOrEqual(layout.clientWidth + 1);
    }
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${adminUrl}#/inputs`);
  await page.screenshot({ path: resolve(evidenceDir, "inputs-320.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${adminUrl}#/users`);
  await page.screenshot({ path: resolve(evidenceDir, "users-1440.png"), fullPage: true });
});

async function login(page: Page, email: string): Promise<void> {
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("QaAdmin-2026!");
  await page.getByRole("button", { name: "Admin Paneline Gir" }).click();
}

async function answerConfirmation(
  page: Page,
  trigger: Locator,
  expectedMessage: string,
  accept: boolean
): Promise<void> {
  const dialogPromise = page.waitForEvent("dialog");
  const clickPromise = trigger.click();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("confirm");
  expect(dialog.message()).toBe(expectedMessage);
  await (accept ? dialog.accept() : dialog.dismiss());
  await clickPromise;
}

function writeCount(
  writes: Array<{ method: string; path: string }>,
  method: string,
  path: string
): number {
  return writes.filter((write) => write.method === method && write.path === path).length;
}

async function installMockApi(page: Page) {
  const state = {
    writes: [] as Array<{ method: string; path: string; body: JsonRecord }>,
    requests: [] as Array<{ method: string; path: string }>,
    failUniversityCreate: false,
    failSourceDeactivateConflict: false,
    expireStoredSession: false,
    logoutShouldFail: false,
    llmReviewDelayMs: 0,
    llmReviewShouldFail: false,
    batchLlmShouldFailHttp: false,
    batchLlmFailureItemId: "",
    batchSnapshotGeneration: 0,
    roleScopedSources: false,
    superSourceDelayMs: 0,
    universities: [
      { id: "qa-university", name: "QA Üniversitesi", city: "Ankara", type: "state", status: "active", websiteUrl: "https://qa.edu.tr", academicCalendarUrl: "https://qa.edu.tr/akademik-takvim.pdf", emailDomains: ["qa.edu.tr"] },
      { id: "xss-university", name: '<img src=x onerror="window.__adminXss=1">', city: "Test", type: "state", status: "active", emailDomains: [] }
    ],
    faculties: [{ id: "qa-faculty", universityId: "qa-university", name: "Mühendislik Fakültesi" }],
    departments: [{ id: "qa-department", universityId: "qa-university", facultyId: "qa-faculty", name: "Bilgisayar Mühendisliği" }],
    suggestions: [
      { id: "suggestion-approve", userEmail: "one@qa.edu.tr", universityId: "qa-university", facultyName: "Fen Fakültesi", departmentName: "Fizik", educationLevel: "bachelor", status: "pending", createdAt: "2026-08-20T08:00:00.000Z" },
      { id: "suggestion-reject", userEmail: "two@qa.edu.tr", universityId: "qa-university", facultyName: "Sanat Fakültesi", educationLevel: "bachelor", status: "pending", createdAt: "2026-08-20T08:00:00.000Z" }
    ],
    announcementSources: [{
      id: "source-review-cas",
      scopeType: "university",
      scopeId: "qa-university",
      sourceName: "QA duyuru kaynağı",
      sourceUrl: "https://qa.edu.tr/duyurular",
      canonicalUrl: "https://qa.edu.tr/duyurular",
      sourceDefinitionVersion: "source-definition-v1",
      contentType: "announcement",
      parser: "html",
      priority: 50,
      status: "inactive",
      trustStatus: "quarantined",
      healthStatus: "pending",
      itemCount: 0,
      fetchIntervalMinutes: 180,
      updatedAt: "2026-09-10T08:00:00.000Z"
    }] as JsonRecord[],
    academicCalendarProfiles: {
      "qa-university": {
        id: "calendar-profile-qa",
        universityId: "qa-university",
        sourceUrl: "https://qa.edu.tr/akademik-takvim.pdf",
        parser: "auto",
        status: "inactive",
        healthStatus: "pending"
      }
    } as Record<string, JsonRecord>,
    scopedAnnouncementSources: [{
      id: "university-admin-source",
      scopeType: "university",
      scopeId: "qa-university",
      sourceName: "Üniversite yöneticisi kaynağı",
      sourceUrl: "https://qa.edu.tr/yerel-duyurular",
      contentType: "announcement",
      parser: "html",
      priority: 50,
      status: "active",
      trustStatus: "trusted",
      healthStatus: "healthy",
      itemCount: 1,
      fetchIntervalMinutes: 180,
      updatedAt: "2026-09-10T09:00:00.000Z"
    }] as JsonRecord[],
    sourceCoverageItems: [{
      id: "qa-department:announcement",
      universityId: "qa-university",
      universityName: "QA Üniversitesi",
      scopeType: "department",
      scopeId: "qa-department",
      scopeName: "Bilgisayar Mühendisliği",
      facultyId: "qa-faculty",
      facultyName: "Mühendislik Fakültesi",
      departmentId: "qa-department",
      departmentName: "Bilgisayar Mühendisliği",
      sourceType: "announcement",
      resolution: "missing",
      evidencePresent: false,
      evidenceArtifactReferencePresent: false,
      missingReason: "no_registered_department_announcement_source"
    }, {
      id: "qa-department:academic_calendar",
      universityId: "qa-university",
      universityName: "QA Üniversitesi",
      scopeType: "department",
      scopeId: "qa-department",
      scopeName: "Bilgisayar Mühendisliği",
      facultyId: "qa-faculty",
      facultyName: "Mühendislik Fakültesi",
      departmentId: "qa-department",
      departmentName: "Bilgisayar Mühendisliği",
      sourceType: "academic_calendar",
      resolution: "verified",
      url: "https://qa.edu.tr/akademik-takvim.pdf",
      evidencePresent: true,
      evidenceArtifactReferencePresent: true,
      finalRevalidatedAt: "2026-09-10T01:00:00.000Z",
      publicationScope: "university_system",
      inheritedFromScopeType: "university",
      inheritedFromScopeId: "qa-university"
    }] as JsonRecord[],
    reviewItems: [{
      id: "review-item-1",
      sourceId: "source-1",
      sourceName: "QA duyuruları",
      sourceUrl: "https://qa.edu.tr/duyurular",
      contentFingerprint: "a".repeat(64),
      snapshotId: "snapshot-1",
      reviewRevision: "revision-1",
      title: "Sunucudaki eski başlık",
      summary: "Eski özet",
      body: [
        { type: "heading", text: "Eski başlık bloğu" },
        { type: "paragraph", text: "Eski açıklama" }
      ],
      contentType: "announcement",
      reviewStatus: "pending_review",
      studentRelevance: "uncertain",
      topic: "unknown",
      audience: "unknown",
      actionType: "unknown",
      deadline: "unknown",
      urgency: "unknown"
    }] as JsonRecord[],
    llmSettings: {
      enabled: false,
      provider: "openai",
      model: "gpt-5-mini",
      apiKeyConfigured: false,
      lastTestStatus: "untested",
      revision: 0
    } as JsonRecord,
    scheduleReviewSources: [{
      id: "schedule-source-1",
      universityId: "qa-university",
      facultyId: "qa-faculty",
      departmentId: "qa-department",
      scheduleType: "course_schedule",
      sourceUrl: "https://qa.edu.tr/bolum/ders-programi",
      verifiedFinalUrl: "https://qa.edu.tr/bolum/ders-programi",
      lifecycle: "review_required",
      revision: 2,
      reviewResult: {
        outcome: "parsed_pending_review",
        format: "html",
        finalUrl: "https://qa.edu.tr/bolum/ders-programi",
        contentSha256: "c".repeat(64),
        candidateCount: 1,
        checkedAt: "2026-09-10T10:00:00.000Z",
        candidates: [{ rowNumber: 7, rawText: "Pazartesi 09:00-10:00 Matematik A101", title: "Matematik", dayOfWeek: 1, startTime: "09:00", endTime: "10:00", location: "A101" }]
      },
      updatedAt: "2026-09-10T10:00:00.000Z"
    }] as JsonRecord[],
    extractedEvents: [] as JsonRecord[],
    failedJobs: [{ id: "job-1", title: "Başarısız bildirim", status: "failed", scheduledAt: "2026-08-20T09:00:00.000Z" }],
    users: [{ id: "user-1", fullName: "QA Öğrenci", email: "student@qa.edu.tr", role: "student", status: "active", emailVerifiedAt: "2026-08-01T09:00:00.000Z" }]
  };

  await page.route(`${apiBaseUrl}/**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;
    state.requests.push({ method, path });
    if (method === "OPTIONS") return fulfillJson(route, {}, 204);
    const body = request.postData() ? request.postDataJSON() as JsonRecord : {};
    if (method !== "GET") state.writes.push({ method, path, body });

    if (method === "POST" && path === "/auth/login") {
      if (body.email === "invalid@qa.local") return fulfillJson(route, { message: "invalid" }, 401);
      const role = body.email === "student@qa.local"
        ? "student"
        : body.email === "editor@qa.local"
          ? "content_editor"
          : body.email === "university@qa.local"
            ? "university_admin"
          : "super_admin";
      return fulfillJson(route, {
        accessToken: `${role}-token`,
        refreshToken: `${role}-refresh`,
        user: { id: `${role}-id`, fullName: "QA Admin", email: body.email, role }
      });
    }
    if (method === "GET" && path === "/me") {
      if (state.expireStoredSession || request.headers().authorization === "Bearer expired-token") {
        return fulfillJson(route, { message: "expired" }, 401, 2_000);
      }
      return fulfillJson(route, { id: "super_admin-id", fullName: "QA Admin", email: "super@qa.local", role: "super_admin" });
    }

    if (method === "GET" && path === "/universities") return fulfillJson(route, state.universities);
    if (method === "POST" && path === "/admin/universities") {
      if (state.failUniversityCreate) return fulfillJson(route, { message: "Üniversite adı zaten var", debug: "database-secret" }, 422);
      const created = { id: `university-${state.universities.length + 1}`, ...body, status: "active" };
      state.universities.push(created as any);
      return fulfillJson(route, created, 201);
    }
    if (method === "DELETE" && path.startsWith("/admin/universities/")) return fulfillJson(route, { status: "archived" });
    if (method === "GET" && path === "/universities/qa-university/faculties") return fulfillJson(route, state.faculties);
    if (method === "POST" && path === "/admin/universities/qa-university/faculties") {
      const created = { id: `faculty-${state.faculties.length + 1}`, universityId: "qa-university", ...body };
      state.faculties.push(created as any);
      return fulfillJson(route, created, 201);
    }
    if (method === "GET" && path === "/faculties/qa-faculty/departments") return fulfillJson(route, state.departments);
    if (method === "POST" && path.includes("/faculties/") && path.endsWith("/departments")) return fulfillJson(route, { id: "department-2", ...body }, 201);
    if (method === "POST" && path.endsWith("/email-domains")) return fulfillJson(route, state.universities[0]);
    if (method === "GET" && path === "/admin/users/unassociated-email-domains") return fulfillJson(route, [{ domain: "new.edu.tr", userCount: 2, sampleEmails: ["a@new.edu.tr", "b@new.edu.tr"] }]);
    if (method === "GET" && path === "/admin/users/academic-unit-suggestions") return fulfillJson(route, state.suggestions);
    if (method === "POST" && path.startsWith("/admin/users/academic-unit-suggestions/") && path.endsWith("/approve")) {
      state.suggestions = state.suggestions.filter((item) => !path.includes(item.id));
      return fulfillJson(route, { status: "approved" });
    }
    if (method === "POST" && path.startsWith("/admin/users/academic-unit-suggestions/") && path.endsWith("/reject")) {
      state.suggestions = state.suggestions.filter((item) => !path.includes(item.id));
      return fulfillJson(route, { status: "rejected" });
    }

    if (method === "GET" && path === "/admin/calendars/schedule-sources") {
      const universityId = url.searchParams.get("universityId");
      const scheduleType = url.searchParams.get("scheduleType");
      const lifecycle = url.searchParams.get("lifecycle");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const filtered = state.scheduleReviewSources.filter((source) =>
        (!universityId || source.universityId === universityId)
        && (!scheduleType || source.scheduleType === scheduleType)
        && (!lifecycle || source.lifecycle === lifecycle));
      return fulfillJson(route, filtered.slice(offset, offset + limit));
    }
    if (method === "POST" && path === "/admin/calendars/schedule-sources/provision-registry") return fulfillJson(route, { created: 1, skipped: 0 });
    if (method === "PATCH" && /^\/admin\/calendars\/schedule-sources\/[^/]+\/candidates\/\d+$/u.test(path)) {
      const current = state.scheduleReviewSources[0] as any;
      const candidate = current.reviewResult.candidates[0];
      for (const field of ["title", "date", "dayOfWeek", "startTime", "endTime", "location"]) {
        if (!(field in body)) continue;
        if (body[field] === null) delete candidate[field];
        else candidate[field] = body[field];
      }
      current.revision += 1;
      current.updatedAt = "2026-09-10T10:01:00.000Z";
      return fulfillJson(route, current);
    }
    if (method === "POST" && path === "/admin/calendars/schedule-sources/schedule-source-1/review") {
      const current = state.scheduleReviewSources[0] as any;
      if (body.decision === "reject") {
        current.lifecycle = "rejected";
        current.revision += 1;
        current.reviewDecision = { decision: "rejected", reviewedBy: "super_admin-id", reviewedAt: "2026-09-10T10:02:00.000Z", approvedRowNumbers: [], rejectedRowNumbers: [7] };
      } else {
        current.lifecycle = "staged";
        current.revision += 2;
        current.reviewDecision = {
          decision: "approved",
          materializationStatus: "staged",
          calendarId: "calendar-existing",
          reviewedBy: "super_admin-id",
          reviewedAt: "2026-09-10T10:02:00.000Z",
          approvedRowNumbers: body.approvedRowNumbers,
          rejectedRowNumbers: []
        };
      }
      return fulfillJson(route, current);
    }
    if (method === "POST" && path === "/admin/calendars/schedule-sources/schedule-source-1/reopen-review") {
      const current = state.scheduleReviewSources[0] as any;
      current.lifecycle = "review_required";
      current.revision += 2;
      delete current.reviewDecision;
      return fulfillJson(route, current);
    }
    if (method === "POST" && path === "/admin/calendars/schedule-sources/schedule-source-1/publish") {
      const current = state.scheduleReviewSources[0] as any;
      current.lifecycle = "published";
      current.revision += 1;
      current.reviewDecision.materializationStatus = "published";
      return fulfillJson(route, current);
    }
    if (method === "POST" && path === "/admin/calendars/schedule-sources/schedule-source-1/ingest") return fulfillJson(route, state.scheduleReviewSources[0]);
    if (method === "GET" && path === "/admin/calendars/course-schedules") return fulfillJson(route, []);
    if (method === "POST" && path === "/admin/calendars/manual") return fulfillJson(route, { calendar: { id: "manual-calendar-1" } }, 201);
    if (method === "GET" && path === "/admin/source-coverage") {
      const search = url.searchParams.get("search")?.trim().toLocaleLowerCase("tr-TR");
      const universityId = url.searchParams.get("universityId");
      const scopeType = url.searchParams.get("scopeType");
      const sourceType = url.searchParams.get("sourceType");
      const resolution = url.searchParams.get("resolution");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const filtered = state.sourceCoverageItems.filter((item) => {
        if (universityId && item.universityId !== universityId) return false;
        if (scopeType && item.scopeType !== scopeType) return false;
        if (sourceType && item.sourceType !== sourceType) return false;
        if (resolution && item.resolution !== resolution) return false;
        if (!search) return true;
        return [item.universityName, item.facultyName, item.departmentName, item.scopeId]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase("tr-TR").includes(search));
      });
      const byResolution = { missing: 0, quarantined: 0, verified: 0, legacy_unverified: 0 };
      for (const item of filtered) byResolution[item.resolution as keyof typeof byResolution] += 1;
      return fulfillJson(route, {
        total: filtered.length,
        items: filtered.slice(offset, offset + limit),
        summary: {
          catalog: { universities: 208, academicUnits: 17_360, faculties: 2_932, departments: 14_428 },
          filteredAcademicUnits: new Set(filtered.map((item) => item.scopeId)).size,
          filteredSourceSlots: filtered.length,
          byResolution,
          bySourceType: {}
        }
      });
    }
    if (method === "POST" && path === "/auth/logout") {
      return state.logoutShouldFail
        ? fulfillJson(route, { message: "logout unavailable" }, 503)
        : fulfillJson(route, { status: "ok" });
    }
    if (method === "GET" && path === "/admin/announcements/source-profiles") {
      const contentTypes = ["announcement", "news", "event", "academic_calendar"] as const;
      const profileUniversities = state.universities.map((university) => ({
        universityId: university.id,
        universityName: university.name,
        city: university.city,
        authority: { status: "verified", homepageUrl: university.websiteUrl, domains: university.emailDomains ?? [], reasonCodes: [] },
        slots: contentTypes.map((contentType) => {
          const source = contentType === "academic_calendar"
            ? undefined
            : state.announcementSources.find((candidate) => candidate.scopeType === "university"
              && candidate.scopeId === university.id
              && (candidate.contentType ?? "announcement") === contentType);
          const calendar = contentType === "academic_calendar" ? state.academicCalendarProfiles[university.id] : undefined;
          const suggestedUrl = source?.sourceUrl
            ?? calendar?.sourceUrl
            ?? (contentType === "announcement" ? university.announcementUrl : undefined)
            ?? (contentType === "academic_calendar" ? university.academicCalendarUrl : undefined)
            ?? university.websiteUrl;
          const descriptions = {
            announcement: "Duyuru liste sayfası; bağlantı, başlık ve tarih otomatik algılanır.",
            news: "Haber liste sayfası; bağlantı, başlık ve tarih otomatik algılanır.",
            event: "Etkinlik liste sayfası; bağlantı, başlık ve etkinlik tarihi otomatik algılanır.",
            academic_calendar: "Akademik takvim HTML sayfası veya PDF/Office belge bağlantısı; tablo ve tarih aralıkları otomatik algılanır."
          };
          return {
            contentType,
            suggestedUrl,
            sourceUrl: suggestedUrl,
            sourceId: source?.id,
            sourceName: source?.sourceName,
            parser: source?.parser ?? calendar?.parser ?? "auto",
            parserConfig: source?.parserConfig ?? calendar?.parserConfig,
            status: source?.status ?? calendar?.status ?? "inactive",
            trustStatus: calendar ? "configured" : source?.trustStatus ?? "quarantined",
            reviewStatus: source ? "pending_review" : undefined,
            resolution: suggestedUrl ? "candidate" : "missing",
            sourceStatus: suggestedUrl ? "source_found" : "source_not_found",
            evidenceStatus: "not_attached",
            lastTest: {
              status: source?.healthStatus ?? calendar?.healthStatus ?? "not_tested",
              checkedAt: source?.lastCheckedAt ?? calendar?.lastCheckedAt,
              itemCount: source?.itemCount ?? calendar?.itemCount,
              error: source?.lastError ?? calendar?.lastError
            },
            siteStructure: {
              kind: contentType === "academic_calendar" ? "calendar_document_or_page" : "listing",
              detectedFormat: contentType === "academic_calendar" ? "document" : "html",
              extractionMode: contentType === "academic_calendar" ? "document_text" : "html_dom_auto",
              description: descriptions[contentType],
              selectorHints: { item: ["article", "li"], title: ["h2", ".title"], link: ["a[href]"], date: ["time", ".date"], content: ["main", ".content"] }
            },
            ...(contentType === "academic_calendar" ? { adminPath: "/admin/calendars" } : {})
          };
        })
      }));
      return fulfillJson(route, {
        summary: {
          universities: profileUniversities.length,
          sourceSlots: profileUniversities.length * 4,
          authoritiesVerified: profileUniversities.length,
          authoritiesQuarantined: 0,
          returnedUniversities: profileUniversities.length,
          returnedSourceSlots: profileUniversities.length * 4,
          byContentType: {}
        },
        universities: profileUniversities
      });
    }
    const sourceProfileMatch = path.match(/^\/admin\/announcements\/source-profiles\/([^/]+)\/(announcement|news|event|academic_calendar)$/u);
    if (method === "PUT" && sourceProfileMatch) {
      const [, universityId, contentType] = sourceProfileMatch;
      if (contentType === "academic_calendar") {
        state.academicCalendarProfiles[universityId!] = {
          ...(state.academicCalendarProfiles[universityId!] ?? { id: `calendar-profile-${universityId}`, universityId }),
          ...body,
          healthStatus: "pending"
        };
        return fulfillJson(route, state.academicCalendarProfiles[universityId!]!);
      }
      const sourceIndex = state.announcementSources.findIndex((source) => source.scopeType === "university"
        && source.scopeId === universityId && (source.contentType ?? "announcement") === contentType);
      const current = sourceIndex >= 0 ? state.announcementSources[sourceIndex]! : {
        id: `profile-${universityId}-${contentType}`,
        scopeType: "university",
        scopeId: universityId,
        contentType,
        priority: 50,
        fetchIntervalMinutes: 180,
        trustStatus: "quarantined",
        healthStatus: "pending",
        updatedAt: "2026-09-11T09:00:00.000Z"
      };
      const updated = { ...current, ...body, updatedAt: "2026-09-11T09:01:00.000Z" };
      if (sourceIndex >= 0) state.announcementSources[sourceIndex] = updated;
      else state.announcementSources.push(updated);
      return fulfillJson(route, { source: updated, ingestion: null });
    }
    const sourceProfilePreviewMatch = path.match(/^\/admin\/announcements\/source-profiles\/([^/]+)\/(announcement|news|event|academic_calendar)\/preview$/u);
    if (method === "POST" && sourceProfilePreviewMatch) {
      const [, universityId, contentType] = sourceProfilePreviewMatch;
      const isCalendar = contentType === "academic_calendar";
      const configuredUrl = isCalendar
        ? state.academicCalendarProfiles[universityId!]?.sourceUrl
        : state.announcementSources.find((source) => source.scopeId === universityId && (source.contentType ?? "announcement") === contentType)?.sourceUrl;
      return fulfillJson(route, {
        sourceId: isCalendar ? `calendar-profile-${universityId}` : `profile-${universityId}-${contentType}`,
        sourceName: isCalendar ? "QA Üniversitesi Akademik Takvim" : "QA duyuru kaynağı",
        sourceUrl: configuredUrl,
        finalUrl: configuredUrl,
        status: "healthy",
        parsedItemCount: isCalendar ? 1 : 3,
        acceptedItemCount: isCalendar ? 1 : 3,
        testedAt: "2026-09-11T09:00:00.000Z",
        activationStatus: "active",
        samples: isCalendar
          ? [{ title: "2026-2027 Akademik Takvim", url: configuredUrl }]
          : [
              { title: "Kayıt Yenileme Duyurusu", url: "https://qa.edu.tr/duyurular/1", publishedDate: "2026-09-11", summary: "Kayıt yenileme ayrıntıları" },
              { title: "Burs Başvurusu", url: "https://qa.edu.tr/duyurular/2", publishedDate: "2026-09-10" },
              { title: "Sınav Takvimi", url: "https://qa.edu.tr/duyurular/3", publishedDate: "2026-09-09" }
            ]
      });
    }
    if (method === "GET" && path === "/admin/announcements/sources") {
      const isUniversityAdmin = request.headers().authorization === "Bearer university_admin-token";
      const sources = state.roleScopedSources && isUniversityAdmin
        ? state.scopedAnnouncementSources
        : state.announcementSources;
      const search = url.searchParams.get("search")?.trim().toLocaleLowerCase("tr-TR");
      const trustStatus = url.searchParams.get("trustStatus");
      const contentType = url.searchParams.get("contentType");
      const scopeType = url.searchParams.get("scopeType");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const filtered = sources.filter((source) => {
        if (trustStatus && source.trustStatus !== trustStatus) return false;
        if (contentType && source.contentType !== contentType) return false;
        if (scopeType && source.scopeType !== scopeType) return false;
        if (!search) return true;
        return [source.sourceName, source.sourceUrl, source.scopeId]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase("tr-TR").includes(search));
      });
      return fulfillJson(
        route,
        filtered.slice(offset, offset + limit),
        200,
        state.roleScopedSources && !isUniversityAdmin ? state.superSourceDelayMs : 0
      );
    }
    if (method === "PUT" && path === "/admin/announcements/sources/source-review-cas") {
      const {
        expectedSourceDefinitionVersion: _definition,
        expectedCanonicalUrl: _canonical,
        expectedTrustStatus: _trust,
        expectedSourceStatus: _status,
        expectedApprovalPending: _approvalPending,
        expectedUpdatedAt: _updatedAt,
        ...updates
      } = body;
      state.announcementSources = [{
        ...state.announcementSources[0],
        ...updates,
        updatedAt: "2026-09-10T08:01:00.000Z"
      }];
      return fulfillJson(route, { source: state.announcementSources[0], ingestion: null });
    }
    if (method === "DELETE" && path === "/admin/announcements/sources/source-review-cas") {
      if (state.failSourceDeactivateConflict) {
        return fulfillJson(route, { message: "Announcement source changed after it was loaded. Refresh the source and retry." }, 409);
      }
      state.announcementSources = [{ ...state.announcementSources[0], status: "inactive", approvalPending: false }];
      return fulfillJson(route, state.announcementSources[0]);
    }
    if (method === "POST" && path === "/admin/announcements/sources/source-review-cas/approve") {
      state.announcementSources = [{
        ...state.announcementSources[0],
        status: "active",
        trustStatus: "trusted",
        approvalPending: false
      }];
      return fulfillJson(route, { source: state.announcementSources[0], ingestion: { status: "healthy", itemCount: 1 } });
    }
    if (method === "POST" && path === "/admin/announcements/sources/source-review-cas/reject") {
      state.announcementSources = [{ ...state.announcementSources[0], status: "inactive", trustStatus: "rejected" }];
      return fulfillJson(route, state.announcementSources[0]);
    }
    if (method === "GET" && path === "/admin/announcements/review-items") {
      return fulfillJson(route, { items: state.reviewItems, total: state.reviewItems.length, limit: 50, offset: 0, hasMore: false });
    }
    if (method === "PATCH" && path === "/admin/announcements/review-items/review-item-1") {
      const { expectedSnapshotId: _snapshot, expectedContentFingerprint: _fingerprint, expectedReviewRevision: _revision, ...updates } = body;
      state.reviewItems = [{ ...state.reviewItems[0], ...updates, reviewRevision: "revision-saved" }];
      return fulfillJson(route, state.reviewItems[0]);
    }
    if (method === "POST" && path === "/admin/announcements/review-items/review-item-1/llm-review") {
      if (state.llmReviewDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.llmReviewDelayMs));
      if (state.llmReviewShouldFail) {
        state.reviewItems = [{
          ...state.reviewItems[0],
          reviewRevision: "revision-llm-failed",
          llmReviewFailure: {
            disposition: "retry_scheduled",
            reasonCode: "provider_unavailable",
            attemptCount: 2,
            lastAttemptedAt: "2026-09-10T10:00:00.000Z",
            retryAfter: "2026-09-10T10:05:00.000Z"
          }
        }];
        return fulfillJson(route, { message: "LLM provider is temporarily unavailable." }, 503);
      }
      state.reviewItems = [{
        ...state.reviewItems[0],
        reviewRevision: "revision-llm",
        llmReviewFailure: null,
        llmClassification: {
          provider: "openai",
          model: "gpt-5-mini",
          confidence: 0.9,
          rationale: "Test suggestion",
          analyzedAt: "2026-09-10T10:00:00.000Z"
        }
      }];
      return fulfillJson(route, state.reviewItems[0]);
    }
    if (method === "POST" && path === "/admin/announcements/review-items/llm-review") {
      if (state.llmReviewDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.llmReviewDelayMs));
      if (state.batchLlmShouldFailHttp) return fulfillJson(route, { message: "batch LLM unavailable" }, 503);
      const candidate = state.reviewItems.find((item) =>
        (item.reviewStatus ?? item.status ?? "pending_review") === "pending_review"
        && !item.llmClassification
        && !item.llmReviewFailure);
      if (!candidate) return fulfillJson(route, { processed: 0, reviewed: 0, failed: 0, hasMore: false, results: [] });

      state.batchSnapshotGeneration += 1;
      const failed = candidate.id === state.batchLlmFailureItemId;
      const snapshotId = `snapshot-batch-${state.batchSnapshotGeneration}`;
      state.reviewItems = state.reviewItems.map((item) => {
        const rotated = item.sourceId === candidate.sourceId ? { ...item, snapshotId } : item;
        if (item.id !== candidate.id) return rotated;
        return failed
          ? {
              ...rotated,
              reviewRevision: `revision-batch-${state.batchSnapshotGeneration}`,
              llmReviewFailure: {
                disposition: "manual_review",
                reasonCode: "provider_refusal",
                attemptCount: 1,
                lastAttemptedAt: "2026-09-10T10:00:00.000Z"
              }
            }
          : {
              ...rotated,
              reviewRevision: `revision-batch-${state.batchSnapshotGeneration}`,
              llmClassification: {
                provider: "openai",
                model: "gpt-5-mini",
                confidence: 0.9,
                rationale: "Batch suggestion",
                analyzedAt: "2026-09-10T10:00:00.000Z"
              }
            };
      });
      return fulfillJson(route, {
        processed: 1,
        reviewed: failed ? 0 : 1,
        failed: failed ? 1 : 0,
        hasMore: state.reviewItems.some((item) =>
          (item.reviewStatus ?? item.status ?? "pending_review") === "pending_review"
          && !item.llmClassification
          && !item.llmReviewFailure),
        results: [{ itemId: candidate.id, status: failed ? "failed" : "reviewed", ...(failed ? { disposition: "manual_review" } : {}) }]
      });
    }
    if (method === "GET" && path === "/admin/announcements/llm-settings") {
      return fulfillJson(route, state.llmSettings);
    }
    if (method === "PUT" && path === "/admin/announcements/llm-settings") {
      if (body.expectedRevision !== state.llmSettings.revision) {
        return fulfillJson(route, { message: "LLM settings changed after they were loaded. Refresh and retry." }, 409);
      }
      const apiKey = typeof body.apiKey === "string" && body.apiKey.length > 0 ? body.apiKey : undefined;
      state.llmSettings = {
        ...state.llmSettings,
        enabled: body.enabled === true,
        provider: "openai",
        model: body.model,
        apiKeyConfigured: state.llmSettings.apiKeyConfigured || Boolean(apiKey),
        ...(apiKey ? { keyLastFour: apiKey.slice(-4) } : {}),
        revision: state.llmSettings.revision + 1
      };
      return fulfillJson(route, state.llmSettings);
    }

    if (method === "POST" && path === "/admin/pdf-sources") return fulfillJson(route, { id: "pdf-1" }, 201);
    if (method === "POST" && path === "/admin/pdf-sources/pdf-1/process") {
      state.extractedEvents = [
        { id: "event-1", pdfSourceId: "pdf-1", normalizedTitle: "Kayıt", normalizedCategory: "course_registration", startDate: "2026-09-01T00:00:00.000Z", status: "pending_review", confidence: 0.95 },
        { id: "event-2", pdfSourceId: "pdf-1", normalizedTitle: "Sınav", normalizedCategory: "final_exam", startDate: "2026-12-20T00:00:00.000Z", status: "pending_review", confidence: 0.8 }
      ];
      return fulfillJson(route, { pdfSource: { id: "pdf-1", parseStatus: "processed" }, extractedEvents: state.extractedEvents });
    }
    if (method === "GET" && path === "/admin/extracted-events") return fulfillJson(route, state.extractedEvents);
    if (method === "POST" && path.startsWith("/admin/extracted-events/") && path.endsWith("/approve")) {
      state.extractedEvents = state.extractedEvents.filter((item) => !path.includes(item.id));
      return fulfillJson(route, { status: "approved" });
    }
    if (method === "POST" && path.startsWith("/admin/extracted-events/") && path.endsWith("/reject")) {
      state.extractedEvents = state.extractedEvents.filter((item) => !path.includes(item.id));
      return fulfillJson(route, { status: "rejected" });
    }

    if (method === "POST" && path === "/admin/calendars") return fulfillJson(route, { calendar: { id: "calendar-1" } }, 201);
    if (method === "POST" && path === "/admin/calendars/calendar-1/publish") return fulfillJson(route, { status: "published" });
    if (method === "POST" && path === "/admin/calendars/calendar-1/rollback") return fulfillJson(route, { status: "draft" });

    if (method === "POST" && path === "/admin/notification-jobs/process-due") return fulfillJson(route, { processedJobs: 3, sent: 2, failed: 1, deferred: 0, skipped: 0 });
    if (method === "GET" && path === "/admin/notification-jobs/failed") return fulfillJson(route, state.failedJobs);
    if (method === "POST" && path === "/admin/notification-jobs/retry") return fulfillJson(route, { status: "scheduled" });
    if (method === "GET" && path === "/admin/notification-jobs/deliveries") return fulfillJson(route, [{ id: "delivery-1", jobId: "job-1", userId: "user-1", deviceTokenId: "device-1", status: "sent", providerMessageId: "provider-message-1", createdAt: "2026-08-20T09:01:00.000Z", updatedAt: "2026-08-20T09:01:00.000Z" }]);

    if (method === "GET" && path === "/admin/audit-logs") return fulfillJson(route, [{ id: "audit-1", actorId: "super_admin-id", action: "calendar.published", entityType: "academic_calendar", entityId: "calendar-1", createdAt: "2026-08-20T09:00:00.000Z" }]);
    if (method === "GET" && path === "/admin/audit-logs/export") return fulfillJson(route, { data: "{\"action\":\"calendar.published\"}\n", fileName: "calendar-1.jsonl" });

    if (method === "GET" && path === "/admin/users") return fulfillJson(route, state.users);
    if (method === "PATCH" && path === "/admin/users/user-1") {
      state.users = state.users.map((user) => user.id === "user-1" ? { ...user, ...body } : user);
      return fulfillJson(route, state.users[0]);
    }
    if (method === "DELETE" && path === "/admin/users/user-1") {
      state.users = [];
      return fulfillJson(route, { deleted: true });
    }

    return fulfillJson(route, { message: `Unhandled mock route ${method} ${path}` }, 404);
  });

  return state;
}

async function fulfillJson(route: Route, body: unknown, status = 200, delay = 0): Promise<void> {
  if (delay) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    },
    body: status === 204 ? "" : JSON.stringify(body)
  });
}

async function unnamedInteractiveControls(page: Page): Promise<string[]> {
  return page.locator('button, input:not([type="hidden"]), select, textarea, a[href]').evaluateAll((elements) => elements.flatMap((element, index) => {
    const labelledBy = element.getAttribute("aria-labelledby")
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .join(" ")
      .trim();
    const labels = "labels" in element
      ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.textContent?.trim() ?? "").join(" ").trim()
      : "";
    const text = element.textContent?.trim() ?? "";
    const name = element.getAttribute("aria-label")?.trim()
      || labelledBy
      || labels
      || element.getAttribute("title")?.trim()
      || (element.tagName === "BUTTON" || element.tagName === "A" ? text : "");
    return name ? [] : [`${index}:${element.tagName.toLowerCase()}[${element.getAttribute("name") ?? ""}]`];
  }));
}

async function documentLayout(page: Page): Promise<{ clientWidth: number; scrollWidth: number; widest: string[] }> {
  return page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const candidates = Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          description: `${element.tagName.toLowerCase()}.${Array.from(element.classList).join(".")} right=${Math.round(rect.right)} width=${Math.round(rect.width)}`,
          right: rect.right
        };
      })
      .filter((candidate) => candidate.right > clientWidth + 1 && candidate.right <= scrollWidth + 1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 8)
      .map((candidate) => candidate.description);
    return { clientWidth, scrollWidth, widest: candidates };
  });
}

async function trappedHorizontalTables(page: Page): Promise<string[]> {
  return page.locator(".table").evaluateAll((tables) => tables.flatMap((table, index) => {
    if (table.scrollWidth <= table.clientWidth + 1) return [];
    const initial = table.scrollLeft;
    table.scrollLeft = table.scrollWidth;
    const canScroll = table.scrollLeft > initial;
    table.scrollLeft = initial;
    return canScroll ? [] : [`${index}:${table.scrollWidth}/${table.clientWidth}`];
  }));
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for ${url}\n${adminOutput}`);
}
