import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "https://academic-calendar-api-qrld4semgq-ew.a.run.app";
const mobileUrl = process.env.E2E_MOBILE_URL ?? "https://academic-mobile-app-7629.web.app";
const runId = process.env.E2E_RUN_ID ?? String(Date.now());
const userCount = Number(process.env.E2E_USER_COUNT ?? 10);
const userDelayMs = Number(process.env.E2E_USER_DELAY_MS ?? 15_000);
const password = `CodexSmoke!${runId}`;
const chromePath = process.env.E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outputPath = process.env.E2E_OUTPUT_PATH ?? resolve("C:\\tmp", `academic-live-smoke-${runId}.json`);
const originHeaders = {
  Origin: mobileUrl,
  "Content-Type": "application/json"
};
const summerMatchPattern = /yaz okulu|yazokulu|yaz-okulu|yaz ogretimi|summer school|summer term/iu;
const priorityUniversityIds = [
  "acibadem-mehmet-ali-aydinlar-universitesi-istanbul",
  "abdullah-gul-universitesi-kayseri",
  "ankara-universitesi",
  "bartin-universitesi",
  "canakkale-onsekiz-mart-universitesi",
  "dicle-universitesi",
  "ege-universitesi",
  "marmara-universitesi",
  "sakarya-universitesi",
  "yeditepe-universitesi-istanbul",
  "zonguldak-bulent-ecevit-universitesi"
];

const summary = {
  runId,
  apiBaseUrl,
  mobileUrl,
  userCount,
  userDelayMs,
  startedAt: new Date().toISOString(),
  risks: [],
  interface: {
    browser: "system-chrome",
    usersTested: 0,
    consoleErrors: [],
    requestFailures: [],
    httpErrors: []
  },
  users: []
};

const catalogSources = JSON.parse((await readFile(resolve("apps/api/src/bootstrap/verified-university-sources.json"), "utf8")).replace(/^\uFEFF/u, ""));
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true
});

try {
  await checkHostedShell();
  const profiles = await selectProfiles(userCount);

  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    const email = `codex.10user.${runId}.${index + 1}@example.com`;
    const result = {
      index: index + 1,
      email,
      universityId: profile.universityId,
      universityName: profile.universityName,
      facultyId: profile.facultyId,
      departmentId: profile.departmentId,
      createdVia: index === 0 ? "ui" : "api",
      previewVerificationTokenExposed: false,
      api: {},
      ui: {}
    };

    try {
      let session;
      if (index === 0) {
        session = await registerVerifyAndLoginThroughUi({ email, profile });
        result.previewVerificationTokenExposed = session.previewVerificationTokenExposed;
      } else {
        const registration = await registerVerifyThroughApi({ email, profile });
        result.previewVerificationTokenExposed = registration.previewVerificationTokenExposed;
        session = await loginAndNavigateThroughUi({ email, viewport: viewportFor(index), result });
        result.previewVerificationTokenExposed = session.previewVerificationTokenExposed;
      }

      const apiChecks = await checkAuthenticatedFeeds(session.accessToken);
      result.api = apiChecks;
      if (index === 0) {
        result.ui.registration = true;
        result.ui.login = true;
        result.ui.navigation = true;
      }
      summary.users.push(result);
      summary.interface.usersTested += 1;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      summary.users.push(result);
    }

    if (index < profiles.length - 1 && userDelayMs > 0) {
      await delay(userDelayMs);
    }
  }

  if (summary.users.some((user) => user.previewVerificationTokenExposed)) {
    summary.risks.push("Live registration responses expose previewVerificationToken, allowing email verification without mailbox access.");
  }
  if (summary.users.some((user) => user.error)) {
    summary.risks.push("At least one user journey failed; inspect the per-user error field.");
  }
  if (summary.interface.consoleErrors.length > 0) {
    summary.risks.push("Browser console errors appeared during hosted UI tests.");
  }
  if (summary.interface.requestFailures.length > 0 || summary.interface.httpErrors.length > 0) {
    summary.risks.push("Browser request failures or HTTP errors appeared during hosted UI tests.");
  }
  if (summary.users.some((user) => user.api?.summerSchool?.hasOwnAnnouncementsProperty === false)) {
    summary.risks.push("Live summer-school payload omits ownAnnouncements, while local mobile code expects that field.");
  }
  if (summary.users.some((user) => (user.api?.announcements?.exactSummerSchoolMatches ?? 0) === 0 && (user.api?.summerSchool?.requirementsCount ?? 0) === 0)) {
    summary.risks.push("Some universities with verified summer sources still surface no exact summer-school announcement or parsed requirement for the tested student.");
  }
} finally {
  summary.finishedAt = new Date().toISOString();
  await browser.close();
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(summary, null, 2));
console.error(`Detailed summary written to ${outputPath}`);

