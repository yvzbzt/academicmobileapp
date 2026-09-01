#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GOOGLE_CLIENT_ID_PATTERN = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/iu;
const CERTIFICATE_SHA1_PATTERN = /^(?:[a-f0-9]{2}:){19}[a-f0-9]{2}$/iu;
const CERTIFICATE_SHA256_PATTERN = /^(?:[a-f0-9]{2}:){31}[a-f0-9]{2}$/iu;
const REQUIRED_NATIVE_ROLES = Object.freeze(["upload", "playAppSigning"]);
const RELEVANT_ENV_KEYS = Object.freeze([
  "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
  "EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID"
]);

export function normalizeCertificateHash(value) {
  return typeof value === "string" ? value.replace(/[^a-f0-9]/giu, "").toLowerCase() : "";
}

export function parseDotEnv(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export function readExpoProductionEnvironment(projectRoot, systemEnvironment = process.env) {
  const requireFromProject = createRequire(resolve(projectRoot, "package.json"));
  let parseEnvFiles;
  try {
    ({ parseEnvFiles } = requireFromProject("@expo/env"));
  } catch {
    throw new Error("@expo/env is required to verify the production Expo environment");
  }
  const envFiles = [
    ".env.production.local",
    ".env.local",
    ".env.production",
    ".env"
  ].map((fileName) => resolve(projectRoot, fileName));
  return parseEnvFiles(envFiles, { systemEnv: systemEnvironment }).env;
}

export function validateAndroidGoogleAuthConfiguration(input) {
  const errors = [];
  const contract = input.contract ?? {};
  const appConfig = input.appConfig ?? {};
  const googleServices = input.googleServices ?? {};
  const appSource = typeof input.appSource === "string" ? input.appSource : "";
  const environment = input.environment ?? {};

  if (contract.schemaVersion !== 1) errors.push("release identity schemaVersion must be 1");
  requireNonEmptyString(contract.applicationId, "release identity applicationId", errors);
  requireNonEmptyString(contract.firebaseProjectId, "release identity firebaseProjectId", errors);
  requireNonEmptyString(contract.firebaseAppId, "release identity firebaseAppId", errors);
  if (!GOOGLE_CLIENT_ID_PATTERN.test(contract.webOauthClientId ?? "")) {
    errors.push("release identity webOauthClientId is invalid");
  }

  const nativeClients = contract.androidOauthClients ?? {};
  for (const role of REQUIRED_NATIVE_ROLES) {
    const nativeClient = nativeClients[role] ?? {};
    if (!CERTIFICATE_SHA1_PATTERN.test(nativeClient.certificateSha1 ?? "")) {
      errors.push(`${role} certificateSha1 is invalid`);
    }
    if (!GOOGLE_CLIENT_ID_PATTERN.test(nativeClient.clientId ?? "")) {
      errors.push(`${role} Android OAuth clientId is invalid`);
    }
    if (!CERTIFICATE_SHA256_PATTERN.test(nativeClient.certificateSha256 ?? "")) {
      errors.push(`${role} certificateSha256 is invalid`);
    }
  }
  if (
    normalizeCertificateHash(nativeClients.upload?.certificateSha1)
    && normalizeCertificateHash(nativeClients.upload?.certificateSha1)
      === normalizeCertificateHash(nativeClients.playAppSigning?.certificateSha1)
  ) {
    errors.push("upload and Play App Signing certificates must be different identities");
  }

  if (appConfig.expo?.android?.package !== contract.applicationId) {
    errors.push("app.json Android package does not match the release identity");
  }
  if (appConfig.expo?.android?.googleServicesFile !== "./google-services.json") {
    errors.push("app.json must use ./google-services.json for Android releases");
  }
  if (googleServices.project_info?.project_id !== contract.firebaseProjectId) {
    errors.push("google-services.json Firebase project does not match the release identity");
  }

  const packageClient = Array.isArray(googleServices.client)
    ? googleServices.client.find((client) => (
      client?.client_info?.android_client_info?.package_name === contract.applicationId
      && client?.client_info?.mobilesdk_app_id === contract.firebaseAppId
    ))
    : undefined;
  if (!packageClient) {
    errors.push("google-services.json has no matching production Android Firebase app");
  } else {
    const oauthClients = Array.isArray(packageClient.oauth_client) ? packageClient.oauth_client : [];
    for (const role of REQUIRED_NATIVE_ROLES) {
      const expected = nativeClients[role] ?? {};
      const hasExpectedNativeClient = oauthClients.some((client) => (
        client?.client_type === 1
        && client?.client_id === expected.clientId
        && client?.android_info?.package_name === contract.applicationId
        && normalizeCertificateHash(client?.android_info?.certificate_hash)
          === normalizeCertificateHash(expected.certificateSha1)
      ));
      if (!hasExpectedNativeClient) {
        errors.push(`google-services.json is missing the ${role} package/certificate OAuth registration`);
      }
    }
    if (!oauthClients.some((client) => (
      client?.client_type === 3 && client?.client_id === contract.webOauthClientId
    ))) {
      errors.push("google-services.json is missing the production Web OAuth client");
    }
  }

  if (!appSource.includes(`const DEFAULT_GOOGLE_WEB_CLIENT_ID = "${contract.webOauthClientId}";`)) {
    errors.push("App.tsx production Web OAuth fallback does not match the release identity");
  }
  if (!appSource.includes("webClientId: GOOGLE_WEB_CLIENT_ID")) {
    errors.push("App.tsx does not pass the Web OAuth client to GoogleSignin.configure");
  }
  if (
    appSource.includes("DEFAULT_GOOGLE_ANDROID_CLIENT_ID")
    || appSource.includes("EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID")
  ) {
    errors.push("App.tsx must not treat an Android client ID as runtime configuration proof");
  }

  const effectiveWebClientId = cleanValue(environment.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)
    ?? cleanValue(environment.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID)
    ?? contract.webOauthClientId;
  if (effectiveWebClientId !== contract.webOauthClientId) {
    errors.push("the effective release Web OAuth client override does not match the release identity");
  }

  return errors;
}

function requireNonEmptyString(value, label, errors) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${label} is required`);
}

function cleanValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${label} is missing or invalid JSON`);
  }
}

