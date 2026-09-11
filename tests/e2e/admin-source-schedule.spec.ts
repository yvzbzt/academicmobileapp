import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

type JsonRecord = Record<string, any>;

const cwd = process.cwd();
const evidenceDir = resolve(cwd, "artifacts", "native-qa-20260813-galaxy-s24");
const university = { id: "qa-university", name: "QA Üniversitesi", city: "Ankara", type: "state", status: "active" };
const faculty = { id: "qa-faculty", universityId: university.id, name: "Mühendislik Fakültesi" };
const department = { id: "qa-department", universityId: university.id, facultyId: faculty.id, name: "Bilgisayar Mühendisliği" };

let apiServer: ReturnType<typeof createServer>;
let apiBaseUrl = "";
let adminProcess: ChildProcessWithoutNullStreams | undefined;
let adminUrl = "";
let adminOutput = "";
let announcementSources: JsonRecord[] = [];
let courseSchedules: JsonRecord[] = [];
const writes: Array<{ method: string; path: string; body: JsonRecord }> = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(evidenceDir, { recursive: true });
  apiServer = createServer((request, response) => void handleMockApi(request, response));
  apiServer.listen(0, "127.0.0.1");
  await once(apiServer, "listening");
  const address = apiServer.address();
  if (!address || typeof address === "string") throw new Error("Mock API did not bind to a TCP port.");
  apiBaseUrl = `http://127.0.0.1:${address.port}`;

  const adminPort = 3313;
  adminUrl = `http://127.0.0.1:${adminPort}/admin/`;
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

test.afterAll(async () => {
  adminProcess?.kill();
  await new Promise<void>((resolveClose) => apiServer.close(() => resolveClose()));
});

