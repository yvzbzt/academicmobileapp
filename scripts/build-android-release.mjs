#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "..");
const mobileRoot = join(repoRoot, "apps", "mobile-native");
const androidRoot = join(mobileRoot, "android");
const validator = join(scriptDirectory, "verify-android-google-auth-config.mjs");
const contract = join(mobileRoot, "android-release-identity.json");
const appConfig = join(mobileRoot, "app.json");
const appSource = join(mobileRoot, "App.tsx");
const sourceGoogleServices = join(mobileRoot, "google-services.json");
const generatedGoogleServices = join(androidRoot, "app", "google-services.json");
const generatedBuildGradle = join(androidRoot, "app", "build.gradle");
const generatedSettingsGradle = join(androidRoot, "settings.gradle");
const requiredSigningVariables = Object.freeze([
  "AKADEMIK_UPLOAD_STORE_FILE",
  "AKADEMIK_UPLOAD_STORE_PASSWORD",
  "AKADEMIK_UPLOAD_KEY_ALIAS",
  "AKADEMIK_UPLOAD_KEY_PASSWORD"
]);

const cliArguments = process.argv.slice(2);
const helpRequested = cliArguments.includes("--help") || cliArguments.includes("-h");
const dryRun = cliArguments.includes("--dry-run");
const positionalArguments = cliArguments.filter((argument) => !["--help", "-h", "--dry-run"].includes(argument));
const unknownOptions = cliArguments.filter((argument) => argument.startsWith("-") && !["--help", "-h", "--dry-run"].includes(argument));
const [releaseMode = "", artifactFormat = ""] = positionalArguments;
if (helpRequested) {
  printUsage();
  process.exit(0);
}
if (unknownOptions.length > 0 || positionalArguments.length !== 2) {
  fail("expected exactly <signed|unsigned> <apk|aab|both> and optional --dry-run", 2);
}
if (!new Set(["signed", "unsigned"]).has(releaseMode)) {
  fail("release mode must be signed or unsigned", 2);
}
if (!new Set(["apk", "aab", "both"]).has(artifactFormat)) {
  fail("artifact format must be apk, aab, or both", 2);
}
const releaseEnvironment = {
  ...process.env,
  NODE_ENV: "production",
  BABEL_ENV: "production",
  NODE_BINARY: process.execPath,
  AKADEMIK_RELEASE_MODE: releaseMode
};
if (process.platform === "win32") {
  releaseEnvironment.JAVA_HOME = resolveWindowsJavaHome();
}
if (releaseMode === "signed") {
  const missing = requiredSigningVariables.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) fail(`signed release inputs are missing: ${missing.join(", ")}`);
  if (process.env.AKADEMIK_UPLOAD_KEY_ALIAS?.toLowerCase() === "androiddebugkey") {
    fail("the Android debug key alias cannot be used for a release");
  }
  const requestedStoreFile = process.env.AKADEMIK_UPLOAD_STORE_FILE.trim();
  if (!isAbsolute(requestedStoreFile)) fail("AKADEMIK_UPLOAD_STORE_FILE must be an absolute path");
  const absoluteStoreFile = resolve(requestedStoreFile);
  if (!existsSync(absoluteStoreFile)) fail("the Android upload keystore does not exist");
  releaseEnvironment.AKADEMIK_UPLOAD_STORE_FILE = absoluteStoreFile;
}

runNode("source Google authentication preflight", validator, [
  "--contract", contract,
  "--app-config", appConfig,
  "--google-services", sourceGoogleServices,
  "--app-source", appSource,
  "--env-dir", mobileRoot
], repoRoot, releaseEnvironment);