function optionValue(argumentsList, name, fallback) {
  const index = argumentsList.indexOf(name);
  if (index < 0) return fallback;
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return value;
}

export function runCli(argumentsList = process.argv.slice(2), processEnvironment = process.env) {
  const contractPath = resolve(optionValue(
    argumentsList,
    "--contract",
    "apps/mobile-native/android-release-identity.json"
  ));
  const appConfigPath = resolve(optionValue(argumentsList, "--app-config", "apps/mobile-native/app.json"));
  const googleServicesPath = resolve(optionValue(
    argumentsList,
    "--google-services",
    "apps/mobile-native/google-services.json"
  ));
  const appSourcePath = resolve(optionValue(argumentsList, "--app-source", "apps/mobile-native/App.tsx"));
  const requestedEnvPath = optionValue(argumentsList, "--env-file", undefined);
  const envDirectory = resolve(optionValue(argumentsList, "--env-dir", "apps/mobile-native"));
  const envPath = requestedEnvPath ? resolve(requestedEnvPath) : undefined;

  const fileEnvironment = envPath
    ? (existsSync(envPath) ? parseDotEnv(readFileSync(envPath, "utf8")) : {})
    : readExpoProductionEnvironment(envDirectory, processEnvironment);
  const environment = { ...fileEnvironment };
  for (const key of RELEVANT_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(processEnvironment, key)) {
      environment[key] = processEnvironment[key];
    }
  }

  const errors = validateAndroidGoogleAuthConfiguration({
    contract: readJson(contractPath, "Android release identity"),
    appConfig: readJson(appConfigPath, "Expo app config"),
    googleServices: readJson(googleServicesPath, "google-services.json"),
    appSource: readFileSync(appSourcePath, "utf8"),
    environment
  });
  if (errors.length > 0) {
    console.error("Android Google authentication release preflight failed:");
    for (const error of errors) console.error(`- ${error}`);
    return 1;
  }

  console.log("Android Google authentication release preflight passed (pinned upload and Play mappings verified in Firebase config).");
  return 0;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const current = resolve(fileURLToPath(import.meta.url));
  const invoked = resolve(process.argv[1]);
  return process.platform === "win32" ? current.toLowerCase() === invoked.toLowerCase() : current === invoked;
}

if (isMainModule()) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Android Google authentication preflight failed");
    process.exitCode = 1;
  }
}