test("admin manages scoped announcement sources and dynamic ingestion cadence", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Duyuru Kaynakları", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Duyuru Kaynakları" })).toBeVisible();

  const createForm = page.locator("form.sourceManagerForm");
  await createForm.getByLabel("Kaynak kapsamı").selectOption("department");
  await createForm.getByLabel("Üniversite").selectOption(university.id);
  await createForm.getByLabel("Fakülte").selectOption(faculty.id);
  await createForm.getByLabel("Bölüm").selectOption(department.id);
  await createForm.getByLabel("Kaynak adı").fill("Bölüm Duyuruları");
  await createForm.getByLabel("Kaynak adresi").fill("https://qa.edu.tr/muhendislik/bilgisayar/duyurular");
  await createForm.getByLabel("İçerik türü").selectOption("event");
  await createForm.getByLabel("Ayrıştırıcı").selectOption("auto");
  await createForm.getByLabel("Öncelik").fill("70");
  await createForm.getByLabel("Yenileme (dakika)").fill("90");
  await createForm.getByRole("button", { name: /Kaynağı Ekle/ }).click();

  await expect(page.getByText("Duyuru kaynağı inceleme kuyruğuna eklendi")).toBeVisible();
  let editor = page.locator("form.sourceEditor").filter({ hasText: "Bölüm Duyuruları" });
  await expect(editor).toBeVisible();
  await expect(editor.getByText(/Bekliyor · 0 kayıt/)).toBeVisible();
  await expect(editor.getByText("Karantinada", { exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: /Şimdi Tara/ })).toBeDisabled();

  await editor.getByLabel("Bölüm Duyuruları inceleme notu").fill("Resmî bölüm sayfası doğrulandı");
  await editor.getByRole("button", { name: /Güvenilir Olarak Onayla/ }).click();
  await expect(page.getByText("Kaynak güvenilir olarak onaylandı")).toBeVisible();
  editor = page.locator("form.sourceEditor").filter({ hasText: "Bölüm Duyuruları" });
  await expect(editor.getByText(/Sağlıklı · 3 kayıt/)).toBeVisible();
  await expect(editor.getByText("Güvenilir", { exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: /Şimdi Tara/ })).toBeEnabled();

  await editor.getByLabel("Yenileme dakikası").fill("45");
  await editor.getByRole("button", { name: /Kaydet/ }).click();
  await expect(page.getByText("Kaynak ayarları güncellendi")).toBeVisible();
  editor = page.locator("form.sourceEditor").filter({ hasText: "Bölüm Duyuruları" });
  await expect(editor.getByLabel("Yenileme dakikası")).toHaveValue("45");

  await editor.getByRole("button", { name: /Şimdi Tara/ }).click();
  await expect(page.getByText("Kaynak şimdi yenilendi")).toBeVisible();
  await expect(page.locator("form.sourceEditor").getByText(/Sağlıklı · 4 kayıt/)).toBeVisible();
  await page.screenshot({ path: resolve(evidenceDir, "admin-announcement-sources.png"), fullPage: true });

  editor = page.locator("form.sourceEditor").filter({ hasText: "Bölüm Duyuruları" });
  const deactivateSource = editor.getByRole("button", { name: /Pasife Al/ });
  const deactivateWrites = writeCount("DELETE", "/admin/announcements/sources/source-1");
  await answerConfirmation(page, deactivateSource, "Bu duyuru kaynağını pasife almak istiyor musunuz? Otomatik veri alımı duracaktır.", false);
  expect(writeCount("DELETE", "/admin/announcements/sources/source-1")).toBe(deactivateWrites);
  await expect(deactivateSource).toBeEnabled();
  await answerConfirmation(page, deactivateSource, "Bu duyuru kaynağını pasife almak istiyor musunuz? Otomatik veri alımı duracaktır.", true);
  await expect(page.getByText("Kaynak pasife alındı")).toBeVisible();

  expect(writes).toContainEqual(expect.objectContaining({
    method: "POST",
    path: "/admin/announcements/sources",
    body: expect.objectContaining({
      scopeType: "department",
      universityId: university.id,
      facultyId: faculty.id,
      departmentId: department.id,
      fetchIntervalMinutes: 90
    })
  }));
  expect(writes).toContainEqual(expect.objectContaining({
    method: "POST",
    path: "/admin/announcements/sources/source-1/approve",
    body: expect.objectContaining({
      expectedTrustStatus: "quarantined",
      expectedSourceStatus: "inactive",
      expectedApprovalPending: false,
      note: "Resmî bölüm sayfası doğrulandı"
    })
  }));
  expect(writes).toContainEqual(expect.objectContaining({
    method: "PUT",
    path: "/admin/announcements/sources/source-1",
    body: expect.objectContaining({ fetchIntervalMinutes: 45 })
  }));
});

