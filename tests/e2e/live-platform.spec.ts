import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "https://academic-calendar-api-qrld4semgq-ew.a.run.app";
const mobileUrl = process.env.E2E_MOBILE_URL ?? "https://academic-mobile-app-7629.web.app";
const adminUrl = process.env.E2E_ADMIN_URL ?? "https://academic-mobile-app-7629-admin.web.app";
const runId = process.env.E2E_RUN_ID ?? Date.now().toString();
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const studentPassword = "PlaywrightStudent-2026!";

type JsonRecord = Record<string, any>;

let api: APIRequestContext;
let adminToken = "";
let seedUniversity: JsonRecord;
let summerUniversity: JsonRecord;
let seedFaculty: JsonRecord | undefined;
let seedDepartment: JsonRecord | undefined;
const apiStudentEmails = Array.from({ length: 9 }, (_, index) => `playwright-api-${index + 1}.${runId}@example.edu.tr`);
const uiStudentEmail = `playwright-ui.${runId}@example.edu.tr`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!adminEmail || !adminPassword) {
    throw new Error("E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required. Use npm run e2e:live to bootstrap them.");
  }

  api = await playwrightRequest.newContext({
    baseURL: apiBaseUrl,
    extraHTTPHeaders: { "Content-Type": "application/json" }
  });

  await expectApiOk("GET", "/health/live");
  await expectApiOk("GET", "/health/ready");

  const adminSession = await apiJson<JsonRecord>("POST", "/auth/login", {
    email: adminEmail,
    password: adminPassword,
    deviceId: `pw-admin-${runId}`
  });
  adminToken = adminSession.accessToken;
  expect(adminSession.user.role).toBe("super_admin");

  const universities = await apiJson<JsonRecord[]>("GET", "/universities?limit=50&offset=0");
  seedUniversity = universities[0] ?? await createUniversity(`PW Seed University ${runId}`, `pw-seed-${runId}.edu.tr`);
  summerUniversity = universities[1] ?? await createUniversity(`PW Summer University ${runId}`, `pw-summer-${runId}.edu.tr`);

  const faculties = await apiJson<JsonRecord[]>("GET", `/universities/${seedUniversity.id}/faculties`);
  seedFaculty = faculties[0] ?? await apiJson<JsonRecord>("POST", `/admin/universities/${seedUniversity.id}/faculties`, {
    name: `PW Seed Faculty ${runId}`
  }, adminToken);
  if (seedFaculty) {
    const departments = await apiJson<JsonRecord[]>("GET", `/faculties/${seedFaculty.id}/departments`);
    seedDepartment = departments[0] ?? await apiJson<JsonRecord>("POST", `/admin/universities/${seedUniversity.id}/faculties/${seedFaculty.id}/departments`, {
      name: `PW Seed Department ${runId}`,
      educationLevel: "bachelor"
    }, adminToken);
  }

  for (const email of apiStudentEmails) {
    const registration = await apiJson<JsonRecord>("POST", "/auth/register", {
      email,
      password: studentPassword,
      passwordConfirmation: studentPassword
    });
    expect(registration.previewVerificationToken, `preview token for ${email}`).toMatch(/^\d{4}$/);
    await apiJson("POST", "/auth/verify-email", {
      email,
      code: registration.previewVerificationToken,
      deviceId: `pw-api-${runId}`
    });
  }

  await publishSeedCalendar();
});

test.afterAll(async () => {
  await api?.dispose();
});