async function checkHostedShell() {
  const response = await fetch(mobileUrl, { headers: { Accept: "text/html" } });
  if (!response.ok) throw new Error(`Hosted mobile shell failed: ${response.status}`);
  const body = await response.text();
  summary.interface.hostedShell = {
    status: response.status,
    hasRoot: body.includes('id="root"'),
    hasModuleScript: /<script[^>]+type="module"/iu.test(body),
    title: body.match(/<title>(.*?)<\/title>/iu)?.[1] ?? ""
  };
}

async function selectProfiles(count) {
  const ordered = [
    ...priorityUniversityIds,
    ...catalogSources
      .filter((item) => item.summerSchoolStatus === "source_found")
      .map((item) => item.universityId)
  ].filter((value, index, values) => value && values.indexOf(value) === index);

  const profiles = [];
  for (const universityId of ordered) {
    if (profiles.length >= count) break;
    const source = catalogSources.find((item) => item.universityId === universityId);
    const profile = await firstCatalogProfile(universityId, source?.universityName ?? universityId);
    if (profile) profiles.push(profile);
  }
  if (profiles.length < count) throw new Error(`Only found ${profiles.length} usable university/faculty/department profiles.`);
  return profiles;
}

async function firstCatalogProfile(universityId, universityName) {
  try {
    const faculties = await apiJson("GET", `/universities/${universityId}/faculties`);
    for (const faculty of faculties) {
      const departments = await apiJson("GET", `/faculties/${faculty.id}/departments`);
      const department = departments[0];
      if (department) {
        return {
          universityId,
          universityName,
          facultyId: faculty.id,
          facultyName: faculty.name,
          departmentId: department.id,
          departmentName: department.name,
          classLevel: 1
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function registerVerifyAndLoginThroughUi({ email, profile }) {
  const page = await newPage(viewportFor(0));
  try {
    await page.goto(mobileUrl, { waitUntil: "domcontentloaded" });
    await page.locator("input[name='email']").waitFor({ state: "visible" });
    await page.locator(".tabs button").nth(1).click();
    await page.locator("input[name='email']").fill(email);
    await page.locator("input[name='password']").fill(password);
    await page.locator("input[name='passwordConfirmation']").fill(password);
    await page.locator("select[name='universityId']").selectOption(profile.universityId);
    await page.locator(`select[name='facultyId'] option[value="${cssEscape(profile.facultyId)}"]`).waitFor({ state: "attached" });
    await page.locator("select[name='facultyId']").selectOption(profile.facultyId);
    await page.locator(`select[name='departmentId'] option[value="${cssEscape(profile.departmentId)}"]`).waitFor({ state: "attached" });
    await page.locator("select[name='departmentId']").selectOption(profile.departmentId);
    const classSelect = page.locator("select[name='classLevel']");
    if (await classSelect.count()) await classSelect.selectOption(String(profile.classLevel));
    await page.locator("form.stack button.btn-primary").click();

    const verificationInput = page.locator("input[name='verificationToken']");
    await verificationInput.waitFor({ state: "visible" });
    await expectValue(verificationInput, /^\d{4}$/u, "UI verification token was not auto-filled.");
    const previewVerificationTokenExposed = true;
    await page.locator("form.stack button.btn-primary").click();
    await page.locator("input[name='email']").waitFor({ state: "visible" });
    await page.locator("input[name='email']").fill(email);
    await page.locator("input[name='password']").fill(password);
    const loginResponsePromise = waitForLoginResponse(page);
    await page.locator("form.stack button.btn-primary").click();
    const loginResponse = await loginResponsePromise;
    await assertStudentNavigation(page);
    return { ...loginResponse, previewVerificationTokenExposed };
  } finally {
    await page.close();
  }
}

async function registerVerifyThroughApi({ email, profile }) {
  const registration = await apiJson("POST", "/auth/register", {
    fullName: `Codex Ten User ${email}`,
    email,
    password,
    passwordConfirmation: password,
    universityId: profile.universityId,
    facultyId: profile.facultyId,
    departmentId: profile.departmentId,
    classLevel: profile.classLevel
  });

  const previewVerificationTokenExposed = Boolean(registration.previewVerificationToken);
  if (!registration.previewVerificationToken) throw new Error(`Registration for ${email} did not expose a preview verification token.`);
  await apiJson("POST", "/auth/verify-email", {
    email,
    code: registration.previewVerificationToken,
    deviceId: `codex-api-${runId}`
  });
  return { previewVerificationTokenExposed };
}

async function loginAndNavigateThroughUi({ email, viewport, result }) {
  const page = await newPage(viewport);
  try {
    await page.goto(mobileUrl, { waitUntil: "domcontentloaded" });
    await page.locator("input[name='email']").fill(email);
    await page.locator("input[name='password']").fill(password);
    const loginResponsePromise = waitForLoginResponse(page);
    await page.locator("form.stack button.btn-primary").click();
    const loginResponse = await loginResponsePromise;
    await assertStudentNavigation(page);
    result.ui.login = true;
    result.ui.navigation = true;
    result.previewVerificationTokenExposed = result.previewVerificationTokenExposed ?? false;
    return { ...loginResponse, previewVerificationTokenExposed: result.previewVerificationTokenExposed };
  } finally {
    await page.close();
  }
}

async function assertStudentNavigation(page) {
  await page.locator(".studentNav").waitFor({ state: "visible", timeout: 45_000 });
  await page.locator(".studentNav button").nth(2).click();
  await page.locator("h2").filter({ hasText: /Duyurular/iu }).first().waitFor({ state: "visible" });
  await page.locator(".studentNav button").nth(3).click();
  await page.locator("h2").filter({ hasText: /Yaz Okulu/iu }).first().waitFor({ state: "visible" });
  await page.locator(".studentNav button").nth(5).click();
  await page.locator("select[name='reminderMode']").waitFor({ state: "visible" });
}

async function checkAuthenticatedFeeds(accessToken) {
  const announcements = await apiJson("GET", "/announcements/my?limit=80", undefined, accessToken);
  const exactMatches = announcements.filter((item) => summerMatchPattern.test(foldForMatch(`${item.title} ${item.summary ?? ""} ${item.link} ${item.sourceName}`)));
  const summerSchool = await apiJson("GET", "/calendar/summer-school/my", undefined, accessToken);
  let calendarStatus = "ok";
  try {
    await apiJson("GET", "/calendar/my", undefined, accessToken);
  } catch (error) {
    calendarStatus = error instanceof Error ? error.message : String(error);
  }

  return {
    announcements: {
      total: announcements.length,
      exactSummerSchoolMatches: exactMatches.length,
      firstSummerSchoolMatch: exactMatches[0]
        ? {
          title: exactMatches[0].title,
          link: exactMatches[0].link,
          sourceName: exactMatches[0].sourceName
        }
        : null
    },
    summerSchool: {
      profile: summerSchool.profile,
      requirementsCount: countValue(summerSchool.requirements),
      ownAnnouncementsCount: countValue(summerSchool.ownAnnouncements),
      sameDepartmentAnnouncementsCount: countValue(summerSchool.sameDepartmentAnnouncements),
      sameDepartmentOptionsCount: countValue(summerSchool.sameDepartmentOptions),
      hasOwnAnnouncementsProperty: Object.prototype.hasOwnProperty.call(summerSchool, "ownAnnouncements"),
      firstRequirement: summerSchool.requirements?.[0]
        ? {
          message: summerSchool.requirements[0].message,
          date: summerSchool.requirements[0].date,
          sourceUrl: summerSchool.requirements[0].sourceUrl ?? null
        }
        : null
    },
    calendarStatus
  };
}

async function newPage(viewport) {
  const context = await browser.newContext({
    viewport,
    ignoreHTTPSErrors: false
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on("console", (message) => {
    if (message.type() === "error") {
      summary.interface.consoleErrors.push(message.text());
    }
  });
  page.on("requestfailed", (request) => {
    summary.interface.requestFailures.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? "unknown"
    });
  });
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && !url.includes("favicon")) {
      summary.interface.httpErrors.push({ url, status });
    }
  });
  page.on("pageerror", (error) => {
    summary.interface.consoleErrors.push(error.message);
  });
  return page;
}

async function apiJson(method, path, body, token) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      ...originHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function waitForLoginResponse(page) {
  const response = await page.waitForResponse((candidate) => (
    candidate.url().startsWith(`${apiBaseUrl}/auth/login`) &&
    candidate.request().method() === "POST"
  ), { timeout: 45_000 });
  const text = await response.text();
  if (!response.ok()) throw new Error(`UI login failed with ${response.status()}: ${text}`);
  return JSON.parse(text);
}

function viewportFor(index) {
  return index % 2 === 0 ? { width: 390, height: 844 } : { width: 1280, height: 720 };
}

function countValue(value) {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.length;
  return 1;
}

function foldForMatch(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .toLocaleLowerCase("en-US");
}

async function expectValue(locator, pattern, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const value = await locator.inputValue();
    if (pattern.test(value)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(message);
}

async function delay(ms) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function cssEscape(value) {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}