const requireFromMobile = createRequire(join(mobileRoot, "package.json"));
let expoCli;
try {
  const expoPackageJsonPath = requireFromMobile.resolve("expo/package.json");
  const expoPackage = JSON.parse(readFileSync(expoPackageJsonPath, "utf8"));
  const expoBin = typeof expoPackage.bin === "string" ? expoPackage.bin : expoPackage.bin?.expo;
  if (typeof expoBin !== "string" || !expoBin) throw new Error("Expo package has no CLI entry");
  expoCli = resolve(dirname(expoPackageJsonPath), expoBin);
} catch {
  fail("the local Expo CLI is missing; install mobile-native dependencies first");
}
runNode("Expo Android prebuild", expoCli, ["prebuild", "--platform", "android", "--no-install"], mobileRoot, releaseEnvironment);

if (!existsSync(generatedGoogleServices) || !readFileSync(sourceGoogleServices).equals(readFileSync(generatedGoogleServices))) {
  fail("Expo prebuild did not synchronize the pinned google-services.json");
}
const generatedGradle = readFileSync(generatedBuildGradle, "utf8");
for (const marker of [
  "// AKADEMIK_GOOGLE_AUTH_RELEASE_GUARD",
  "// AKADEMIK_GOOGLE_AUTH_RELEASE_GUARD_END",
  "verifyAkademikUploadSigningIdentity(akademikReleaseMode, uploadSigning)",
  "verifyAkademikGoogleServicesLayout(projectDir)",
  "verifyAkademikGoogleAuthRelease()",
  "verifyAkademikReleaseJsBundle(task)",
  "shortenAkademikWindowsAutolinkingPaths(task)"
]) {
  if (!generatedGradle.includes(marker)) fail("generated Android project is missing the current release guard");
}
const generatedSettings = readFileSync(generatedSettingsGradle, "utf8");
for (const marker of [
  "// AKADEMIK_WINDOWS_AUTOLINKING_CONFIG",
  "AKADEMIK_WINDOWS_AUTOLINKING_CONFIG",
  "autolinkLibrariesFromConfigFile"
]) {
  if (!generatedSettings.includes(marker)) {
    fail("generated Android settings are missing the Windows release autolinking guard");
  }
}

runNode("generated Android Google authentication preflight", validator, [
  "--contract", contract,
  "--app-config", appConfig,
  "--google-services", generatedGoogleServices,
  "--app-source", appSource,
  "--env-dir", mobileRoot
], repoRoot, releaseEnvironment);

const gradleTasks = artifactFormat === "apk"
  ? [":app:assembleRelease"]
  : artifactFormat === "aab"
    ? [":app:bundleRelease"]
    : [":app:assembleRelease", ":app:bundleRelease"];
