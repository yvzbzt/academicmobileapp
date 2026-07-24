import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

type JsonRecord = Record<string, any>;

const cwd = process.cwd();
const universityId = "agri-ibrahim-cecen-universitesi";
const facultyId = `${universityId}__egitim-fakultesi`;
const departmentId = `${facultyId}__okul-oncesi-ogretmenligi`;
const studentToken = "agri-student-token";

let apiServer: ReturnType<typeof createServer>;
let apiBaseUrl = "";
let mobileProcess: ChildProcessWithoutNullStreams | undefined;
let mobileUrl = "";
let mobileOutput = "";
let seenPaths: string[] = [];
let alarmRequests: JsonRecord[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  apiServer = createServer((request, response) => {
    void handleMockApi(request, response);
  });
  apiServer.listen(0, "127.0.0.1");
  await once(apiServer, "listening");
  const address = apiServer.address();
  if (!address || typeof address === "string") throw new Error("Mock API did not bind to a TCP port.");
  apiBaseUrl = `http://127.0.0.1:${address.port}`;

  const mobilePort = 3302;
  mobileUrl = `http://127.0.0.1:${mobilePort}`;
  const viteBin = resolve(cwd, "node_modules", "vite", "bin", "vite.js");
  mobileProcess = spawn(process.execPath, [viteBin, "--config", "apps/mobile/vite.config.ts", "--host", "127.0.0.1", "--port", String(mobilePort)], {
    cwd,
    env: { ...process.env, VITE_API_BASE_URL: apiBaseUrl },
    windowsHide: true
  });
  mobileProcess.stdout.on("data", (chunk) => {
    mobileOutput += chunk.toString();
  });
  mobileProcess.stderr.on("data", (chunk) => {
    mobileOutput += chunk.toString();
  });
  await waitForUrl(mobileUrl, 30_000);
});

test.afterAll(async () => {
  mobileProcess?.kill();
  await new Promise<void>((resolveClose) => apiServer.close(() => resolveClose()));
});

