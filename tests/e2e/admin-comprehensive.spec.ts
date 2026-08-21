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
  await pdfForm.getByLabel("Ham çıkarılmış metin").fill("1 Eylül 2026 kayıt başlangıcı");
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
    expireStoredSession: false,
    universities: [
      { id: "qa-university", name: "QA Üniversitesi", city: "Ankara", type: "state", status: "active", emailDomains: ["qa.edu.tr"] },
      { id: "xss-university", name: '<img src=x onerror="window.__adminXss=1">', city: "Test", type: "state", status: "active", emailDomains: [] }
    ],
    faculties: [{ id: "qa-faculty", universityId: "qa-university", name: "Mühendislik Fakültesi" }],
    departments: [{ id: "qa-department", universityId: "qa-university", facultyId: "qa-faculty", name: "Bilgisayar Mühendisliği" }],
    suggestions: [
      { id: "suggestion-approve", userEmail: "one@qa.edu.tr", universityId: "qa-university", facultyName: "Fen Fakültesi", departmentName: "Fizik", educationLevel: "bachelor", status: "pending", createdAt: "2026-08-20T08:00:00.000Z" },
      { id: "suggestion-reject", userEmail: "two@qa.edu.tr", universityId: "qa-university", facultyName: "Sanat Fakültesi", educationLevel: "bachelor", status: "pending", createdAt: "2026-08-20T08:00:00.000Z" }
    ],
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

    if (method === "GET" && path === "/admin/calendars/course-schedules") return fulfillJson(route, []);
    if (method === "POST" && path === "/admin/calendars/manual") return fulfillJson(route, { calendar: { id: "manual-calendar-1" } }, 201);
    if (method === "GET" && path === "/admin/announcements/sources") return fulfillJson(route, []);

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
