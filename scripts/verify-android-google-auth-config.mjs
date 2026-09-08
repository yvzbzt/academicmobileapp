#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Release workflows install the native project independently of the repository root.
const ts = createRequire(new URL("../apps/mobile-native/package.json", import.meta.url))("typescript");

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
  const googleRuntimeSource = input.googleRuntimeSource ?? appSource;
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

  if (input.defaultWebClientId !== undefined
    ? input.defaultWebClientId !== contract.webOauthClientId
    : !appSource.includes(`const DEFAULT_GOOGLE_WEB_CLIENT_ID = "${contract.webOauthClientId}";`)) {
    errors.push("App.tsx production Web OAuth fallback does not match the release identity");
  }
  if (!googleRuntimeSource.includes("webClientId: GOOGLE_WEB_CLIENT_ID")) {
    errors.push("the connected Google runtime does not pass the Web OAuth client to GoogleSignin.configure");
  }
  if (
    [appSource, googleRuntimeSource].some((source) => (
      source.includes("DEFAULT_GOOGLE_ANDROID_CLIENT_ID")
      || source.includes("EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID")
    ))
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

/** Follow used runtime imports from the supplied entry; an orphan config cannot pass release checks. */
export function readConnectedGoogleAuthSources(entryPath) {
  const modules = new Map();
  function readModule(path) {
    if (modules.has(path)) return modules.get(path);
    const source = readFileSync(path, "utf8");
    const syntax = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
      path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const record = { source, imports: new Map(), configure: false, configureUsesWebClientId: false,
      defaultWebClientId: null, exportsWebClientId: false };
    modules.set(path, record);
    const used = new Set();
    function usesWebClientId(expression) {
      if (ts.isParenthesizedExpression(expression)) return usesWebClientId(expression.expression);
      if (ts.isConditionalExpression(expression)) {
        return expression.condition.getText(syntax) === "GOOGLE_WEB_CLIENT_ID" && usesWebClientId(expression.whenTrue);
      }
      return ts.isObjectLiteralExpression(expression) && expression.properties.some((property) => (
        ts.isSpreadAssignment(property) ? usesWebClientId(property.expression)
          : ts.isPropertyAssignment(property) && property.name.getText(syntax) === "webClientId"
            && property.initializer.getText(syntax) === "GOOGLE_WEB_CLIENT_ID"
      ));
    }
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
      if (ts.isIdentifier(node)) used.add(node.text);
      if (ts.isCallExpression(node) && node.expression.getText(syntax) === "GoogleSignin.configure") {
        record.configure = true;
        const configuration = node.arguments[0];
        record.configureUsesWebClientId = Boolean(configuration && usesWebClientId(configuration));
      }
      if (ts.isVariableDeclaration(node) && node.name.getText(syntax) === "DEFAULT_GOOGLE_WEB_CLIENT_ID"
        && node.initializer && ts.isStringLiteral(node.initializer)) {
        record.defaultWebClientId = node.initializer.text;
      }
      if (ts.isVariableStatement(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        record.exportsWebClientId ||= node.declarationList.declarations.some((declaration) =>
          declaration.name.getText(syntax) === "GOOGLE_WEB_CLIENT_ID");
      }
      ts.forEachChild(node, visit);
    }
    visit(syntax);
    function resolveModule(specifier) {
      const base = resolve(dirname(path), specifier);
      const importedPath = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`]
        .find((candidate) => /\.[cm]?[jt]sx?$/u.test(candidate) && existsSync(candidate));
      if (!importedPath) throw new Error("a connected mobile runtime import is missing");
      return importedPath;
    }
    for (const statement of syntax.statements) {
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier
        && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith(".")) {
        readModule(resolveModule(statement.moduleSpecifier.text));
        continue;
      }
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!specifier.startsWith(".") || !clause || clause.isTypeOnly) continue;
      const bindings = [
        ...(clause.name ? [{ name: clause.name }] : []),
        ...(clause.namedBindings && ts.isNamedImports(clause.namedBindings)
          ? clause.namedBindings.elements.filter((binding) => !binding.isTypeOnly)
          : clause.namedBindings ? [clause.namedBindings] : [])
      ].filter((binding) => used.has(binding.name.text));
      if (bindings.length === 0) continue;
      const importedPath = resolveModule(specifier);
      for (const binding of bindings) record.imports.set(binding.name.text, importedPath);
      readModule(importedPath);
    }
    return record;
  }
  readModule(resolve(entryPath));
  const runtimes = [...modules.values()].filter((record) => record.configure);
  if (runtimes.length !== 1) throw new Error("expected one connected GoogleSignin.configure runtime");
  const runtime = runtimes[0];
  if (!runtime.configureUsesWebClientId) throw new Error("the connected Google runtime does not use the Web OAuth client");
  const config = runtime.imports.has("GOOGLE_WEB_CLIENT_ID")
    ? modules.get(runtime.imports.get("GOOGLE_WEB_CLIENT_ID"))
    : runtime;
  if (config !== runtime && !config.exportsWebClientId) {
    throw new Error("the connected Google provider does not export its Web OAuth client");
  }
  return { appSource: config.source, googleRuntimeSource: runtime.source, defaultWebClientId: config.defaultWebClientId };
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
    ...readConnectedGoogleAuthSources(appSourcePath),
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