test("Agri student profile uses one central academic calendar and custom alarms", async ({ page }) => {
  seenPaths = [];
  alarmRequests = [];

  await page.goto(mobileUrl);
  await page.getByLabel("E-posta").fill("student@agri.edu.tr");
  await page.locator("input[type='password']").fill("StrongPass-2026!");
  await page.getByRole("button", { name: "Devam Et", exact: true }).click();

  await expect(page.getByRole("heading", { name: /Student|renci Ana Sayfas/ })).toBeVisible();

  await page.getByRole("button", { name: "Takvim", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Akademik Takvimim" })).toBeVisible();
  await expect(page.getByText("Agri Ibrahim Cecen University")).toBeVisible();
  await expect(page.locator(".calendarTitle")).toHaveCount(1);
  await expect(page.getByText("AICU University Academic Calendar 2026-2027")).toBeVisible();
  await expect(page.getByText("Agri University Registration 2026")).toBeVisible();
  await expect(page.getByText("Agri University Fifth Calendar Event 2027")).toBeVisible();
  await expect(page.getByText("Agri University Hidden Calendar Event 2027")).toHaveCount(0);
  await page.getByRole("button", { name: "Daha fazla gör (1)" }).click();
  await expect(page.getByText("Agri University Hidden Calendar Event 2027")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bölüm Ders Programı" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bölüm Sınav Programı" })).toBeVisible();
  await expect(page.getByText("Agri Department Course Schedule 2026")).toBeVisible();
  await expect(page.getByText("Agri Department Final Exam 2026")).toBeVisible();
  await expect(page.getByText(/Resmi PDF kaynağı/i)).toHaveCount(0);
  await expect(page.getByText(/Tarih Yok|Tarih yok|2022|2023|2024/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ders Programı", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sınav Programı", exact: true })).toHaveCount(0);
  expect(seenPaths.some((path) => path.startsWith("/calendar/my?"))).toBe(false);
  expect(seenPaths.some((path) => path.includes("/calendar/my/course-schedules"))).toBe(true);
  expect(seenPaths.some((path) => path.includes("/calendar/my/exam-schedules"))).toBe(true);

  const calendarCard = page.locator("article").filter({ hasText: "Agri University Registration 2026" });
  await calendarCard.getByRole("button", { name: /Zaman/ }).click();
  await expect.poll(() => alarmRequests.length).toBe(1);
  expect(alarmRequests[0]).toMatchObject({
    eventType: "calendar_event",
    targetId: "agri-registration-2026",
    trigger: "at_time",
    amount: 0,
    unit: "days",
    universityId,
    facultyId,
    departmentId
  });

  const examCard = page.locator("article").filter({ hasText: "Agri Department Final Exam 2026" });
  await examCard.getByRole("button", { name: /1 g/ }).click();
  await expect.poll(() => alarmRequests.length).toBe(2);
  expect(alarmRequests[1]).toMatchObject({
    eventType: "exam",
    targetId: "agri-final-exam-2026",
    trigger: "before",
    amount: 1,
    unit: "days",
    universityId,
    facultyId,
    departmentId
  });

  const courseCard = page.locator("article").filter({ hasText: "Agri Department Course Schedule 2026" });
  await courseCard.getByRole("button", { name: /3 saat/ }).click();
  await expect.poll(() => alarmRequests.length).toBe(3);
  expect(alarmRequests[2]).toMatchObject({
    eventType: "course",
    targetId: "agri-course-schedule-2026",
    trigger: "before",
    amount: 3,
    unit: "hours",
    universityId,
    facultyId,
    departmentId
  });

  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Detaylı Ayarlar" })).toBeVisible();
  await expect(page.getByText("Akademik takvim yalnızca üniversitenize göre gösterilir; fakülte veya bölüm takvimi ayrıca gösterilmez.")).toBeVisible();
  await expect(page.locator('select[name="universityId"] option', { hasText: "Agri Ibrahim Cecen University" })).toHaveCount(1);
  await expect(page.locator('select[name="universityId"] option', { hasText: "Mock Ankara University" })).toHaveCount(1);
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(page.locator('select[name="reminderMode"]')).toBeVisible();
  await expect(page.getByText(/Takip Ekle|Üniversiteyi takip et|Fakülteyi takip et|Bölümü takip et/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Duyurular", exact: true }).click();
  await expect(page.getByText("Agri Global 2026 Registration")).toBeVisible();
  await expect(page.getByText("Agri Faculty 2026 Orientation")).toHaveCount(0);
  await expect(page.getByText("Agri Department 2026 Exam Notice")).toHaveCount(0);
  await expect(page.locator(".scopeTabs")).toHaveCount(0);
  await expect(page.getByText(/Tarih Yok|Tarih yok|2022|2023|2024/i)).toHaveCount(0);

  const announcementCard = page.locator("article").filter({ hasText: "Agri Global 2026 Registration" });
  await announcementCard.getByRole("button", { name: /Hat/ }).click();
  await expect.poll(() => alarmRequests.length).toBe(4);
  expect(alarmRequests[3]).toMatchObject({
    eventType: "announcement",
    targetId: "uni-ann-2026",
    trigger: "at_time",
    universityId,
    facultyId,
    departmentId
  });
});

async function handleMockApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", apiBaseUrl);
  seenPaths.push(`${url.pathname}${url.search}`);

  if (request.method === "POST" && url.pathname === "/auth/login") {
    return sendJson(response, {
      accessToken: studentToken,
      refreshToken: "refresh-token",
      user: { id: "student-1", fullName: "Agri Student", email: "student@agri.edu.tr", role: "student" }
    });
  }

  if (request.method === "GET" && url.pathname === "/universities") return sendJson(response, [university, secondUniversity]);
  if (request.method === "GET" && url.pathname === `/universities/${universityId}/faculties`) return sendJson(response, [faculty]);
  if (request.method === "GET" && url.pathname === `/faculties/${facultyId}/departments`) return sendJson(response, [department]);
  if (request.method === "GET" && url.pathname === "/me") return sendJson(response, profile);
  if (request.method === "GET" && url.pathname === "/me/affiliation-options") {
    return sendJson(response, { emailDomain: "agri.edu.tr", university, faculties: [faculty], departments: [department], classLevelOptions: [1, 2, 3, 4], needsUniversityReview: false });
  }
  if (request.method === "GET" && url.pathname === "/calendar/my") return sendJson(response, calendarPayload);
  if (request.method === "GET" && url.pathname === "/calendar/my/course-schedules") return sendJson(response, courseSchedulePayload);
  if (request.method === "GET" && url.pathname === "/calendar/my/exam-schedules") return sendJson(response, examSchedulePayload);
  if (request.method === "GET" && url.pathname === "/announcements/my") return sendJson(response, announcements);
  if (request.method === "POST" && url.pathname === "/notification-alarms") {
    const body = await readJson(request);
    alarmRequests.push(body);
    return sendJson(response, { id: `alarm-${alarmRequests.length}`, ...body, status: "scheduled", dueAt: body.scheduledFor });
  }

  response.writeHead(404);
  response.end(JSON.stringify({ message: `Unhandled mock route ${request.method} ${url.pathname}` }));
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200);
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) as JsonRecord : {};
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
  throw new Error(`Timed out waiting for ${url}\n${mobileOutput}`);
}

const university = {
  id: universityId,
  name: "Agri Ibrahim Cecen University",
  city: "Agri",
  type: "state"
};

const secondUniversity = {
  id: "mock-ankara-university",
  name: "Mock Ankara University",
  city: "Ankara",
  type: "state"
};

const faculty = {
  id: facultyId,
  universityId,
  name: "Education Faculty",
  announcementUrl: "https://www.agri.edu.tr/detail.aspx?bid=2&tid=17"
};

