import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

function readRepositoryFile(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

const historicalReports = [
  "docs/19-mobile-native-current-state-ui-ux-audit.md",
  "docs/20-mobile-native-in-app-user-activity-report.md",
];

describe("Phase 1-12 documentation consistency", () => {
  it.each(historicalReports)("marks %s as a superseded cbd0067 baseline", (relativePath) => {
    const source = readRepositoryFile(relativePath);

    expect(source.startsWith("> [!WARNING]\n> **HISTORICAL BASELINE — SUPERSEDED.**")).toBe(true);
    expect(source).toContain("preserved");
    expect(source).toContain("`cbd0067`");
    expect(source).toContain("does **not** describe the current application");
    expect(source).toContain("Phases 1–11 are implemented");
    expect(source).toContain("[Phase 12 final reconciliation](./mobile-native-redesign/phases/phase-12-final-reconciliation.md)");
    expect(source).toContain("[redesign README](./mobile-native-redesign/README.md)");
    expect(source).toContain("[test matrix](./mobile-native-redesign/TEST_MATRIX.md)");
  });

  it("labels reports 19 and 20 as historical rather than current architecture", () => {
    const readme = readRepositoryFile("docs/mobile-native-redesign/README.md");
    const historicalSection = readme.slice(
      readme.indexOf("## Historical baseline reports"),
      readme.indexOf("## Current Phase 1–12 reconciliation boundary"),
    );

    expect(historicalSection).toContain("Historical pre-redesign native UI/UX audit at `cbd0067`");
    expect(historicalSection).toContain("Historical pre-redesign in-app activity report at `cbd0067`");
    expect(historicalSection).toContain("do not describe the current application");
    expect(historicalSection).not.toContain("Current native UI/UX audit");
    expect(historicalSection).not.toContain("Current in-app activity report");
  });

  it("defines exactly the four current Turkish primary tabs and records Phases 1-12 complete", () => {
    const readme = readRepositoryFile("docs/mobile-native-redesign/README.md");
    const architecture = readme.slice(
      readme.indexOf("## Target information architecture"),
      readme.indexOf("## Phase status"),
    );
    const phaseStatus = readme.slice(
      readme.indexOf("## Phase status"),
      readme.indexOf("## Permanent documents"),
    );

    expect(architecture.match(/^\d\. \*\*/gm)).toHaveLength(4);
    expect(architecture).toContain("1. **Ana Sayfa**");
    expect(architecture).toContain("2. **Duyurular**");
    expect(architecture).toContain("3. **Takvim**");
    expect(architecture).toContain("4. **Profil**");
    expect(architecture).not.toMatch(/^5\. /m);

    for (const phase of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]) {
      expect(phaseStatus).toMatch(new RegExp(`\\| ${phase} \\|[^\\n]+\\| (?:Complete|Implemented)`));
    }
  });

  it("records the Package 3 command as 74 runtime cases rather than 60 tests", () => {
    const matrix = readRepositoryFile("docs/mobile-native-redesign/TEST_MATRIX.md");

    expect(matrix).toContain("4 suites / 60 static declarations / 74 runtime cases / 0 snapshots");
    expect(matrix).toContain("Jest duration 27.167 s");
    expect(matrix).not.toMatch(/4 suites \/ 60 tests:/u);
    expect(matrix).toContain("fd54f63669f0ef18230dfe0e9df64281310ac5a7");
  });

  it("does not present removed Firestore persistence or optional queue infrastructure as active requirements", () => {
    const readme = readRepositoryFile("docs/mobile-native-redesign/README.md");
    const deployment = readRepositoryFile("docs/15-firebase-deploy.md");
    const ingestion = readRepositoryFile("docs/16-announcement-ingestion-report.md");

    expect(readme).toContain("MongoDB remains the only runtime database");
    expect(readme).toContain("Firestore database persistence is historical evidence only");
    expect(deployment).toContain("Firestore database persistence is not supported by the API");
    expect(deployment).toContain("Redis/BullMQ and a Mongo replica set are not required");
    expect(deployment).not.toContain("`QUEUE_MODE=bullmq`");
    expect(deployment).not.toContain("`RATE_LIMIT_STORE=redis`");
    expect(ingestion).toContain("historical Firestore wording below is not current architecture");
  });

  it("records fixed generation, reset, timing, SMTP, recent-auth, and TLS behavior as current", () => {
    const security = readRepositoryFile("docs/04-security-hardening.md");
    const deployment = readRepositoryFile("docs/15-firebase-deploy.md");
    const ingestion = readRepositoryFile("docs/16-announcement-ingestion-report.md");
    const readme = readRepositoryFile("docs/mobile-native-redesign/README.md");
    const knownIssues = readRepositoryFile("docs/mobile-native-redesign/KNOWN_ISSUES.md");
    const screenInventory = readRepositoryFile("docs/mobile-native-redesign/SCREEN_INVENTORY.md");
    const phaseOneReconciliation = readRepositoryFile("docs/mobile-native-redesign/phases/phase-01-06-reconciliation.md");
    const devops = readRepositoryFile("docs/08-devops-deployment.md");
    const finalReconciliation = readRepositoryFile("docs/mobile-native-redesign/phases/phase-12-final-reconciliation.md");

    expect(security).toContain("Credential generations are enforced across access, refresh, and recovery material");
    expect(security).toContain("one standalone-Mongo compare-and-set");
    expect(security).toContain("350 ms production response floor");
    expect(security).toContain("bounded asynchronous SMTP delivery");
    expect(security).toContain("single-use, purpose-specific recent-authentication proofs");
    expect(security).toContain("Historical checkpoint, superseded");
    expect(security).not.toContain("Consequently the known request-latency channel and reset partial-state risk below remain open");

    expect(deployment).toContain("eligible SMTP delivery is scheduled outside the public response");
    expect(deployment).toContain("A consumed proof is never restored");
    expect(deployment).toContain("physical refresh/recovery-record cleanup remains best effort");
    expect(deployment).not.toContain("Current application latency is not equalized");
    expect(deployment).not.toContain("The confirmation implementation does not wrap that full sequence");
    expect(deployment).not.toContain("refresh-session revocation, and remaining-record invalidation all completed");

    for (const currentSummary of [readme, knownIssues, screenInventory]) {
      expect(currentSummary).toContain("random identifier");
      expect(currentSummary).toMatch(/purpose|purpose-specific/u);
      expect(currentSummary).toMatch(/atomically consume|atomically consumed/u);
      expect(currentSummary).toMatch(/fresh reauthentication|fresh purpose-specific proof/u);
    }
    expect(phaseOneReconciliation).toContain("final blocker remediation closes recent-authentication replay");
    expect(devops).toContain("replica health only when a replica topology is independently configured");
    expect(devops).toContain("Optional ping and queue latency when Redis-backed modes are configured");
    expect(devops).toContain("Production startup rejects missing, short, whitespace-only, checked-in placeholder, or reused access-token/calendar-feed signing values");
    expect(finalReconciliation).toContain("Android implementation");
    expect(finalReconciliation).toContain("Android publication");
    expect(finalReconciliation).toContain("iOS implementation");
    expect(finalReconciliation).toContain("live-provider");
    expect(finalReconciliation).toContain("Phase 13 was not started");

    expect(ingestion).toContain("there is no supported configuration that disables certificate verification");
    expect(ingestion).not.toContain(["ANNOUNCEMENT", "ALLOW", "INVALID", "TLS"].join("_"));
    expect(ingestion).not.toContain("decision to permit invalid-TLS fallback");
  });
});