test("mobile UI registers, verifies, logs in and uses student screens", async ({ page }) => {
  await page.goto(mobileUrl);
  await expect(page.getByRole("heading", { name: "Akademik Takvim" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kimlik Doğrulama" })).toBeVisible();

  await page.getByRole("button", { name: /Kayıt/i }).click();
  await page.getByLabel("E-posta").fill(uiStudentEmail);
  await page.getByLabel("Şifre", { exact: true }).fill(studentPassword);
  await page.getByLabel("Şifreyi doğrula").fill(studentPassword);
  await page.getByRole("button", { name: /Devam Et/i }).click();

  await expect(page.getByRole("button", { name: /E-postayı Doğrula/i })).toBeVisible();
  await expect(page.getByLabel("4 haneli doğrulama kodu")).toHaveValue(/^\d{4}$/);
  await page.getByRole("button", { name: /E-postayı Doğrula/i }).click();
  await expect(page.getByText(/E-posta doğrulandı/i)).toBeVisible();

  const studentSession = await apiJson<JsonRecord>("POST", "/auth/login", {
    email: uiStudentEmail,
    password: studentPassword,
    deviceId: `pw-ui-api-${runId}`
  });
  await apiJson("PATCH", "/me/university", {
    universityId: seedUniversity.id,
    ...(seedFaculty ? { facultyId: seedFaculty.id } : {}),
    ...(seedDepartment ? { departmentId: seedDepartment.id } : {}),
    classLevel: 2
  }, studentSession.accessToken);

  await page.getByLabel("E-posta").fill(uiStudentEmail);
  await page.getByLabel("Şifre", { exact: true }).fill(studentPassword);
  await page.getByRole("button", { name: /Devam Et/i }).click();
  await expect(page.getByRole("heading", { name: "Öğrenci Ana Sayfası" })).toBeVisible();

  await page.getByRole("button", { name: "Takvim", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Akademik Takvimim" })).toBeVisible();
  await expect(page.getByText(`Playwright Course Registration ${runId}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bölüm Ders Programı" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bölüm Sınav Programı" })).toBeVisible();
  await expect(page.getByText(`Playwright Department Course Schedule ${runId}`)).toBeVisible();
  await expect(page.getByText(`Playwright Department Exam Schedule ${runId}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ders Programı", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sınav Programı", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Yaz Okulu", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Yaz Okulu" })).toBeVisible();
  await expect(page.getByText(`Playwright Summer School ${runId}`)).toBeVisible();

  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Detaylı Ayarlar" })).toBeVisible();
  await page.getByLabel("Ad soyad").fill(`Playwright UI Student ${runId}`);
  await page.getByRole("button", { name: /Profili Kaydet/i }).click();
  await expect(page.getByText(/Profil kaydedildi/i)).toBeVisible();
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(page.locator('select[name="reminderMode"]')).toBeVisible();
  await expect(page.getByText("Akademik takvim yalnızca üniversitenize göre gösterilir; fakülte veya bölüm takvimi ayrıca gösterilmez.")).toBeVisible();
  await expect(page.getByText(/Takip Ekle|Üniversiteyi takip et|Fakülteyi takip et|Bölümü takip et/i)).toHaveCount(0);

  await page.getByRole("button", { name: /Cihazı Kaydet/i }).click();
  await expect(page.getByText(/Cihaz kaydedildi/i)).toBeVisible();
});

test("admin UI accepts handoff and exposes operational panels", async ({ page }) => {
  await page.goto(`${adminUrl}/#/handoff?accessToken=${encodeURIComponent(adminToken)}`);
  await expect(page.getByText(adminEmail!)).toBeVisible();
  await expect(adminNav(page).getByRole("link", { name: "Panel", exact: true })).toBeVisible();

  await adminNav(page).getByRole("link", { name: "Kullanıcılar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kullanıcı Yönetimi" })).toBeVisible();
  await expect(page.getByText(apiStudentEmails[0])).toBeVisible();

  await adminNav(page).getByRole("link", { name: "Girişler", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Üniversiteler, Bölümler ve Alan Adları" })).toBeVisible();
  await createUniversityFromAdminInputs(page);

  await adminNav(page).getByRole("link", { name: "Katalog", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Üniversiteler" })).toBeVisible();

  await adminNav(page).getByRole("link", { name: "PDF İşlemleri", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kaynak Alımı" })).toBeVisible();

  await adminNav(page).getByRole("link", { name: "Yayınla", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Takvim Yayınlama" })).toBeVisible();

  await adminNav(page).getByRole("link", { name: "Bildirimler", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bildirim Operasyonları" })).toBeVisible();

  await adminNav(page).getByRole("link", { name: "Denetim", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Denetim Zaman Çizelgesi" })).toBeVisible();
});

test("hosted frontends keep the deployed API wired and no console errors surface on load", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(mobileUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Akademik Takvim" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(adminUrl);
  await expect(page.getByText("Akademik Takvim OS")).toBeVisible();

  expect(consoleErrors.filter((message) => !message.includes("favicon")).join("\n")).toBe("");
});

async function createUniversityFromAdminInputs(page: Page) {
  const universityName = `PW UI University ${runId}`;
  await page.getByLabel("Üniversite adı").fill(universityName);
  await page.getByLabel("Üniversite şehri").fill("Istanbul");
  await page.getByLabel("Üniversite türü").selectOption("private");
  await page.getByLabel("E-posta alan adları").fill(`pw-ui-${runId}.edu.tr`);
  await page.getByRole("button", { name: /Üniversite Ekle/i }).click();
  await expect(page.getByText("Üniversite oluşturuldu")).toBeVisible();
  await expect(page.getByText(universityName)).toBeVisible();
}

function adminNav(page: Page) {
  return page.getByRole("navigation", { name: "Yönetici bölümleri" });
}

async function createUniversity(name: string, domain: string) {
  return apiJson<JsonRecord>("POST", "/admin/universities", {
    name,
    city: "Istanbul",
    type: "private",
    emailDomains: [domain]
  }, adminToken);
}

async function publishSeedCalendar() {
  const now = new Date();
  const registrationDate = toDateInput(addDays(now, 30));
  const finalDate = toDateInput(addDays(now, 60));
  const summerDate = toDateInput(addDays(now, 75));
  const body = {
    universityId: seedUniversity.id,
    academicYear: "2026-2027",
    title: `Playwright Calendar ${runId}`,
    events: [
      {
        title: `Playwright Course Registration ${runId}`,
        category: "course_registration",
        term: "fall",
        startDate: registrationDate,
        notificationRules: [{ offsetDays: 7, enabled: true }, { offsetDays: 1, enabled: true }]
      },
      {
        title: `Playwright Department Course Schedule ${runId}`,
        category: "course_schedule",
        term: "fall",
        startDate: registrationDate,
        ...(seedFaculty ? { facultyId: seedFaculty.id } : {}),
        ...(seedDepartment ? { departmentId: seedDepartment.id } : {}),
        notificationRules: [{ offsetDays: 1, enabled: true }]
      },
      {
        title: `Playwright Department Exam Schedule ${runId}`,
        category: "department_exam_schedule",
        term: "fall",
        startDate: finalDate,
        ...(seedFaculty ? { facultyId: seedFaculty.id } : {}),
        ...(seedDepartment ? { departmentId: seedDepartment.id } : {}),
        notificationRules: [{ offsetDays: 1, enabled: true }]
      },
      {
        title: `Playwright Final Exams ${runId}`,
        category: "final_exam",
        term: "fall",
        startDate: finalDate,
        notificationRules: [{ offsetDays: 7, enabled: true }]
      }
    ]
  };
  const draft = await apiJson<JsonRecord>("POST", "/admin/calendars/manual", body, adminToken);
  await apiJson("POST", `/admin/calendars/${draft.calendar.id}/publish`, undefined, adminToken);

  const summerBody = {
    universityId: summerUniversity.id,
    academicYear: "2026-2027",
    title: `Playwright Summer Calendar ${runId}`,
    events: [
      {
        title: `Playwright Summer School ${runId}`,
        category: "summer_school_start",
        term: "summer",
        startDate: summerDate,
        notificationRules: [{ offsetDays: 7, enabled: true }]
      }
    ]
  };
  const summerDraft = await apiJson<JsonRecord>("POST", "/admin/calendars/manual", summerBody, adminToken);
  await apiJson("POST", `/admin/calendars/${summerDraft.calendar.id}/publish`, undefined, adminToken);
}

async function expectApiOk(method: "GET" | "POST" | "PATCH" | "DELETE", path: string) {
  const response = await api.fetch(path, { method });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
}

async function apiJson<T = JsonRecord>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, token?: string): Promise<T> {
  const response = await api.fetch(path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    data: body
  });
  const text = await response.text();
  expect(response.ok(), `${method} ${path}: ${text}`).toBeTruthy();
  return text ? JSON.parse(text) as T : ({} as T);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}
