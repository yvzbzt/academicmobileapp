import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(".");
const verifierPath = resolve("scripts/verify-android-google-auth-config.mjs");
const contractPath = resolve("apps/mobile-native/android-release-identity.json");
const appConfigPath = resolve("apps/mobile-native/app.json");
const appSourcePath = resolve("apps/mobile-native/App.tsx");
const contract = JSON.parse(readFileSync(contractPath, "utf8")) as ReleaseIdentity;
const temporaryDirectories: string[] = [];

describe("Android Google authentication release preflight", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts the pinned upload, Play App Signing, and Web OAuth identities", () => {
    const fixture = createFixture();
    const result = runVerifier(fixture.googleServicesPath, fixture.envPath);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("preflight passed");
  });

  it("fails closed when a stale Firebase config omits the Play App Signing identity", () => {
    const fixture = createFixture({ omitRole: "playAppSigning" });
    const result = runVerifier(fixture.googleServicesPath, fixture.envPath);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("playAppSigning package/certificate OAuth registration");
    expect(result.stderr).not.toContain(contract.androidOauthClients.playAppSigning.clientId);
  });

  it("rejects a release Web OAuth override with the wrong token audience", () => {
    const fixture = createFixture({ webOverride: "000000000000-invalid.apps.googleusercontent.com" });
    const result = runVerifier(fixture.googleServicesPath, fixture.envPath);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("effective release Web OAuth client override");
    expect(result.stderr).not.toContain(contract.webOauthClientId);
  });

  it("uses Expo production dotenv precedence when checking the embedded token audience", () => {
    const fixture = createFixture({ insideMobileProject: true });
    writeFileSync(
      join(fixture.directory, ".env.production.local"),
      "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=000000000000-invalid.apps.googleusercontent.com\n",
      "utf8"
    );
    const result = runVerifier(fixture.googleServicesPath, undefined, fixture.directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("effective release Web OAuth client override");
  });

  it("keeps --app-source compatible with a standalone monolithic source fixture", () => {
    const fixture = createFixture();
    const standalone = join(fixture.directory, "App.tsx");
    writeFileSync(standalone, [
      `const DEFAULT_GOOGLE_WEB_CLIENT_ID = "${contract.webOauthClientId}";`,
      "const GOOGLE_WEB_CLIENT_ID = DEFAULT_GOOGLE_WEB_CLIENT_ID;",
      "GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });"
    ].join("\n"), "utf8");
    expect(runVerifier(fixture.googleServicesPath, fixture.envPath, undefined, standalone).status).toBe(0);
  });

  it("follows the connected entry, runtime and provider module for Google release configuration", () => {
    const fixture = createModularSourceFixture();
    expect(runVerifier(fixture.googleServicesPath, fixture.envPath, undefined, fixture.entryPath).status).toBe(0);
  });

  it("follows the stable Expo default re-export entry", () => {
    const fixture = createModularSourceFixture();
    const stableEntry = join(fixture.directory, "StableApp.tsx");
    writeFileSync(stableEntry, 'export { default } from "./App";', "utf8");
    expect(runVerifier(fixture.googleServicesPath, fixture.envPath, undefined, stableEntry).status).toBe(0);
  });

  it("runs when TypeScript is installed only in the native project dependency tree", () => {
    const fixture = createModularSourceFixture();
    const isolatedScripts = join(fixture.directory, "scripts");
    const isolatedMobile = join(fixture.directory, "apps", "mobile-native");
    const isolatedTypescript = join(isolatedMobile, "node_modules", "typescript");
    mkdirSync(isolatedScripts, { recursive: true });
    mkdirSync(isolatedTypescript, { recursive: true });
    writeFileSync(join(isolatedMobile, "package.json"), '{"private":true}', "utf8");
    // Load the installed compiler without creating any root-level node_modules in this fixture.
    writeFileSync(join(isolatedTypescript, "index.js"),
      `module.exports = require(${JSON.stringify(resolve("apps/mobile-native/node_modules/typescript"))});`, "utf8");
    const isolatedVerifier = join(isolatedScripts, "verify-android-google-auth-config.mjs");
    writeFileSync(isolatedVerifier, readFileSync(verifierPath, "utf8"), "utf8");
    const result = runVerifier(fixture.googleServicesPath, fixture.envPath, undefined, fixture.entryPath, isolatedVerifier);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("preflight passed");
  });

  it("rejects a configured runtime that is imported but disconnected from the entry", () => {
    const fixture = createModularSourceFixture();
    writeFileSync(fixture.entryPath, 'import { start } from "./runtime";\nexport default function App() { return null; }', "utf8");
    const result = runVerifier(fixture.googleServicesPath, fixture.envPath, undefined, fixture.entryPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected one connected GoogleSignin.configure runtime");
  });

  it("rejects a missing or unexported provider behind an otherwise connected runtime", () => {
    const fixture = createModularSourceFixture();
    writeFileSync(fixture.providerPath, [
      `const DEFAULT_GOOGLE_WEB_CLIENT_ID = "${contract.webOauthClientId}";`,
      "const GOOGLE_WEB_CLIENT_ID = DEFAULT_GOOGLE_WEB_CLIENT_ID;"
    ].join("\n"), "utf8");
    const result = runVerifier(fixture.googleServicesPath, fixture.envPath, undefined, fixture.entryPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not export its Web OAuth client");
  });

  it("does not accept a comment containing a disconnected Google configure call", () => {
    const fixture = createModularSourceFixture();
    writeFileSync(fixture.entryPath, "// GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });\nexport default function App() { return null; }", "utf8");
    const result = runVerifier(fixture.googleServicesPath, fixture.envPath, undefined, fixture.entryPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected one connected GoogleSignin.configure runtime");
  });

  it("rejects a runtime argument that differs from a correct-looking configuration comment", () => {
    const fixture = createModularSourceFixture();
    writeFileSync(join(fixture.directory, "runtime.ts"), [
      'import { GOOGLE_WEB_CLIENT_ID } from "./provider";',
      "// webClientId: GOOGLE_WEB_CLIENT_ID",
      'export function start() { GoogleSignin.configure({ webClientId: "wrong-client" }); }'
    ].join("\n"), "utf8");
    const result = runVerifier(fixture.googleServicesPath, fixture.envPath, undefined, fixture.entryPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not use the Web OAuth client");
  });
});

function createModularSourceFixture() {
  const fixture = createFixture();
  const entryPath = join(fixture.directory, "App.tsx");
  const providerPath = join(fixture.directory, "provider.ts");
  writeFileSync(entryPath, 'import { start } from "./runtime";\nexport default function App() { start(); return null; }', "utf8");
  writeFileSync(join(fixture.directory, "runtime.ts"), [
    'import { GOOGLE_WEB_CLIENT_ID } from "./provider";',
    "export function start() { GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID }); }"
  ].join("\n"), "utf8");
  writeFileSync(providerPath, [
    `export const DEFAULT_GOOGLE_WEB_CLIENT_ID = "${contract.webOauthClientId}";`,
    "export const GOOGLE_WEB_CLIENT_ID = DEFAULT_GOOGLE_WEB_CLIENT_ID;"
  ].join("\n"), "utf8");
  return { ...fixture, entryPath, providerPath };
}

function createFixture(options: {
  omitRole?: keyof ReleaseIdentity["androidOauthClients"];
  webOverride?: string;
  insideMobileProject?: boolean;
} = {}) {
  const temporaryRoot = options.insideMobileProject ? resolve("apps/mobile-native") : tmpdir();
  const directory = mkdtempSync(join(temporaryRoot, ".akademik-google-auth-release-"));
  temporaryDirectories.push(directory);
  const googleServicesPath = join(directory, "google-services.json");
  const envPath = join(directory, ".env");
  const nativeOauthClients = Object.entries(contract.androidOauthClients)
    .filter(([role]) => role !== options.omitRole)
    .map(([, identity]) => ({
      client_id: identity.clientId,
      client_type: 1,
      android_info: {
        package_name: contract.applicationId,
        certificate_hash: identity.certificateSha1.replaceAll(":", "").toLowerCase()
      }
    }));
  writeFileSync(googleServicesPath, JSON.stringify({
    project_info: { project_id: contract.firebaseProjectId },
    client: [{
      client_info: {
        mobilesdk_app_id: contract.firebaseAppId,
        android_client_info: { package_name: contract.applicationId }
      },
      oauth_client: [
        ...nativeOauthClients,
        { client_id: contract.webOauthClientId, client_type: 3 }
      ]
    }]
  }), "utf8");
  writeFileSync(
    envPath,
    `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${options.webOverride ?? contract.webOauthClientId}\n`,
    "utf8"
  );
  return { directory, googleServicesPath, envPath };
}

function runVerifier(googleServicesPath: string, envPath?: string, envDirectory?: string, sourcePath = appSourcePath, verifier = verifierPath) {
  const environment = { ...process.env };
  delete environment.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  delete environment.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID;
  const envArguments = envDirectory
    ? ["--env-dir", envDirectory]
    : ["--env-file", envPath as string];
  return spawnSync(process.execPath, [
    verifier,
    "--contract", contractPath,
    "--app-config", appConfigPath,
    "--google-services", googleServicesPath,
    "--app-source", sourcePath,
    ...envArguments
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: environment
  });
}

type NativeIdentity = {
  certificateSha1: string;
  certificateSha256: string;
  clientId: string;
};

type ReleaseIdentity = {
  applicationId: string;
  firebaseProjectId: string;
  firebaseAppId: string;
  webOauthClientId: string;
  androidOauthClients: {
    upload: NativeIdentity;
    playAppSigning: NativeIdentity;
  };
};