test("admin publishes and removes a structured weekly course schedule", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Girişler", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Girişler" })).toBeVisible();

  const scheduleForm = page.locator("form.scheduleForm");
  await scheduleForm.getByLabel("Üniversite").selectOption(university.id);
  await scheduleForm.getByLabel("Fakülte").selectOption(faculty.id);
  await scheduleForm.getByLabel("Bölüm").selectOption(department.id);
  await scheduleForm.getByLabel("Akademik yıl").fill("2026-2027");
  await scheduleForm.getByLabel("Dönem").selectOption("fall");
  await scheduleForm.getByLabel("Ders başlığı").fill("Algoritmalar");
  await scheduleForm.getByLabel("Ders kodu veya tam adı").fill("BIL 201");
  await scheduleForm.getByLabel("Derslik veya yer").fill("D-101");
  await scheduleForm.locator('input[name="startDate"]').fill("2026-09-14");
  await scheduleForm.locator('input[name="startTime"]').fill("09:30");
  await scheduleForm.locator('input[name="endTime"]').fill("10:45");
  await scheduleForm.locator('input[name="repeatUntil"]').fill("2026-10-05");
  await scheduleForm.getByRole("button", { name: /Dersi Yayınla/ }).click();

  await expect(page.getByText("4 ders oturumu yayınlandı")).toBeVisible();
  const scheduleRow = page.locator(".row.courseSchedule").filter({ hasText: "Algoritmalar" });
  await expect(scheduleRow).toContainText("BIL 201");
  await expect(scheduleRow).toContainText("D-101");
  await expect(scheduleRow).toContainText("4 oturum");
  const schedulePanel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Ders Programı", exact: true }) });
  await schedulePanel.screenshot({ path: resolve(evidenceDir, "admin-course-schedule.png") });

  const removeSchedule = scheduleRow.getByRole("button", { name: /Kaldır/ });
  const removeWrites = writeCount("DELETE", "/admin/calendars/course-schedules/series-1");
  await answerConfirmation(page, removeSchedule, "Bu ders programı serisini kaldırmak istiyor musunuz? Serideki tüm ders oturumları arşivlenecektir.", false);
  expect(writeCount("DELETE", "/admin/calendars/course-schedules/series-1")).toBe(removeWrites);
  await expect(scheduleRow).toBeVisible();
  await answerConfirmation(page, removeSchedule, "Bu ders programı serisini kaldırmak istiyor musunuz? Serideki tüm ders oturumları arşivlenecektir.", true);
  await expect(page.getByText("Ders programı satırı kaldırıldı")).toBeVisible();
  await expect(page.locator(".row.courseSchedule")).toHaveCount(0);

  expect(writes).toContainEqual(expect.objectContaining({
    method: "POST",
    path: "/admin/calendars/course-schedules",
    body: expect.objectContaining({
      universityId: university.id,
      facultyId: faculty.id,
      departmentId: department.id,
      title: "Algoritmalar",
      location: "D-101",
      repeatWeekly: true
    })
  }));
});

