import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
});

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

function runVerifier(googleServicesPath: string, envPath?: string, envDirectory?: string) {
  const environment = { ...process.env };
  delete environment.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  delete environment.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID;
  const envArguments = envDirectory
    ? ["--env-dir", envDirectory]
    : ["--env-file", envPath as string];
  return spawnSync(process.execPath, [
    verifierPath,
    "--contract", contractPath,
    "--app-config", appConfigPath,
    "--google-services", googleServicesPath,
    "--app-source", appSourcePath,
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
