import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ChildProcess;
const port = process.env.ADMIN_TREE_TEST_PORT ?? "3348";
const base = `http://127.0.0.1:${port}/admin/`;
const api = "http://academic-tree.qa";
if (process.env.ADMIN_CATALOG_SNAPSHOT) test.use({ trace: "off", video: "off" });
test.beforeAll(async () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "admin-source-tree-e2e-"));
  execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "apps/admin/vite.config.ts", "--outDir", outputDirectory], { env: { ...process.env, VITE_API_BASE_URL: api } });
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--config", "apps/admin/vite.config.ts", "--outDir", outputDirectory, "--host", "127.0.0.1", "--port", port, "--strictPort"],
    { env: { ...process.env, VITE_API_BASE_URL: api }, stdio: "ignore" });
  await expect.poll(async () => { try { return (await fetch(base)).status; } catch { return 0; } }).toBe(200);
});

test("every branch in the audited live catalog is reachable without a source record", async ({ page }) => {
  const snapshotPath = process.env.ADMIN_CATALOG_SNAPSHOT;
  test.skip(!snapshotPath, "Set ADMIN_CATALOG_SNAPSHOT to a completed read-only catalog audit.");
  test.setTimeout(1800000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { summary, tree: catalog } = JSON.parse(readFileSync(snapshotPath!, "utf8"));
  expect(summary.errors).toEqual([]);
  const units = Object.values(catalog) as { university: any; faculties: { faculty: any; departments: any[] }[] }[];
  const user = { id: "catalog-admin", email: "catalog@qa.local", fullName: "Catalog QA", role: "super_admin" };
  await page.route(`${api}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/me") return json(user);
    if (path === "/universities") return json(units.map((unit) => unit.university));
    if (path === "/admin/announcements/source-profiles") return json({ universities: [] });
    if (path === "/admin/source-coverage") return json({ total: 0, items: [], summary: { catalog: { universities: units.length, academicUnits: 0, faculties: 0, departments: 0 }, byResolution: { missing: 0, quarantined: 0, verified: 0, legacy_unverified: 0 } } });
    if (path === "/admin/announcements/review-items") return json({ items: [], total: 0, hasMore: false });
    const universityId = /^\/universities\/([^/]+)\/faculties$/.exec(path)?.[1];
    if (universityId) return json(catalog[decodeURIComponent(universityId)].faculties.map((unit: any) => unit.faculty));
    const facultyId = /^\/faculties\/([^/]+)\/departments$/.exec(path)?.[1];
    if (facultyId) return json(units.flatMap((unit) => unit.faculties).find((unit) => unit.faculty.id === decodeURIComponent(facultyId))?.departments ?? []);
    return json([]);
  });
  await page.addInitScript(({ user }) => sessionStorage.setItem("academic-calendar-admin-session", JSON.stringify({ accessToken: "catalog-token", user })), { user });
  await page.goto(`${base}#/sources`);
  const workbench = page.locator(".academicSourceWorkbench");
  const tree = workbench.locator(".academicTreePane");
  await expect(tree.locator(".academicTreeSelect")).toHaveCount(units.length);
  let seenFaculties = 0;
  let seenDepartments = 0;
  let seenUniversities = 0;
  for (const unit of units) {
    const universityBranch = tree.locator(`[data-unit-key="university:${unit.university.id}"]`);
    const universityToggle = universityBranch.locator(":scope > .academicTreeRow .academicTreeToggle");
    await universityToggle.press("Enter");
    await expect.poll(() => universityBranch.locator('[data-unit-key^="faculty:"]').count(), { intervals: [10, 20, 50] }).toBe(unit.faculties.length);
    for (const child of unit.faculties) {
      const facultyBranch = universityBranch.locator(`[data-unit-key="faculty:${child.faculty.id}"]`);
      const toggle = facultyBranch.locator(":scope > .academicTreeRow .academicTreeToggle");
      await toggle.press("Enter");
      const departments = facultyBranch.locator('[data-unit-key^="department:"] .academicTreeSelect span');
      await expect.poll(() => departments.count(), { intervals: [10, 20, 50] }).toBe(child.departments.length);
      expect(await departments.allTextContents()).toEqual(child.departments.map((department) => department.name));
      if (child.departments.length) {
        await facultyBranch.locator('[data-unit-key^="department:"] .academicTreeSelect').last().press("Enter");
        await expect.poll(() => workbench.locator(".academicSelectionHeader h3").textContent(), { intervals: [10, 20, 50] }).toBe(child.departments.at(-1).name);
        await expect(workbench.locator(".scopedSourceEditor")).toBeVisible();
      }
      seenFaculties++;
      seenDepartments += child.departments.length;
      await toggle.press("Enter");
    }
    await universityToggle.press("Enter");
    seenUniversities++;
    if (seenUniversities % 20 === 0) console.log(`Checked ${seenUniversities}/${units.length} university branches`);
  }
  expect(seenFaculties).toBe(summary.faculties);
  expect(seenDepartments).toBe(summary.departments);
  console.log(`Rendered ${units.length} universities, ${seenFaculties} faculties, ${seenDepartments} departments`);
});
test.afterAll(() => server?.kill());

test("coverage follows university selection and corrections open the exact unit", async ({ page }) => {
  const user = { id: "admin", email: "admin@qa.local", fullName: "Test", role: "super_admin" };
  const universities = [{ id: "u1", name: "Abdullah Gül Üniversitesi" }, { id: "u2", name: "İkinci Üniversitesi" }];
  const writes: any[] = [];
  const coverageRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${api}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/me") return json(user);
    if (path === "/universities") return json(universities);
    if (/^\/universities\/u[12]\/faculties$/.test(path)) {
      const universityId = path.split("/")[2];
      return json([{ id: `${universityId}-f`, universityId, name: "Mühendislik Fakültesi", websiteUrl: "https://qa.edu.tr/faculty" }]);
    }
    if (/^\/faculties\/u[12]-f\/departments$/.test(path)) {
      const facultyId = path.split("/")[2];
      return json([{ id: `${facultyId}-d`, facultyId, name: "Bilgisayar Mühendisliği", websiteUrl: "https://qa.edu.tr/department", examScheduleUrl: "https://qa.edu.tr/exams" }]);
    }
    if (path === "/admin/announcements/source-profiles") return json({ universities: [] });
    if (path === "/admin/source-coverage") {
      const universityId = url.searchParams.get("universityId") || "u1";
      coverageRequests.push(universityId);
      // A slow old response must not replace the subsequently selected university.
      if (universityId === "u1") await new Promise((resolve) => setTimeout(resolve, 150));
      const items = ["course_schedule", "exam_schedule", "homepage", "announcement", "news", "event", "academic_calendar"].map((sourceType) => ({
        id: `${universityId}:${sourceType}`, universityId, universityName: universities.find((unit) => unit.id === universityId)!.name,
        facultyId: `${universityId}-f`, facultyName: "Mühendislik Fakültesi", scopeId: `${universityId}-f-d`, scopeType: "department",
        departmentId: `${universityId}-f-d`, departmentName: "Bilgisayar Mühendisliği", scopeName: "Bilgisayar Mühendisliği", sourceType, resolution: "missing"
      }));
      return json({ total: items.length, items, summary: { catalog: { universities: 2, academicUnits: 4 }, byResolution: { missing: 14, quarantined: 0, verified: 0, legacy_unverified: 0 } } });
    }
    if (path === "/admin/announcements/review-items") return json({ items: [], total: 0 });
    if (route.request().method() === "PATCH") { writes.push({ path, body: route.request().postDataJSON() }); return json({ status: "ok" }); }
    return json([]);
  });
  await page.addInitScript(({ user }) => sessionStorage.setItem("academic-calendar-admin-session", JSON.stringify({ accessToken: "coverage-token", user })), { user });
  await page.goto(`${base}#/sources`);
  const tree = page.locator(".academicTreePane");
  const coverage = page.locator(".sourceCoveragePanel");
  await tree.locator('[data-unit-key="university:u1"] > .academicTreeRow .academicTreeSelect').click();
  await tree.locator('[data-unit-key="university:u2"] > .academicTreeRow .academicTreeSelect').click();
  await expect(coverage.getByLabel("Kapsam üniversitesi")).toHaveValue("u2");
  await expect(coverage.locator(".coverageItem").first()).toContainText("İkinci Üniversitesi");
  await page.waitForTimeout(250);
  await expect(coverage.locator(".coverageItem").first()).not.toContainText("Abdullah Gül");
  await coverage.locator(".coverageItem").first().getByRole("button", { name: "Düzelt", exact: true }).click();
  await expect(page).toHaveURL(/fix=coverage/);
  await expect(page.locator(".coverageUrlCorrection h2")).toHaveText("Bilgisayar Mühendisliği");
  await page.getByLabel("Ders programı adresi", { exact: true }).fill("https://qa.edu.tr/courses");
  await page.getByRole("button", { name: "Adresi Kaydet" }).click();
  await expect(page.getByRole("status")).toContainText("Adres kaydedildi");
  expect(writes).toEqual([{ path: "/admin/departments/u2-f-d", body: { courseScheduleUrl: "https://qa.edu.tr/courses" } }]);
  // The link survives a reload; Back returns to the same university filter.
  await page.reload();
  await expect(page.locator(".coverageUrlCorrection h2")).toHaveText("Bilgisayar Mühendisliği");
  await page.getByRole("button", { name: "Uyarılara geri dön" }).click();
  await coverage.getByLabel("Kapsam üniversitesi").selectOption("u2");
  await expect(coverage.locator(".coverageItem").first()).toContainText("İkinci Üniversitesi");
  for (const sourceType of ["announcement", "news", "event"]) {
    await coverage.locator(".coverageItem").filter({ hasText: sourceType === "announcement" ? "Duyuru" : sourceType === "news" ? "Haber" : "Etkinlik" }).getByRole("button", { name: "Düzelt", exact: true }).click();
    await expect(page.locator(".academicSelectionHeader h3")).toHaveText("Bilgisayar Mühendisliği");
    await expect(page.locator(".academicContentTabs button.selected")).toHaveText(sourceType === "announcement" ? "Duyuru" : sourceType === "news" ? "Haber" : "Etkinlik");
    await page.getByRole("button", { name: "Uyarılara geri dön" }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await coverage.locator(".coverageItem").filter({ hasText: "Web sitesi" }).getByRole("button", { name: "Düzelt", exact: true }).click();
  await expect(page.getByLabel("Web sitesi adresi", { exact: true })).toHaveValue("https://qa.edu.tr/department");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(coverageRequests).toContain("u2");
  expect(errors).toEqual([]);
});

test("all academic units, paginated sources and every parser field can be edited", async ({ page }) => {
  const now = new Date().toISOString();
  const user = { id: "admin", email: "admin@qa.local", fullName: "Test", role: "super_admin" };
  const universities = [{ id: "u1", name: "Örnek Üniversitesi", city: "Ankara", status: "active" }, { id: "u2", name: "İkinci Üniversitesi", city: "İzmir", status: "active" }];
  const faculties = Array.from({ length: 45 }, (_, index) => ({ id: `f${index}`, universityId: "u1", name: index === 44 ? "Mühendislik Fakültesi" : `Fakülte ${index}` }));
  const departments = Array.from({ length: 75 }, (_, index) => ({ id: `d${index}`, universityId: "u1", facultyId: "f44", name: index === 74 ? "Bilgisayar Mühendisliği" : `Bölüm ${index}` }));
  let sources: Record<string, any>[] = Array.from({ length: 105 }, (_, index) => ({
    id: `source-${index}`, scopeType: "faculty", scopeId: `f${index % 44}`, ownerUniversityId: "u1", sourceName: `Kaynak ${index}`,
    sourceUrl: `https://qa.edu.tr/news/${index}`, contentType: "news", parser: "auto", priority: 50, fetchIntervalMinutes: 180,
    status: "active", trustStatus: "trusted", healthStatus: "healthy", lastCheckedAt: now, updatedAt: now
  }));
  for (const [scopeType, scopeId] of [["university", "u1"], ["faculty", "f0"], ["department", "d0"]]) sources.push({
    ...sources[0], id: `problem-${scopeType}`, scopeType, scopeId, ownerUniversityId: "u1", ownerFacultyId: scopeType === "department" ? "f44" : undefined,
    sourceName: `${scopeType} hatalı kaynak`, healthProbeStatus: "failed", healthProbeFailureCode: "PARSER_FAILED", lastHealthProbeAt: now
  });
  sources.push({ ...sources[0], id: "legacy-source", scopeId: "f0", sourceName: "Legacy duyuru kaynağı", contentType: undefined, healthStatus: "failed" });
  let failNextSourcesRead = false;
  let rejectNextSave = false;
  let previewGate: Promise<void> | undefined;
  let releasePreview: (() => void) | undefined;
  let nextPreviewError = "";
  const writes: { path: string; method: string; body: Record<string, any> }[] = [];
  const requests: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const slot = (contentType: string) => ({ contentType, sourceId: `u1-${contentType}`, sourceName: `Üniversite ${contentType}`, sourceUrl: `https://qa.edu.tr/${contentType}`, parser: "auto",
    ...(contentType === "news" ? { healthProbeStatus: "failed", healthProbeFailureCode: "PARSER_FAILED" } : {}),
    status: "active", trustStatus: "trusted", sourceStatus: "source_found", resolution: "verified", evidenceStatus: "verified", siteStructure: {}, lastTest: { status: "healthy", checkedAt: now, itemCount: 2 } });
  const profiles = { summary: { universities: 1, sourceSlots: 4, returnedUniversities: 1, returnedSourceSlots: 4 }, universities: universities.slice(0, 1).map((unit) => ({
    universityId: unit.id, universityName: unit.name, city: unit.city, authority: { homepageUrl: "https://qa.edu.tr" }, slots: ["announcement", "news", "event", "academic_calendar"].map(slot)
  })) };
  await page.route(`${api}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    requests.push(`${path}${url.search}`);
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/me") return json(user);
    if (path === "/universities") return json(universities);
    if (path === "/universities/u1/faculties") return json(faculties);
    if (path === "/universities/u2/faculties") return json([{ id: "second-faculty", universityId: "u2", name: "Hukuk Fakültesi" }]);
    if (path === "/faculties/f44/departments") return json(departments);
    if (/^\/faculties\/[^/]+\/departments$/.test(path)) return json([]);
    if (path === "/admin/announcements/source-profiles") return json(profiles);
    if (path === "/admin/source-coverage") return json({ total: 0, items: [], summary: { catalog: { universities: 2, academicUnits: 120, faculties: 45, departments: 75 }, byResolution: { missing: 0, quarantined: 0, verified: 0, legacy_unverified: 0 } } });
    if (path === "/admin/announcements/review-items") return json({ items: [], total: 0, hasMore: false });
    if (path === "/admin/announcements/sources" && method === "GET") {
      if (failNextSourcesRead) { failNextSourcesRead = false; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Test yenileme hatası" }) }); }
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      return json(sources.slice(offset, offset + limit));
    }
    if (method !== "GET") {
      const body = route.request().postDataJSON() ?? {};
      writes.push({ path, method, body });
      if (path === "/admin/announcements/sources" && method === "POST") {
        const source = { ...body, id: `new-${sources.length}`, scopeId: body.scopeType === "university" ? body.universityId : body.scopeType === "faculty" ? body.facultyId : body.departmentId,
          ownerUniversityId: body.universityId, ownerFacultyId: body.scopeType === "department" ? body.facultyId : undefined,
          status: "inactive", trustStatus: "quarantined", sourceDefinitionVersion: "v1", updatedAt: now };
        sources.push(source); return json({ source });
      }
      const id = path.split("/")[4];
      if (path.endsWith("/preview")) {
        const error = nextPreviewError;
        nextPreviewError = "";
        if (previewGate) await previewGate;
        return json(error ? { sourceId: id, status: "failed", acceptedItemCount: 0, parsedItemCount: 0, samples: [], error }
          : { sourceId: id, status: "healthy", acceptedItemCount: 1, parsedItemCount: 1, samples: [{ title: "Test içeriği", url: "https://qa.edu.tr/item" }] });
      }
      if (path.endsWith("/approve")) { sources = sources.map((source) => source.id === id ? { ...source, status: "active", trustStatus: "trusted" } : source); return json({ status: "approved" }); }
      if (path.endsWith("/ingest")) return json({ status: "healthy", itemCount: 3 });
      if (method === "PUT" && path.startsWith("/admin/announcements/sources/")) {
        if (rejectNextSave) { rejectNextSave = false; return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Invalid bearer token." }) }); }
        sources = sources.map((source) => source.id === id ? { ...source, ...body } : source); return json(sources.find((source) => source.id === id));
      }
      return json({ status: "ok" });
    }
    return json([]);
  });
  await page.addInitScript(({ user }) => sessionStorage.setItem("academic-calendar-admin-session", JSON.stringify({ accessToken: "test-token", user })), { user });
  await page.goto(`${base}#/sources`);
  const workbench = page.locator(".academicSourceWorkbench");
  await expect(workbench).toContainText("109 kaynak");
  expect(requests.some((request) => request.includes("offset=100"))).toBe(true);
  const tree = workbench.locator(".academicTreePane");
  await tree.getByRole("button", { name: /Örnek Üniversitesi.*1 sorun/ }).click();
  await expect(tree.locator(".academicTreeSelect")).toHaveCount(47);
  const problemBlock = tree.getByRole("region", { name: "Sorunlu fakülte ve bölümler" });
  await expect(problemBlock.locator(".academicProblemButton")).toHaveCount(3);
  await problemBlock.locator(".academicProblemButton").filter({ hasText: "Haber · Bölüm" }).click();
  await expect(workbench.locator(".academicSelectionHeader h3")).toHaveText("Bölüm 0");
  await expect(workbench.locator(".scopedSourceEditor select").first()).toHaveValue("problem-department");
  await problemBlock.locator(".academicProblemButton").filter({ hasText: "Haber · Fakülte" }).click();
  await expect(workbench.locator(".academicSelectionHeader h3")).toHaveText("Fakülte 0");
  await expect(workbench.locator(".scopedSourceEditor select").first()).toHaveValue("problem-faculty");
  await workbench.getByLabel("Kaynak adı", { exact: true }).fill("Korunacak taslak");
  page.once("dialog", (dialog) => dialog.dismiss());
  await problemBlock.locator(".academicProblemButton").filter({ hasText: "Haber · Bölüm" }).click();
  await expect(workbench.getByLabel("Kaynak adı", { exact: true })).toHaveValue("Korunacak taslak");
  page.once("dialog", (dialog) => dialog.accept());
  await tree.locator(".academicTreeSelect").filter({ hasText: "Fakülte 0" }).click();
  await expect(tree.locator(".academicTreeSelect").filter({ hasText: "Fakülte 0" })).toContainText("2 sorun");
  await tree.locator(".academicTreeSelect").filter({ hasText: "Fakülte 0" }).click();
  await workbench.getByRole("button", { name: "Haber", exact: true }).click();
  await workbench.locator(".scopedSourceEditor select").first().selectOption("problem-faculty");
  await expect(workbench.locator(".academicSourceProblem")).toContainText("ayrıştıramadı");
  await expect(workbench.locator(".academicSourceProblem")).toContainText("Son sağlık kontrolü:");
  await tree.getByRole("button", { name: /Mühendislik Fakültesi.*Kaynak ekle/ }).click();
  await expect(tree.locator(".academicTreeSelect")).toHaveCount(122);
  await tree.locator(".academicTreeSelect").filter({ hasText: /^Bölüm 0/ }).click();
  await workbench.getByRole("button", { name: "Haber", exact: true }).click();
  await expect(workbench.locator(".academicSourceProblem")).toContainText("ayrıştıramadı");
  await tree.getByRole("button", { name: /Bilgisayar Mühendisliği.*Kaynak ekle/ }).click();
  const editor = workbench.locator(".scopedSourceEditor");
  const fields = { itemSelector: ".row", titleSelector: ".title", linkSelector: "a.details", dateSelector: "time", eventDateSelector: ".event-date", contentSelector: ".body" };

  for (const scope of ["department", "faculty", "university"]) {
  if (scope === "faculty") await tree.getByRole("button", { name: /Mühendislik Fakültesi.*Kaynak ekle/ }).click();
  if (scope === "university") await tree.getByRole("button", { name: /İkinci Üniversitesi.*Kaynak ekle/ }).click();
  for (const [type, label] of [["announcement", "Duyuru"], ["news", "Haber"], ["event", "Etkinlik"]]) {
    await editor.getByRole("button", { name: label, exact: true }).click();
    await editor.getByLabel("Kaynak adı", { exact: true }).fill(`${scope} ${label}`);
    await editor.getByLabel("Çekilen URL", { exact: true }).fill(`https://qa.edu.tr/${scope}/${type}`);
    await editor.getByLabel("Parser", { exact: true }).selectOption("html");
    await editor.getByText("Gelişmiş parser ayarları", { exact: true }).click();
    const writesBeforePaste = writes.length;
    await editor.locator('input[name="itemSelector"]').evaluate((input, text) => {
      const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", text);
      input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }, JSON.stringify(fields));
    for (const [name, value] of Object.entries(fields)) await expect(editor.locator(`input[name="${name}"]`)).toHaveValue(value);
    await expect(editor.getByRole("status")).toContainText("6 seçici");
    expect(writes.length).toBe(writesBeforePaste);
    await editor.locator('input[name="itemSelector"]').evaluate((input) => {
      const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", '{"itemSelector":');
      input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    });
    await expect(editor.getByRole("alert")).toContainText("JSON biçimi geçersiz");
    for (const [name, value] of Object.entries(fields)) await expect(editor.locator(`input[name="${name}"]`)).toHaveValue(value);
    await editor.getByLabel("Öncelik", { exact: true }).fill("75");
    await editor.getByLabel("Kontrol aralığı (dakika)", { exact: true }).fill("60");
    await editor.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(editor).toContainText("Kaynak oluşturuldu");
    expect(writes.filter((write) => write.path === "/admin/announcements/sources").at(-1)?.body).toMatchObject({ scopeType: scope, universityId: scope === "university" ? "u2" : "u1", ...(scope !== "university" ? { facultyId: "f44" } : {}), ...(scope === "department" ? { departmentId: "d74" } : {}), contentType: type, parserConfig: fields, priority: 75, fetchIntervalMinutes: 60 });
    await editor.getByLabel("Çalışma durumu").selectOption("active");
    await editor.getByLabel("Parser", { exact: true }).selectOption("rss");
    await editor.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(editor).toContainText("Kaynak ayarları kaydedildi");
    const update = writes.filter((write) => write.method === "PUT").at(-1)!;
    expect(update.body).toMatchObject({ expectedSourceDefinitionVersion: "v1", expectedUpdatedAt: now, expectedTrustStatus: "quarantined", status: "active", parser: "rss" });
    if (scope === "department" && type === "announcement") {
      await editor.locator('input[name="itemSelector"]').evaluate((input, text) => {
        const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", text);
        input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
      }, JSON.stringify({ ...fields, titleSelector: ".changed-title" }));
      await expect(editor.getByRole("button", { name: "Test Et / Önizle", exact: true })).toBeDisabled();
      await editor.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(editor.getByRole("button", { name: "Test Et / Önizle", exact: true })).toBeEnabled();
      expect(writes.filter((write) => write.method === "PUT").at(-1)?.body.parserConfig.titleSelector).toBe(".changed-title");
    }
    await editor.getByRole("button", { name: "Test Et / Önizle", exact: true }).click();
    await expect(editor.getByText("Test içeriği", { exact: true })).toBeVisible();
    if (scope === "department" && type === "announcement") {
      // Re-testing hides the previous result while the real request is pending.
      previewGate = new Promise<void>((resolve) => { releasePreview = resolve; });
      nextPreviewError = "OUTBOUND_REQUEST_TIMEOUT";
      await editor.getByRole("button", { name: "Test Et / Önizle", exact: true }).click();
      await expect(editor.getByRole("button", { name: "Test ediliyor…", exact: true })).toBeDisabled();
      await expect(editor.getByRole("status").filter({ hasText: "Kaynak test ediliyor…" })).toContainText("Üniversitenin sayfasından yanıt bekleniyor");
      await expect(editor.locator(".sourcePreview")).toHaveCount(0);
      releasePreview!(); previewGate = undefined;
      await expect(editor.locator(".sourcePreview")).toContainText("0/0 içerik kabul edildi");
      await expect(editor.getByRole("button", { name: "Test Et / Önizle", exact: true })).toBeEnabled();
      await expect(editor.getByText("Test içeriği", { exact: true })).toHaveCount(0);
      // A new draft invalidates that result; a rejected save must not bypass the save gate.
      await editor.getByLabel("Kaynak adı", { exact: true }).fill("Önizlemeden sonra düzenlenen kaynak");
      await expect(editor.locator(".sourcePreview")).toHaveCount(0);
      rejectNextSave = true;
      await editor.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(editor.getByRole("alert")).toContainText("401 Invalid bearer token.");
      await expect(editor.getByRole("button", { name: "Test Et / Önizle", exact: true })).toBeDisabled();
      await expect(editor).toContainText("Önizlemeden önce değişiklikleri kaydedin.");
      await editor.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(editor.getByRole("button", { name: "Test Et / Önizle", exact: true })).toBeEnabled();
      await expect(editor.locator(".sourcePreview")).toHaveCount(0);
      await editor.getByRole("button", { name: "Test Et / Önizle", exact: true }).click();
      await expect(editor.getByText("Test içeriği", { exact: true })).toBeVisible();
    }
    await editor.getByRole("button", { name: "Onayla ve Devreye Al", exact: true }).click();
    await expect(editor).toContainText("Kaynak onay kontrolü tamamlandı");
    await editor.getByRole("button", { name: "İçerikleri Çek", exact: true }).click();
    await expect(editor).toContainText("3 içerik");
  }
  }

  // Cancelling navigation preserves the current unsaved draft.
  await tree.getByRole("button", { name: /Mühendislik Fakültesi.*3 sorun/ }).click();
  await editor.getByRole("button", { name: "Etkinlik", exact: true }).click();
  await editor.getByLabel("Kaynak adı", { exact: true }).fill("Kaydedilmemiş taslak");
  page.once("dialog", (dialog) => dialog.dismiss());
  await editor.getByRole("button", { name: "Duyuru", exact: true }).click();
  await expect(editor.getByLabel("Kaynak adı", { exact: true })).toHaveValue("Kaydedilmemiş taslak");
  page.once("dialog", (dialog) => dialog.dismiss());
  await tree.getByRole("button", { name: /Bilgisayar Mühendisliği/ }).click();
  await expect(workbench.locator(".academicSelectionHeader h3")).toHaveText("Mühendislik Fakültesi");

  // University parser editor retains its existing API contract.
  page.once("dialog", (dialog) => dialog.accept());
  await tree.getByRole("button", { name: /Örnek Üniversitesi.*1 sorun/ }).click();
  await workbench.getByRole("button", { name: "Haber", exact: true }).click();
  await expect(workbench.locator('[data-source-type="news"]')).toContainText("ayrıştıramadı");
  for (const [type, label] of [["announcement", "Duyuru"], ["news", "Haber"], ["event", "Etkinlik"], ["academic_calendar", "Akademik Takvim"]]) {
  await workbench.getByRole("button", { name: label, exact: true }).click();
  const universityCard = workbench.locator(`[data-source-type="${type}"]`);
  await universityCard.getByLabel(`${label} çekilen URL`).fill(`https://qa.edu.tr/university/${type}`);
  await universityCard.getByLabel(`${label} parser`, { exact: true }).selectOption("html");
  await universityCard.locator('input[name="itemSelector"]').evaluate((input, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", text);
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, JSON.stringify(fields));
  for (const [name, value] of Object.entries(fields)) await expect(universityCard.locator(`input[name="${name}"]`)).toHaveValue(value);
  await universityCard.getByLabel(`${label} çalışma durumu`).selectOption("active");
  await universityCard.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect.poll(() => writes.some((write) => write.path === `/admin/announcements/source-profiles/u1/${type}`)).toBe(true);
  expect(writes.find((write) => write.path === `/admin/announcements/source-profiles/u1/${type}`)?.body).toMatchObject({ sourceUrl: `https://qa.edu.tr/university/${type}`, parser: "html", parserConfig: fields, status: "active" });
  }

  mkdirSync("artifacts/admin-academic-tree", { recursive: true });
  await workbench.screenshot({ path: "artifacts/admin-academic-tree/desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workbench).toBeVisible();
  expect(await workbench.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (const [type, label] of [["announcement", "Duyuru"], ["news", "Haber"], ["event", "Etkinlik"], ["academic_calendar", "Akademik Takvim"]]) {
    await workbench.getByRole("button", { name: label, exact: true }).click();
    await expect(workbench.locator(`[data-source-type="${type}"] input[name=sourceUrl]`)).toBeVisible();
    expect(await workbench.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await tree.getByRole("button", { name: /Bilgisayar Mühendisliği/ }).click();
  await expect(editor.getByLabel("Kaynak adı", { exact: true })).toBeVisible();
  await workbench.screenshot({ path: "artifacts/admin-academic-tree/mobile.png" });
  // A successful mutation followed by a failed refresh must not claim a refreshed result.
  await editor.getByLabel("Kaynak adı", { exact: true }).fill("Yenileme hata testi");
  failNextSourcesRead = true;
  await editor.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("yenilenemedi");
  await expect(editor).not.toContainText("Kaynak ayarları kaydedildi");
  await workbench.getByRole("button", { name: "Kaynakları yenile", exact: true }).click();
  await expect(editor.getByLabel("Kaynak adı", { exact: true })).toHaveValue("Yenileme hata testi");

  // Deep links select the actual academic unit and exact source, including legacy parent metadata.
  sources = sources.map((source) => source.id === "problem-department" ? { ...source, ownerFacultyId: undefined } : source);
  for (const [id, unitName, treeCount] of [["problem-university", "Örnek Üniversitesi", 47], ["problem-faculty", "Fakülte 0", 47], ["problem-department", "Bölüm 0", 122]] as const) {
    await page.goto(`${base}#/sources?fix=source&universityId=u1&sourceId=${id}&contentType=news`);
    await expect(workbench.locator(".academicSelectionHeader h3")).toHaveText(unitName);
    await expect(tree.locator(".academicTreeSelect")).toHaveCount(treeCount);
    await expect(editor.locator("select").first()).toHaveValue(id);
    await expect.poll(() => tree.locator(".academicTreeRow.selected").evaluate((row) => {
      const bounds = row.closest(".academicTreeScroll")!.getBoundingClientRect();
      const selected = row.getBoundingClientRect();
      return selected.top >= bounds.top - 1 && selected.bottom <= bounds.bottom + 1;
    })).toBe(true);
    await expect(editor.getByRole("button", { name: "Haber", exact: true })).toHaveAttribute("aria-pressed", "true");
    await editor.getByLabel("Kaynak adı", { exact: true }).fill(`${unitName} düzeltilmiş`);
    await editor.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(editor).toContainText("Kaynak ayarları kaydedildi");
    expect(writes.filter((write) => write.method === "PUT").at(-1)?.path).toBe(`/admin/announcements/sources/${id}`);
  }
  await page.goto(`${base}#/sources?fix=source&universityId=u1&sourceId=missing&contentType=news`);
  await expect(workbench.getByRole("alert")).toContainText("kaynak bulunamadı");
  await expect(workbench.locator("input[name=sourceUrl]")).toHaveCount(0);
  await page.goto(`${base}#/sources`);
  const legacyAlert = page.locator(".sourceHealthAlert").filter({ hasText: "Legacy duyuru kaynağı" });
  await legacyAlert.evaluate((row) => {
    for (let parent = row.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
  });
  await expect(legacyAlert.getByRole("button", { name: "Düzelt", exact: true })).toBeEnabled();
  await legacyAlert.getByRole("button", { name: "Düzelt", exact: true }).click();
  await expect(page).toHaveURL(/sourceId=legacy-source.*contentType=announcement/);
  await expect(editor.locator("select").first()).toHaveValue("legacy-source");
  await expect(editor.getByLabel("Kaynak adı", { exact: true })).toHaveValue("Legacy duyuru kaynağı");
  expect(pageErrors).toEqual([]);
});