async function login(page: Page): Promise<void> {
  await page.goto(adminUrl);
  await page.getByLabel("E-posta").fill("admin@qa.local");
  await page.getByLabel("Şifre").fill("QaAdmin-2026!");
  await page.getByRole("button", { name: /Admin Paneline Gir/ }).click();
  await expect(page.getByText("admin@qa.local")).toBeVisible();
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

function writeCount(method: string, path: string): number {
  return writes.filter((write) => write.method === method && write.path === path).length;
}

async function handleMockApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "OPTIONS") return sendJson(response, {}, 204);

  const url = new URL(request.url ?? "/", apiBaseUrl);
  const body = await readJson(request);
  if (request.method !== "GET") writes.push({ method: request.method ?? "", path: url.pathname, body });

  if (request.method === "POST" && url.pathname === "/auth/login") {
    return sendJson(response, {
      accessToken: "qa-admin-token",
      refreshToken: "qa-refresh-token",
      user: { id: "qa-admin", fullName: "QA Admin", email: "admin@qa.local", role: "super_admin" }
    });
  }
  if (request.method === "GET" && url.pathname === "/me") {
    return sendJson(response, { id: "qa-admin", fullName: "QA Admin", email: "admin@qa.local", role: "super_admin" });
  }
  if (request.method === "GET" && url.pathname === "/universities") return sendJson(response, [university]);
  if (request.method === "GET" && url.pathname === `/universities/${university.id}/faculties`) return sendJson(response, [faculty]);
  if (request.method === "GET" && url.pathname === `/faculties/${faculty.id}/departments`) return sendJson(response, [department]);
  if (request.method === "GET" && url.pathname === "/admin/users/unassociated-email-domains") return sendJson(response, []);
  if (request.method === "GET" && url.pathname === "/admin/users/academic-unit-suggestions") return sendJson(response, []);
  if (request.method === "GET" && url.pathname === "/admin/source-coverage") {
    return sendJson(response, {
      total: 0,
      items: [],
      summary: {
        catalog: { universities: 208, academicUnits: 17_360, faculties: 2_932, departments: 14_428 },
        filteredAcademicUnits: 0,
        filteredSourceSlots: 0,
        byResolution: { missing: 0, quarantined: 0, verified: 0, legacy_unverified: 0 },
        bySourceType: {}
      }
    });
  }
  if (request.method === "GET" && url.pathname === "/admin/calendars/schedule-sources") return sendJson(response, []);
  if (request.method === "GET" && url.pathname === "/admin/announcements/review-items") {
    return sendJson(response, { items: [], total: 0, limit: 50, offset: 0, hasMore: false });
  }
  if (request.method === "GET" && url.pathname === "/admin/announcements/llm-settings") {
    return sendJson(response, {
      enabled: false,
      provider: "openai",
      model: "gpt-5-mini",
      apiKeyConfigured: false,
      lastTestStatus: "untested",
      revision: 0
    });
  }

  if (request.method === "GET" && url.pathname === "/admin/announcements/sources") return sendJson(response, announcementSources);
  if (request.method === "POST" && url.pathname === "/admin/announcements/sources") {
    const source = {
      id: "source-1",
      scopeType: body.scopeType,
      scopeId: body.departmentId,
      sourceName: body.sourceName,
      sourceUrl: body.sourceUrl,
      contentType: body.contentType,
      parser: body.parser,
      priority: body.priority,
      fetchIntervalMinutes: body.fetchIntervalMinutes,
      canonicalUrl: body.sourceUrl,
      sourceDefinitionVersion: "source-definition-1",
      status: "inactive",
      trustStatus: "quarantined",
      approvalPending: false,
      healthStatus: "pending",
      itemCount: 0,
      updatedAt: "2026-08-13T09:59:00.000Z"
    };
    announcementSources = [source];
    return sendJson(response, source, 201);
  }
  if (request.method === "POST" && url.pathname === "/admin/announcements/sources/source-1/approve") {
    announcementSources = announcementSources.map((source) => ({
      ...source,
      status: "active",
      trustStatus: "trusted",
      approvalPending: false,
      healthStatus: "healthy",
      itemCount: 3,
      lastCheckedAt: "2026-08-13T10:00:00.000Z",
      updatedAt: "2026-08-13T10:00:00.000Z"
    }));
    return sendJson(response, {
      source: announcementSources[0],
      ingestion: { status: "healthy", itemCount: 3 }
    });
  }
  if (request.method === "PUT" && url.pathname === "/admin/announcements/sources/source-1") {
    announcementSources = announcementSources.map((source) => ({ ...source, ...body }));
    return sendJson(response, announcementSources[0]);
  }
  if (request.method === "POST" && url.pathname === "/admin/announcements/sources/source-1/ingest") {
    announcementSources = announcementSources.map((source) => ({
      ...source,
      itemCount: 4,
      healthStatus: "healthy",
      lastCheckedAt: "2026-08-13T10:05:00.000Z"
    }));
    return sendJson(response, { ingested: 1 });
  }
  if (request.method === "DELETE" && url.pathname === "/admin/announcements/sources/source-1") {
    announcementSources = announcementSources.map((source) => ({ ...source, status: "inactive" }));
    return sendJson(response, announcementSources[0]);
  }

  if (request.method === "GET" && url.pathname === "/admin/calendars/course-schedules") return sendJson(response, courseSchedules);
  if (request.method === "POST" && url.pathname === "/admin/calendars/course-schedules") {
    courseSchedules = Array.from({ length: 4 }, (_, index) => ({
      id: `course-${index + 1}`,
      scheduleSeriesId: "series-1",
      title: body.title,
      courseName: body.courseName,
      location: body.location,
      academicYear: body.academicYear,
      term: body.term,
      startDate: new Date(Date.UTC(2026, 8, 14 + index * 7, 6, 30)).toISOString(),
      endDate: new Date(Date.UTC(2026, 8, 14 + index * 7, 7, 45)).toISOString(),
      facultyId: body.facultyId,
      departmentId: body.departmentId
    }));
    return sendJson(response, { seriesId: "series-1", events: courseSchedules }, 201);
  }
  if (request.method === "DELETE" && url.pathname === "/admin/calendars/course-schedules/series-1") {
    courseSchedules = [];
    return sendJson(response, { deleted: 4 });
  }

  return sendJson(response, { message: `Unhandled mock route ${request.method} ${url.pathname}` }, 404);
}

function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status);
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) as JsonRecord : {};
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