const gradleWrapper = join(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
if (!existsSync(gradleWrapper)) fail("Gradle wrapper is missing after Expo prebuild");
const gradleArguments = [
  ...gradleTasks,
  "--no-daemon",
  "--console=plain",
  ...(process.platform === "win32" ? ["-Pkotlin.compiler.execution.strategy=in-process"] : []),
  ...(dryRun ? ["--dry-run"] : [])
];
if (!dryRun) removeRequestedReleaseOutputs(artifactFormat);
const buildStartedAt = Date.now();
if (process.platform === "win32") {
  runWindowsGradle(gradleArguments, releaseEnvironment);
} else {
  run("Gradle Android release", gradleWrapper, gradleArguments, {
    cwd: androidRoot,
    env: releaseEnvironment,
    shell: false
  });
}

if (dryRun) {
  console.log(`Android ${releaseMode} ${artifactFormat} release dry-run passed with all identity guards enabled.`);
} else {
  verifyFreshReleaseOutputs(artifactFormat, buildStartedAt);
  console.log(`Android ${releaseMode} ${artifactFormat} release completed with all identity guards enabled.`);
}

function runNode(label, modulePath, argumentsList, cwd, environment) {
  run(label, process.execPath, [modulePath, ...argumentsList], { cwd, env: environment, shell: false });
}

function resolveWindowsJavaHome() {
  const configuredJavaHome = process.env.JAVA_HOME?.trim();
  if (configuredJavaHome) {
    const configuredCandidate = resolve(configuredJavaHome);
    if (existsSync(join(configuredCandidate, "bin", "java.exe"))) {
      return configuredCandidate;
    }
  }

  const repositoryJdksRoot = join(repoRoot, ".android-sdk", "jdks");
  const candidates = existsSync(repositoryJdksRoot)
    ? readdirSync(repositoryJdksRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(repositoryJdksRoot, entry.name))
        .filter((candidate) => existsSync(join(candidate, "bin", "java.exe")))
    : [];
  if (candidates.length !== 1) {
    fail(`expected exactly one repository JDK, found ${candidates.length}`);
  }
  return candidates[0];
}

function runWindowsGradle(argumentsList, environment) {
  const substCommand = join(process.env.SystemRoot || "C:\\Windows", "System32", "subst.exe");
  if (!existsSync(substCommand)) fail("Windows subst.exe is required for a path-safe Android release");
  let drive;
  for (let code = "Z".charCodeAt(0); code >= "D".charCodeAt(0); code -= 1) {
    const candidate = `${String.fromCharCode(code)}:`;
    if (existsSync(`${candidate}\\`)) continue;
    const mapping = spawnSync(substCommand, [candidate, repoRoot], { encoding: "utf8" });
    if (mapping.status === 0) {
      drive = candidate;
      break;
    }
  }
  if (!drive) fail("no temporary Windows drive letter was available for the Android release");

  const mappedRepoRoot = `${drive}\\`;
  const mappedMobileRoot = join(mappedRepoRoot, "apps", "mobile-native");
  const mappedAndroidRoot = join(mappedMobileRoot, "android");
  const defaultAutolinkingConfig = join(
    mappedAndroidRoot,
    "build", "generated", "autolinking", "autolinking.json"
  );
  const releaseAutolinkingConfig = join(
    mappedAndroidRoot,
    "build", "generated", "akademik-release", "autolinking.json"
  );
  const generatedAutolinkingCmake = join(
    mappedAndroidRoot,
    "app", "build", "generated", "autolinking", "src", "main", "jni",
    "Android-autolinking.cmake"
  );
  const mappedEnvironment = {
    ...environment,
    JAVA_HOME: remapPathPrefix(environment.JAVA_HOME, repoRoot, mappedRepoRoot),
    GRADLE_USER_HOME: join(mappedRepoRoot, ".gradle-user-home"),
    AKADEMIK_WINDOWS_LONG_MOBILE_ROOT: mobileRoot,
    AKADEMIK_WINDOWS_SHORT_MOBILE_ROOT: mappedMobileRoot,
    AKADEMIK_WINDOWS_AUTOLINKING_CONFIG: releaseAutolinkingConfig
  };
  const commandInterpreter = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
  const commandLine = ["gradlew.bat", ...argumentsList].join(" ");
  console.log("\n[android-release] Gradle Android release (temporary short Windows path)");
  let result;
  let operationFailure;
  const cleanupFailures = [];
  try {
    // React Native and Expo resolve node_modules through the physical drive even when the
    // command starts on a subst drive. Prewrite a fully remapped config before settings.gradle
    // links native projects, and do not allow the command-backed cache to replace it.
    rmSync(defaultAutolinkingConfig, { force: true });
    rmSync(generatedAutolinkingCmake, { force: true });
    writeMappedWindowsAutolinkingConfig(
      releaseAutolinkingConfig,
      mappedMobileRoot,
      mappedEnvironment
    );
    if (!dryRun) {
      refreshWindowsReleaseNativeCaches();
    }
    result = spawnSync(commandInterpreter, ["/d", "/s", "/c", commandLine], {
      cwd: mappedAndroidRoot,
      env: mappedEnvironment,
      shell: false,
      stdio: "inherit"
    });
  } catch (error) {
    operationFailure = error instanceof Error ? error.message : String(error);
  } finally {
    if (!dryRun) {
      try {
        // Native models contain the temporary drive in Ninja/CMake metadata. They are
        // release-only caches and must not survive after that drive is detached.
        refreshWindowsReleaseNativeCaches();
      } catch (error) {
        cleanupFailures.push(
          `native release caches: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    for (const generatedPath of [
      releaseAutolinkingConfig,
      defaultAutolinkingConfig,
      generatedAutolinkingCmake
    ]) {
      try {
        rmSync(generatedPath, { force: true });
      } catch (error) {
        cleanupFailures.push(`${generatedPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const cleanup = spawnSync(substCommand, [drive, "/d"], { encoding: "utf8" });
    if (cleanup.status !== 0) {
      cleanupFailures.push(cleanup.stderr?.trim() || "subst cleanup failed");
    }
  }
  if (cleanupFailures.length > 0) {
    fail(`temporary Windows release cleanup failed: ${cleanupFailures.join("; ")}`);
  }
  if (operationFailure) fail(`Windows release preparation failed: ${operationFailure}`);
  if (result?.error) fail(`Gradle Android release could not start: ${result.error.message}`);
  if (result?.status !== 0) process.exit(result?.status ?? 1);
}

function writeMappedWindowsAutolinkingConfig(destination, mappedMobileRoot, environment) {
  const argumentsList = [
    "--no-warnings",
    "--eval",
    "require('expo/bin/autolinking')",
    "expo-modules-autolinking",
    "react-native-config",
    "--platform",
    "android",
    "--json"
  ];
  const generated = spawnSync(process.execPath, argumentsList, {
    cwd: mappedMobileRoot,
    env: environment,
    encoding: "utf8",
    shell: false,
    maxBuffer: 10 * 1024 * 1024
  });
  if (generated.error) {
    throw new Error(`Expo React Native autolinking could not start: ${generated.error.message}`);
  }
  if (generated.status !== 0) {
    const diagnostic = generated.stderr?.trim() || generated.stdout?.trim() || "unknown error";
    throw new Error(`Expo React Native autolinking failed: ${diagnostic}`);
  }

  let config;
  try {
    config = JSON.parse(generated.stdout);
  } catch (error) {
    throw new Error(`Expo React Native autolinking returned invalid JSON: ${error.message}`);
  }
  const remapped = remapMobileRootPaths(config, mobileRoot, mappedMobileRoot);
  const expectedPackage = JSON.parse(readFileSync(appConfig, "utf8")).expo?.android?.package;
  if (!expectedPackage || remapped.project?.android?.packageName !== expectedPackage) {
    throw new Error("the remapped React Native config has the wrong Android package");
  }
  for (const dependencyName of [
    "@react-native-firebase/messaging",
    "@react-native-google-signin/google-signin",
    "react-native-screens"
  ]) {
    if (!remapped.dependencies?.[dependencyName]?.platforms?.android?.sourceDir) {
      throw new Error(`the remapped React Native config is missing ${dependencyName}`);
    }
  }
  const remainingLongPath = findStringContainingPath(remapped, mobileRoot);
  if (remainingLongPath) {
    throw new Error(`the remapped React Native config still contains the long mobile root: ${remainingLongPath}`);
  }
  if (!pathStartsWith(remapped.root, mappedMobileRoot)
      || !pathStartsWith(remapped.reactNativePath, mappedMobileRoot)) {
    throw new Error("the remapped React Native config is not rooted on the temporary drive");
  }

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(remapped)}\n`, "utf8");
}

function remapMobileRootPaths(value, longMobileRoot, shortMobileRoot) {
  if (typeof value === "string") {
    return remapPathPrefix(
      remapPathPrefix(
        value,
        longMobileRoot.replaceAll("\\", "/"),
        shortMobileRoot.replaceAll("\\", "/")
      ),
      longMobileRoot.replaceAll("/", "\\"),
      shortMobileRoot.replaceAll("/", "\\")
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => remapMobileRootPaths(entry, longMobileRoot, shortMobileRoot));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        remapMobileRootPaths(entry, longMobileRoot, shortMobileRoot)
      ])
    );
  }
  return value;
}

function remapPathPrefix(value, longPrefix, shortPrefix) {
  if (typeof value !== "string" || !longPrefix) return value;
  const pattern = new RegExp(escapeRegExp(longPrefix), "giu");
  return value.replace(pattern, shortPrefix);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function findStringContainingPath(value, pathPrefix) {
  if (typeof value === "string") {
    const normalizedValue = value.replaceAll("\\", "/").toLowerCase();
    const normalizedPrefix = pathPrefix.replaceAll("\\", "/").toLowerCase();
    return normalizedValue.includes(normalizedPrefix) ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findStringContainingPath(entry, pathPrefix);
      if (match) return match;
    }
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      const match = findStringContainingPath(entry, pathPrefix);
      if (match) return match;
    }
  }
  return undefined;
}

function pathStartsWith(value, expectedRoot) {
  if (typeof value !== "string") return false;
  const normalizedValue = value.replaceAll("\\", "/").toLowerCase();
  const normalizedRoot = expectedRoot.replaceAll("\\", "/").replace(/\/$/u, "").toLowerCase();
  return normalizedValue === normalizedRoot || normalizedValue.startsWith(`${normalizedRoot}/`);
}

function refreshWindowsReleaseNativeCaches() {
  const allowedRoots = [androidRoot, join(mobileRoot, "node_modules")];
  const cxxDirectories = allowedRoots.flatMap(findCxxDirectories);
  const releaseCacheTargets = cxxDirectories.flatMap((cxxDirectory) => [
    join(cxxDirectory, "RelWithDebInfo"),
    join(cxxDirectory, "tools", "release"),
    join(dirname(cxxDirectory), "build", "intermediates", "cxx", "RelWithDebInfo")
  ]);
  for (const target of new Set(releaseCacheTargets)) {
    if (!existsSync(target)) continue;
    assertExistingPathWithin(target, allowedRoots, "native release cache");
    rmSync(target, { recursive: true, force: true });
    if (existsSync(target)) fail(`native release cache cleanup did not remove ${target}`);
    console.log(`[android-release] Refreshed native release cache: ${target}`);
  }
}

function findCxxDirectories(searchRoot) {
  const matches = [];
  const pending = [searchRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = join(current, entry.name);
      if (entry.name === ".cxx") {
        matches.push(child);
      } else if (!new Set([".git", ".gradle", "build"]).has(entry.name)) {
        pending.push(child);
      }
    }
  }
  return matches;
}

function removeRequestedReleaseOutputs(format) {
  const outputsRoot = join(androidRoot, "app", "build", "outputs");
  const requested = format === "apk"
    ? [join(outputsRoot, "apk", "release")]
    : format === "aab"
      ? [join(outputsRoot, "bundle", "release")]
      : [join(outputsRoot, "apk", "release"), join(outputsRoot, "bundle", "release")];
  for (const target of requested) {
    assertLexicalPathWithin(target, outputsRoot, "release output");
    if (existsSync(target)) {
      assertExistingPathWithin(target, [outputsRoot], "release output");
      rmSync(target, { recursive: true, force: true });
      console.log(`[android-release] Removed stale release output: ${target}`);
    }
  }
}

function assertExistingPathWithin(target, allowedRoots, label) {
  const realTarget = realpathSync(target);
  const insideAllowedRoot = allowedRoots.some((root) => (
    existsSync(root) && isPathWithin(realpathSync(root), realTarget)
  ));
  if (!insideAllowedRoot) throw new Error(`${label} escaped its allowed root: ${target}`);
}

function assertLexicalPathWithin(target, allowedRoot, label) {
  if (!isPathWithin(resolve(allowedRoot), resolve(target))) {
    throw new Error(`${label} escaped its allowed root: ${target}`);
  }
}

function isPathWithin(root, target) {
  const relation = relative(root, target);
  return relation.length > 0
    && relation !== ".."
    && !relation.startsWith(`..${sep}`)
    && !isAbsolute(relation);
}

function run(label, command, argumentsList, options) {
  console.log(`\n[android-release] ${label}`);
  const result = spawnSync(command, argumentsList, {
    cwd: options.cwd,
    env: options.env,
    shell: options.shell,
    stdio: "inherit"
  });
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function printUsage() {
  console.log("Usage: node scripts/build-android-release.mjs <signed|unsigned> <apk|aab|both> [--dry-run]");
}

function verifyFreshReleaseOutputs(format, buildStartedAt) {
  const app = JSON.parse(readFileSync(appConfig, "utf8")).expo;
  const expectedVersion = String(app.version);
  const expectedVersionCode = String(app.android.versionCode);
  const mergedManifest = join(
    androidRoot,
    "app", "build", "intermediates", "merged_manifests", "release",
    "processReleaseManifest", "AndroidManifest.xml"
  );
  requireFile(mergedManifest, "merged release manifest");
  const manifestContents = readFileSync(mergedManifest, "utf8");
  if (!manifestContents.includes(`package="${app.android.package}"`)
      || !manifestContents.includes(`android:versionCode="${expectedVersionCode}"`)
      || !manifestContents.includes(`android:versionName="${expectedVersion}"`)
      || manifestContents.includes('android:debuggable="true"')) {
    fail("the generated release manifest does not match the source package/version or is debuggable");
  }

  const releaseBundle = join(
    androidRoot,
    "app", "build", "generated", "assets", "createBundleReleaseJsAndAssets", "index.android.bundle"
  );
  requireFreshFile(releaseBundle, buildStartedAt, "release JavaScript bundle");
  const bundleContents = readFileSync(releaseBundle);
  const identity = JSON.parse(readFileSync(contract, "utf8"));
  if (!bundleContents.includes(Buffer.from(identity.webOauthClientId, "utf8"))) {
    fail("the fresh release JavaScript bundle is missing the pinned Web OAuth audience");
  }
  for (const nativeIdentity of Object.values(identity.androidOauthClients)) {
    if (bundleContents.includes(Buffer.from(nativeIdentity.clientId, "utf8"))) {
      fail("the fresh release JavaScript bundle embeds a native OAuth client");
    }
  }

  const requestedArtifacts = format === "apk"
    ? [["APK", findFreshArtifact(join(androidRoot, "app", "build", "outputs", "apk", "release"), ".apk", buildStartedAt)]]
    : format === "aab"
      ? [["AAB", findFreshArtifact(join(androidRoot, "app", "build", "outputs", "bundle", "release"), ".aab", buildStartedAt)]]
      : [
          ["APK", findFreshArtifact(join(androidRoot, "app", "build", "outputs", "apk", "release"), ".apk", buildStartedAt)],
          ["AAB", findFreshArtifact(join(androidRoot, "app", "build", "outputs", "bundle", "release"), ".aab", buildStartedAt)]
        ];
  for (const [label, artifact] of requestedArtifacts) {
    requireFreshFile(artifact, buildStartedAt, `${label} artifact`);
    verifyPackagedOAuthAudience(label, artifact, identity);
    if (releaseMode === "signed" && label === "AAB") {
      verifySignedAabIdentity(artifact, identity);
    }
    const sha256 = createHash("sha256").update(readFileSync(artifact)).digest("hex");
    console.log(`[android-release] ${label}: ${artifact}`);
    console.log(`[android-release] ${label} SHA-256: ${sha256}`);
  }
}

function verifyPackagedOAuthAudience(label, artifact, identity) {
  const entry = label === "AAB"
    ? "base/assets/index.android.bundle"
    : "assets/index.android.bundle";
  const verificationDirectory = mkdtempSync(join(tmpdir(), "akademik-android-artifact-"));
  let verificationError;

  try {
    const jar = resolveJavaTool("jar");
    const extraction = spawnSync(jar, ["xf", artifact, entry], {
      cwd: verificationDirectory,
      env: releaseEnvironment,
      shell: false,
      encoding: "utf8"
    });
    if (extraction.error) throw extraction.error;
    if (extraction.status !== 0) {
      throw new Error(`${label} JavaScript bundle extraction failed`);
    }

    const packagedBundle = join(verificationDirectory, ...entry.split("/"));
    requireExtractedFile(packagedBundle, `${label} packaged JavaScript bundle`);
    const contents = readFileSync(packagedBundle);
    const webCount = countBufferOccurrences(contents, Buffer.from(identity.webOauthClientId, "utf8"));
    if (webCount !== 1) {
      throw new Error(`${label} packaged JavaScript bundle must contain the pinned Web OAuth audience exactly once`);
    }
    for (const nativeIdentity of Object.values(identity.androidOauthClients)) {
      if (countBufferOccurrences(contents, Buffer.from(nativeIdentity.clientId, "utf8")) !== 0) {
        throw new Error(`${label} packaged JavaScript bundle embeds a native OAuth client`);
      }
    }
  } catch (error) {
    verificationError = error instanceof Error ? error.message : String(error);
  } finally {
    rmSync(verificationDirectory, { recursive: true, force: true });
  }

  if (verificationError) fail(verificationError);
}

function verifySignedAabIdentity(artifact, identity) {
  const jarsigner = spawnSync(
    resolveJavaTool("jarsigner"),
    ["-J-Duser.language=en", "-verify", artifact],
    { env: releaseEnvironment, shell: false, encoding: "utf8" }
  );
  const jarsignerOutput = `${jarsigner.stdout ?? ""}\n${jarsigner.stderr ?? ""}`;
  if (jarsigner.error || jarsigner.status !== 0 || !/jar verified\./iu.test(jarsignerOutput)) {
    fail("the signed AAB failed JAR signature integrity verification");
  }

  const keytool = spawnSync(
    resolveJavaTool("keytool"),
    ["-J-Duser.language=en", "-printcert", "-jarfile", artifact],
    { env: releaseEnvironment, shell: false, encoding: "utf8" }
  );
  const certificateOutput = `${keytool.stdout ?? ""}\n${keytool.stderr ?? ""}`;
  if (keytool.error || keytool.status !== 0) {
    fail("the signed AAB certificate could not be read");
  }
  const actualSha1 = certificateOutput.match(/SHA1:\s*([0-9A-F:]+)/iu)?.[1];
  const actualSha256 = certificateOutput.match(/SHA256:\s*([0-9A-F:]+)/iu)?.[1];
  const expected = identity.androidOauthClients.upload;
  if (normalizeCertificateHash(actualSha1) !== normalizeCertificateHash(expected.certificateSha1)
      || normalizeCertificateHash(actualSha256) !== normalizeCertificateHash(expected.certificateSha256)) {
    fail("the signed AAB certificate does not match the pinned upload identity");
  }
}

function resolveJavaTool(name) {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const javaHome = releaseEnvironment.JAVA_HOME?.trim();
  return javaHome ? join(javaHome, "bin", executable) : executable;
}

function normalizeCertificateHash(value) {
  return String(value ?? "").replace(/[^0-9A-F]/giu, "").toUpperCase();
}

function countBufferOccurrences(contents, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = contents.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function requireExtractedFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} was not found inside the artifact`);
  }
}

function requireFreshFile(path, buildStartedAt, label) {
  requireFile(path, label);
  if (statSync(path).mtimeMs + 2_000 < buildStartedAt) fail(`${label} is stale`);
}

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) fail(`${label} was not produced`);
}

function findFreshArtifact(directory, extension, buildStartedAt) {
  if (!existsSync(directory)) fail(`${extension} output directory was not produced`);
  const matches = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(directory, entry.name))
    .filter((path) => statSync(path).mtimeMs + 2_000 >= buildStartedAt);
  if (matches.length !== 1) fail(`expected exactly one fresh ${extension} artifact, found ${matches.length}`);
  return matches[0];
}

function fail(message, exitCode = 1) {
  console.error(`[android-release] ${message}`);
  process.exit(exitCode);
}