const department = {
  id: departmentId,
  universityId,
  facultyId,
  name: "Preschool Teaching",
  educationLevel: "bachelor",
  courseScheduleUrl: "https://www.agri.edu.tr/upload/egitim/2026-ders-programi.xlsx",
  examScheduleUrl: "https://www.agri.edu.tr/upload/egitim/2026-sinav-programi.pdf"
};

const profile = {
  id: "student-1",
  fullName: "Agri Student",
  email: "student@agri.edu.tr",
  role: "student",
  universityId,
  facultyId,
  departmentId,
  classLevel: 2,
  status: "active"
};

const calendarPayload = {
  scope: "university",
  sourceStatus: "source_only",
  calendar: {
    id: "agri-central-calendar",
    title: "AICU University Academic Calendar 2026-2027",
    academicYear: "2026-2027",
    status: "published",
    sourceUrl: "https://www.agri.edu.tr/upload/anasayfa/2025-2026-AKADEMIK-TAKVIM.pdf"
  },
  events: [
    {
      id: "agri-registration-2026",
      title: "Agri University Registration 2026",
      category: "course_registration",
      startDate: "2026-09-14T09:00:00.000+03:00",
      endDate: "2026-09-18T17:00:00.000+03:00",
      universityId
    },
    {
      id: "agri-orientation-2026",
      title: "Agri University Orientation 2026",
      category: "orientation",
      startDate: "2026-09-20T09:00:00.000+03:00",
      universityId
    },
    {
      id: "agri-add-drop-2026",
      title: "Agri University Add Drop 2026",
      category: "add_drop",
      startDate: "2026-09-28T09:00:00.000+03:00",
      universityId
    },
    {
      id: "agri-holiday-2026",
      title: "Agri University Holiday 2026",
      category: "holiday",
      startDate: "2026-10-29T00:00:00.000+03:00",
      universityId
    },
    {
      id: "agri-fifth-calendar-2027",
      title: "Agri University Fifth Calendar Event 2027",
      category: "custom_event",
      startDate: "2027-01-02T09:00:00.000+03:00",
      universityId
    },
    {
      id: "agri-hidden-calendar-2027",
      title: "Agri University Hidden Calendar Event 2027",
      category: "custom_event",
      startDate: "2027-01-03T09:00:00.000+03:00",
      universityId
    },
    {
      id: "agri-course-schedule-2026",
      title: "Agri Department Course Schedule 2026",
      category: "course_schedule",
      startDate: "2026-09-21T09:00:00.000+03:00",
      universityId,
      facultyId,
      departmentId
    },
    {
      id: "agri-final-exam-2026",
      title: "Agri Department Final Exam 2026",
      category: "department_exam_schedule",
      startDate: "2026-12-28T10:00:00.000+03:00",
      endDate: "2027-01-08T17:00:00.000+03:00",
      universityId,
      facultyId,
      departmentId
    }
  ]
};

const courseSchedulePayload = {
  profile: {
    universityId,
    facultyId,
    departmentId
  },
  events: [
    {
      id: "agri-course-schedule-2026",
      title: "Agri Department Course Schedule 2026",
      category: "course_schedule",
      startDate: "2026-09-21T09:00:00.000+03:00",
      universityId,
      facultyId,
      departmentId
    }
  ]
};

const examSchedulePayload = {
  profile: {
    universityId,
    facultyId,
    departmentId
  },
  events: [
    {
      id: "agri-final-exam-2026",
      title: "Agri Department Final Exam 2026",
      category: "department_exam_schedule",
      startDate: "2026-12-28T10:00:00.000+03:00",
      endDate: "2027-01-08T17:00:00.000+03:00",
      universityId,
      facultyId,
      departmentId
    }
  ]
};

const announcements = [
  {
    id: "uni-ann-2026",
    sourceName: "University Announcements",
    scopeType: "university",
    scopeId: universityId,
    title: "Agri Global 2026 Registration",
    link: "https://www.agri.edu.tr/detail.aspx?id=70000",
    publishedAt: "2026-07-01T09:00:00.000+03:00"
  },
  {
    id: "faculty-ann-2026",
    sourceName: "Faculty Announcements",
    scopeType: "faculty",
    scopeId: facultyId,
    title: "Agri Faculty 2026 Orientation",
    link: "https://www.agri.edu.tr/detail.aspx?id=70001",
    publishedAt: "2026-07-01T10:00:00.000+03:00"
  },
  {
    id: "dept-ann-2026",
    sourceName: "Department Announcements",
    scopeType: "department",
    scopeId: departmentId,
    title: "Agri Department 2026 Exam Notice",
    link: "https://www.agri.edu.tr/detail.aspx?id=70002",
    publishedAt: "2026-07-01T11:00:00.000+03:00"
  }
];
