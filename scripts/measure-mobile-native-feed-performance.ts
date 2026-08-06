import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  FEED_PERFORMANCE_THRESHOLDS,
  evaluateFeedPerformanceTrials,
  parseAndroidActivityStartTiming,
  parseAndroidFrameStats,
} from "../apps/mobile-native/src/performance/feed-performance.js";

const workspaceRoot = resolve(import.meta.dirname, "..");
const nativeRoot = join(workspaceRoot, "apps", "mobile-native");
const androidRoot = join(nativeRoot, "android");
const packageName = "com.anssoft.akademiktakvim";
const activityName = `${packageName}/.MainActivity`;
const performanceEntryFile = "index.feed-performance.ts";
const hierarchyPath = "/sdcard/academic-feed-performance.xml";
const expectedRuntimeMarker = "Release feed performance harness, 100 records";
const postBuildSettlingMs = 15_000;
const standardDeviceProfile = Object.freeze({
  width: 720,
  height: 1280,
  densityDpi: 320,
  fontScale: 1,
  animationScale: 1,
} as const);

interface CommandOptions {
  cwd?: string;
  echo?: boolean;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface ExistingArtifactSnapshot {
  path: string;
  bytes: Buffer;
  accessedAt: Date;
  modifiedAt: Date;
}

interface DisplaySizeConfiguration {
  physical: { width: number; height: number };
  override?: { width: number; height: number };
}

interface DisplayDensityConfiguration {
  physical: number;
  override?: number;
}

interface DeviceConfigurationSnapshot {
  size: DisplaySizeConfiguration;
  density: DisplayDensityConfiguration;
  fontScale: string | null;
  animationScales: {
    window: string | null;
    transition: string | null;
    animator: string | null;
  };
}

interface ReactNativeRuntimeConfiguration {
  jsEngine: "Hermes";
  renderer: "Fabric";
  hermesEnabled: true;
  newArchitectureEnabled: true;
}

async function main(): Promise<void> {
  const sdkRoot = resolveAndroidSdkRoot();
  const adb = resolveSdkTool(sdkRoot, "platform-tools", executableName("adb"));
  const aapt2 = resolveLatestBuildTool(sdkRoot, executableName("aapt2"));
  const serial = await resolveSingleDevice(adb);
  const gitHead = await resolveGitHead();
  const reactNativeRuntime = readReactNativeRuntimeConfiguration();
  const ephemeralDevice = process.env.FEED_PERFORMANCE_EPHEMERAL_DEVICE === "1";
  const preexistingPackage = (await runAdb(adb, serial, ["shell", "pm", "list", "packages", packageName])).stdout
    .split(/\r?\n/u)
    .some((line) => line.trim() === `package:${packageName}`);
  if (preexistingPackage && !ephemeralDevice) {
    throw new Error("PERFORMANCE_PACKAGE_ALREADY_INSTALLED_USE_CLEAN_OR_EXPLICIT_EPHEMERAL_DEVICE");
  }
  let installed = false;
  const preexistingReleaseArtifact = snapshotExistingReleaseArtifact();
  const originalDeviceConfiguration = await readDeviceConfiguration(adb, serial);
  let measuredDeviceConfiguration: DeviceConfigurationSnapshot | undefined;
  let restoredDeviceConfiguration: DeviceConfigurationSnapshot | undefined;
  let deviceConfigurationMutationAttempted = false;
  let deviceConfigurationRestored = false;
  let benchmarkApkPath: string | undefined = canonicalReleaseApkPath();
  let releaseArtifactRestored = false;

  try {
    deviceConfigurationMutationAttempted = true;
    await applyStandardDeviceConfiguration(adb, serial);
    measuredDeviceConfiguration = await readDeviceConfiguration(adb, serial);
    assertStandardDeviceConfiguration(measuredDeviceConfiguration);

    console.log("Building a fresh x86_64 release bundle from the isolated feed entry...");
    await runCommand(gradleExecutable(), [
      ":app:assembleRelease",
      "-PreactNativeArchitectures=x86_64",
      "-PhermesEnabled=true",
      "-PnewArchEnabled=true",
      "--no-daemon",
      "--rerun-tasks",
    ], {
      cwd: androidRoot,
      echo: true,
      env: {
        ...process.env,
        ENTRY_FILE: performanceEntryFile,
        NODE_ENV: "production",
      },
      timeoutMs: 20 * 60_000,
    });

    const apkPath = resolveReleaseApk();
    benchmarkApkPath = apkPath;
    const apkBytes = readFileSync(apkPath);
    const apkSizeBytes = statSync(apkPath).size;
    const apkSha256 = createHash("sha256").update(apkBytes).digest("hex");
    const badging = (await runCommand(aapt2, ["dump", "badging", apkPath])).stdout;
    const apkAbis = parseNativeCodeAbis(badging);
    if (apkAbis.length !== 1 || apkAbis[0] !== "x86_64") {
      throw new Error(`PERFORMANCE_APK_ABI_INVALID:${apkAbis.join(",") || "missing"}`);
    }
    if (/^application-debuggable$/mu.test(badging) || /application-debuggable/iu.test(badging)) {
      throw new Error("PERFORMANCE_APK_DEBUGGABLE");
    }

    const deviceAbi = (await runAdb(adb, serial, ["shell", "getprop", "ro.product.cpu.abi"])).stdout.trim();
    if (deviceAbi !== "x86_64") {
      throw new Error(`PERFORMANCE_DEVICE_ABI_INVALID:${deviceAbi || "missing"}`);
    }

    if (preexistingPackage) {
      console.log("Removing the pre-existing package only from the explicitly ephemeral device session...");
      await runAdb(adb, serial, ["uninstall", packageName], true);
    }

    console.log(`Installing release APK ${apkSha256.slice(0, 12)}... on ${serial}...`);
    await runAdb(adb, serial, ["install", "-r", "-d", apkPath], true);
    installed = true;

    const packageDump = (await runAdb(adb, serial, ["shell", "dumpsys", "package", packageName])).stdout;
    if (!packageDump.includes(`Package [${packageName}]`) || /\bDEBUGGABLE\b/u.test(packageDump)) {
      throw new Error("PERFORMANCE_INSTALLED_PACKAGE_NOT_RELEASE");
    }

    await runAdb(adb, serial, ["shell", "am", "force-stop", packageName]);
    await runAdb(adb, serial, ["logcat", "-c"]);
    const launch = await runAdb(adb, serial, ["shell", "am", "start", "-W", "-n", activityName], true);
    if (!/Status:\s+ok/iu.test(launch.stdout)) throw new Error("PERFORMANCE_APP_LAUNCH_FAILED");
    const activityStartTiming = parseAndroidActivityStartTiming(launch.stdout);
    if (!activityStartTiming) throw new Error("PERFORMANCE_APP_LAUNCH_TIMING_INVALID");
    await delay(5_000);

    const pid = (await runAdb(adb, serial, ["shell", "pidof", packageName])).stdout.trim();
    if (!pid) throw new Error("PERFORMANCE_APP_PROCESS_MISSING");
    const hierarchy = await readRuntimeHierarchy(adb, serial);
    if (!hierarchy.includes(expectedRuntimeMarker)) {
      throw new Error("PERFORMANCE_HARNESS_MARKER_MISSING");
    }
    const launchLogs = (await runAdb(adb, serial, ["logcat", "-d", "-v", "brief", "-t", "2000"])).stdout;
    if (/(?:cannot|could not|unable to) connect to (?:the )?(?:metro|development server)|unable to load script/iu.test(launchLogs)) {
      throw new Error("PERFORMANCE_RELEASE_REQUESTED_METRO");
    }

    measuredDeviceConfiguration = await readDeviceConfiguration(adb, serial);
    assertStandardDeviceConfiguration(measuredDeviceConfiguration);
    const screen = effectiveDisplaySize(measuredDeviceConfiguration.size);
    const densityDpi = effectiveDisplayDensity(measuredDeviceConfiguration.density);
    const displayDump = (await runAdb(adb, serial, ["shell", "dumpsys", "display"])).stdout;
    const surfaceFlingerDump = (await runAdb(adb, serial, ["shell", "dumpsys", "SurfaceFlinger"])).stdout;
    const deviceMetadata = {
      apiLevel: (await runAdb(adb, serial, ["shell", "getprop", "ro.build.version.sdk"])).stdout.trim(),
      model: (await runAdb(adb, serial, ["shell", "getprop", "ro.product.model"])).stdout.trim(),
      buildFingerprint: (await runAdb(adb, serial, ["shell", "getprop", "ro.build.fingerprint"])).stdout.trim(),
      avdName: serial.startsWith("emulator-")
        ? (await runAdb(adb, serial, ["emu", "avd", "name"])).stdout.split(/\r?\n/u)[0]?.trim()
        : undefined,
      densityDpi,
      graphicsRenderer: parseGraphicsRenderer(surfaceFlingerDump),
      fontScale: measuredDeviceConfiguration.fontScale,
      refreshRateHz: parseRefreshRate(displayDump),
      animationScales: measuredDeviceConfiguration.animationScales,
    };
    // The release build saturates the same host CPUs used by the emulator.
    // Let compiler/Gradle teardown settle before the unmeasured warm-up so the
    // samples describe feed rendering rather than build-process contention.
    await delay(postBuildSettlingMs);
    console.log(`Running one unmeasured warm-up and ${FEED_PERFORMANCE_THRESHOLDS.requiredTrialCount} measured trials...`);
    await resetFrameStats(adb, serial);
    await exerciseFeed(adb, serial, screen);

    const trials: number[][] = [];
    for (let trialIndex = 0; trialIndex < FEED_PERFORMANCE_THRESHOLDS.requiredTrialCount; trialIndex += 1) {
      await resetFrameStats(adb, serial);
      let durations: number[] = [];
      for (let batch = 0; batch < 3 && durations.length < FEED_PERFORMANCE_THRESHOLDS.minimumFramesPerTrial; batch += 1) {
        await exerciseFeed(adb, serial, screen);
        const frameStats = (await runAdb(adb, serial, ["shell", "dumpsys", "gfxinfo", packageName, "framestats"])).stdout;
        durations = parseAndroidFrameStats(frameStats);
      }
      trials.push(durations);
      console.log(`Measured trial ${trialIndex + 1}: ${durations.length} valid frames`);
    }

    const evaluation = evaluateFeedPerformanceTrials(trials);
    await runAdb(adb, serial, ["shell", "am", "force-stop", packageName]);
    await runAdb(adb, serial, ["uninstall", packageName], true);
    installed = false;
    restoreReleaseArtifact(benchmarkApkPath, preexistingReleaseArtifact);
    benchmarkApkPath = undefined;
    releaseArtifactRestored = true;
    restoredDeviceConfiguration = await restoreAndVerifyDeviceConfiguration(
      adb,
      serial,
      originalDeviceConfiguration,
    );
    deviceConfigurationRestored = true;

    const report = {
      repository: {
        gitHead,
      },
      method: {
        buildVariant: "release",
        entryFile: performanceEntryFile,
        architecture: "x86_64",
        nodeEnv: "production",
        metroRequired: false,
        reactNativeRuntime,
        standardDeviceProfile,
        postBuildSettlingMs,
        warmupTrials: 1,
        measuredTrials: FEED_PERFORMANCE_THRESHOLDS.requiredTrialCount,
        activityStartSource: `adb shell am start -W -n ${activityName}`,
        frameSource: `adb shell dumpsys gfxinfo ${packageName} framestats`,
        percentileMethod: "nearest-rank",
        thresholds: FEED_PERFORMANCE_THRESHOLDS,
      },
      artifact: {
        path: apkPath,
        bytes: apkSizeBytes,
        sha256: apkSha256,
        abis: apkAbis,
        debuggable: false,
      },
      runtime: {
        serial,
        deviceAbi,
        packageName,
        pid,
        embeddedRecordCount: 100,
        harnessMarkerObserved: true,
        metroConnectionErrorObserved: false,
        activityStartTimingMs: activityStartTiming,
        reactNativeRuntime,
        screen,
        ...deviceMetadata,
      },
      evaluation,
      teardown: {
        forceStopped: true,
        benchmarkPackageUninstalled: true,
        alternateEntryApkRemoved: true,
        preexistingReleaseArtifactRestored: Boolean(preexistingReleaseArtifact),
        preexistingPackageRemovedInEphemeralSession: preexistingPackage,
        standardDeviceConfigurationApplied: true,
        deviceConfigurationChangedForMeasurement: !deviceConfigurationsEqual(
          originalDeviceConfiguration,
          measuredDeviceConfiguration,
        ),
        deviceConfigurationRestored,
        originalDeviceConfiguration,
        restoredDeviceConfiguration,
        adbReverseAdded: false,
      },
    };
    console.log(JSON.stringify(report, null, 2));
    if (!evaluation.accepted) {
      throw new Error(`PERFORMANCE_ACCEPTANCE_FAILED:${evaluation.reasons.map((reason) => reason.code).join("|")}`);
    }
  } finally {
    try {
      if (installed) {
        await runAdb(adb, serial, ["shell", "am", "force-stop", packageName]).catch(() => undefined);
        await runAdb(adb, serial, ["uninstall", packageName]).catch(() => undefined);
        await runAdb(adb, serial, ["shell", "rm", "-f", hierarchyPath]).catch(() => undefined);
      }
    } finally {
      try {
        if (!releaseArtifactRestored) {
          restoreReleaseArtifact(benchmarkApkPath, preexistingReleaseArtifact);
        }
      } finally {
        if (deviceConfigurationMutationAttempted && !deviceConfigurationRestored) {
          await restoreAndVerifyDeviceConfiguration(adb, serial, originalDeviceConfiguration);
        }
      }
    }
  }
}

async function exerciseFeed(adb: string, serial: string, screen: { width: number; height: number }): Promise<void> {
  const x = Math.round(screen.width / 2);
  const upper = Math.round(screen.height * 0.24);
  const lower = Math.round(screen.height * 0.82);
  for (let index = 0; index < 6; index += 1) {
    await runAdb(adb, serial, ["shell", "input", "swipe", String(x), String(lower), String(x), String(upper), "450"]);
  }
  for (let index = 0; index < 6; index += 1) {
    await runAdb(adb, serial, ["shell", "input", "swipe", String(x), String(upper), String(x), String(lower), "450"]);
  }
}

async function resetFrameStats(adb: string, serial: string): Promise<void> {
  await runAdb(adb, serial, ["shell", "dumpsys", "gfxinfo", packageName, "reset"]);
}

async function readRuntimeHierarchy(adb: string, serial: string): Promise<string> {
  await runAdb(adb, serial, ["shell", "uiautomator", "dump", hierarchyPath]);
  try {
    return (await runAdb(adb, serial, ["shell", "cat", hierarchyPath])).stdout;
  } finally {
    await runAdb(adb, serial, ["shell", "rm", "-f", hierarchyPath]).catch(() => undefined);
  }
}

async function readDeviceConfiguration(
  adb: string,
  serial: string,
): Promise<DeviceConfigurationSnapshot> {
  const [size, density, fontScale, windowScale, transitionScale, animatorScale] = await Promise.all([
    runAdb(adb, serial, ["shell", "wm", "size"]),
    runAdb(adb, serial, ["shell", "wm", "density"]),
    runAdb(adb, serial, ["shell", "settings", "get", "system", "font_scale"]),
    runAdb(adb, serial, ["shell", "settings", "get", "global", "window_animation_scale"]),
    runAdb(adb, serial, ["shell", "settings", "get", "global", "transition_animation_scale"]),
    runAdb(adb, serial, ["shell", "settings", "get", "global", "animator_duration_scale"]),
  ]);

  return {
    size: parseDisplaySizeConfiguration(size.stdout),
    density: parseDisplayDensityConfiguration(density.stdout),
    fontScale: normalizeAndroidSetting(fontScale.stdout),
    animationScales: {
      window: normalizeAndroidSetting(windowScale.stdout),
      transition: normalizeAndroidSetting(transitionScale.stdout),
      animator: normalizeAndroidSetting(animatorScale.stdout),
    },
  };
}

async function applyStandardDeviceConfiguration(adb: string, serial: string): Promise<void> {
  await runAdb(adb, serial, ["shell", "wm", "size", "reset"]);
  await runAdb(adb, serial, ["shell", "wm", "density", "reset"]);
  await runAdb(adb, serial, ["shell", "settings", "put", "system", "font_scale", "1.0"]);
  await runAdb(adb, serial, ["shell", "settings", "put", "global", "window_animation_scale", "1.0"]);
  await runAdb(adb, serial, ["shell", "settings", "put", "global", "transition_animation_scale", "1.0"]);
  await runAdb(adb, serial, ["shell", "settings", "put", "global", "animator_duration_scale", "1.0"]);
}

async function restoreAndVerifyDeviceConfiguration(
  adb: string,
  serial: string,
  snapshot: DeviceConfigurationSnapshot,
): Promise<DeviceConfigurationSnapshot> {
  if (snapshot.size.override) {
    await runAdb(adb, serial, [
      "shell",
      "wm",
      "size",
      `${snapshot.size.override.width}x${snapshot.size.override.height}`,
    ]);
  } else {
    await runAdb(adb, serial, ["shell", "wm", "size", "reset"]);
  }
  if (snapshot.density.override) {
    await runAdb(adb, serial, ["shell", "wm", "density", String(snapshot.density.override)]);
  } else {
    await runAdb(adb, serial, ["shell", "wm", "density", "reset"]);
  }
  await restoreAndroidSetting(adb, serial, "system", "font_scale", snapshot.fontScale);
  await restoreAndroidSetting(
    adb,
    serial,
    "global",
    "window_animation_scale",
    snapshot.animationScales.window,
  );
  await restoreAndroidSetting(
    adb,
    serial,
    "global",
    "transition_animation_scale",
    snapshot.animationScales.transition,
  );
  await restoreAndroidSetting(
    adb,
    serial,
    "global",
    "animator_duration_scale",
    snapshot.animationScales.animator,
  );

  const restored = await readDeviceConfiguration(adb, serial);
  if (!deviceConfigurationsEqual(snapshot, restored)) {
    throw new Error("PERFORMANCE_DEVICE_CONFIGURATION_RESTORE_FAILED");
  }
  return restored;
}

async function restoreAndroidSetting(
  adb: string,
  serial: string,
  namespace: "global" | "system",
  key: string,
  value: string | null,
): Promise<void> {
  await runAdb(
    adb,
    serial,
    value === null
      ? ["shell", "settings", "delete", namespace, key]
      : ["shell", "settings", "put", namespace, key, value],
  );
}

function assertStandardDeviceConfiguration(configuration: DeviceConfigurationSnapshot): void {
  const size = effectiveDisplaySize(configuration.size);
  const densityDpi = effectiveDisplayDensity(configuration.density);
  const values = [
    configuration.fontScale,
    configuration.animationScales.window,
    configuration.animationScales.transition,
    configuration.animationScales.animator,
  ].map((value) => value === null ? Number.NaN : Number(value));
  const valid = !configuration.size.override
    && !configuration.density.override
    && size.width === standardDeviceProfile.width
    && size.height === standardDeviceProfile.height
    && densityDpi === standardDeviceProfile.densityDpi
    && values[0] === standardDeviceProfile.fontScale
    && values.slice(1).every((value) => value === standardDeviceProfile.animationScale);
  if (!valid) {
    throw new Error("PERFORMANCE_STANDARD_DEVICE_CONFIGURATION_INVALID");
  }
}

function parseDisplaySizeConfiguration(output: string): DisplaySizeConfiguration {
  const physical = parseSizeLine(output, "Physical");
  if (!physical) throw new Error("PERFORMANCE_DEVICE_SIZE_INVALID");
  const override = parseSizeLine(output, "Override");
  return { physical, ...(override ? { override } : {}) };
}

function parseSizeLine(
  output: string,
  kind: "Physical" | "Override",
): { width: number; height: number } | null {
  const match = output.match(new RegExp(`^${kind} size:\\s*(\\d+)x(\\d+)\\s*$`, "imu"));
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
    ? { width, height }
    : null;
}

function parseDisplayDensityConfiguration(output: string): DisplayDensityConfiguration {
  const physical = parseDensityLine(output, "Physical");
  if (!physical) throw new Error("PERFORMANCE_DEVICE_DENSITY_INVALID");
  const override = parseDensityLine(output, "Override");
  return { physical, ...(override ? { override } : {}) };
}

function parseDensityLine(output: string, kind: "Physical" | "Override"): number | null {
  const value = Number(output.match(new RegExp(`^${kind} density:\\s*(\\d+)\\s*$`, "imu"))?.[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeAndroidSetting(output: string): string | null {
  const value = output.trim();
  return value && value !== "null" ? value : null;
}

function effectiveDisplaySize(configuration: DisplaySizeConfiguration): { width: number; height: number } {
  return configuration.override ?? configuration.physical;
}

function effectiveDisplayDensity(configuration: DisplayDensityConfiguration): number {
  return configuration.override ?? configuration.physical;
}

function deviceConfigurationsEqual(
  left: DeviceConfigurationSnapshot,
  right: DeviceConfigurationSnapshot | undefined,
): boolean {
  if (!right) return false;
  return left.size.physical.width === right.size.physical.width
    && left.size.physical.height === right.size.physical.height
    && left.size.override?.width === right.size.override?.width
    && left.size.override?.height === right.size.override?.height
    && left.density.physical === right.density.physical
    && left.density.override === right.density.override
    && left.fontScale === right.fontScale
    && left.animationScales.window === right.animationScales.window
    && left.animationScales.transition === right.animationScales.transition
    && left.animationScales.animator === right.animationScales.animator;
}

function parseRefreshRate(output: string): number {
  const values = [...output.matchAll(/(?:refreshRate|fps)\s*[=:]\s*(\d+(?:\.\d+)?)/giu)]
    .flatMap((match) => match[1] ? [Number(match[1])] : [])
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 1_000);
  const refreshRate = values[0];
  if (!refreshRate) throw new Error("PERFORMANCE_DEVICE_REFRESH_RATE_INVALID");
  return refreshRate;
}

function parseGraphicsRenderer(output: string): string {
  const renderer = output.match(/^GLES:\s*(.+)$/mu)?.[1]?.trim();
  if (!renderer) throw new Error("PERFORMANCE_DEVICE_GRAPHICS_RENDERER_INVALID");
  return renderer;
}

function parseNativeCodeAbis(badging: string): string[] {
  const line = badging.split(/\r?\n/u).find((candidate) => candidate.startsWith("native-code:"));
  return line ? [...line.matchAll(/'([^']+)'/gu)].flatMap((match) => match[1] ? [match[1]] : []) : [];
}

async function resolveGitHead(): Promise<string> {
  const head = (await runCommand("git", ["rev-parse", "HEAD"])).stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error("PERFORMANCE_GIT_HEAD_INVALID");
  return head;
}

function readReactNativeRuntimeConfiguration(): ReactNativeRuntimeConfiguration {
  const propertiesPath = join(androidRoot, "gradle.properties");
  const properties = new Map(
    readFileSync(propertiesPath, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const;
      }),
  );
  if (properties.get("hermesEnabled") !== "true") {
    throw new Error("PERFORMANCE_HERMES_NOT_ENABLED");
  }
  if (properties.get("newArchEnabled") !== "true") {
    throw new Error("PERFORMANCE_FABRIC_NOT_ENABLED");
  }
  return {
    jsEngine: "Hermes",
    renderer: "Fabric",
    hermesEnabled: true,
    newArchitectureEnabled: true,
  };
}

async function resolveSingleDevice(adb: string): Promise<string> {
  const output = (await runCommand(adb, ["devices"])).stdout;
  const connected = output.split(/\r?\n/u).flatMap((line) => {
    const match = line.match(/^(\S+)\s+device$/u);
    return match?.[1] ? [match[1]] : [];
  });
  const requested = process.env.ANDROID_SERIAL?.trim();
  if (requested) {
    if (!connected.includes(requested)) throw new Error(`PERFORMANCE_DEVICE_NOT_CONNECTED:${requested}`);
    return requested;
  }
  if (connected.length !== 1 || !connected[0]) {
    throw new Error(`PERFORMANCE_DEVICE_SELECTION_REQUIRED:${connected.join(",") || "none"}`);
  }
  return connected[0];
}

function resolveAndroidSdkRoot(): string {
  const configured = process.env.ANDROID_SDK_ROOT?.trim() || process.env.ANDROID_HOME?.trim();
  const fallback = process.env.LOCALAPPDATA?.trim()
    ? join(process.env.LOCALAPPDATA, "Android", "Sdk")
    : undefined;
  const sdkRoot = configured || fallback;
  if (!sdkRoot || !existsSync(sdkRoot)) throw new Error("ANDROID_SDK_NOT_FOUND");
  return sdkRoot;
}

function resolveSdkTool(sdkRoot: string, folder: string, fileName: string): string {
  const candidate = join(sdkRoot, folder, fileName);
  if (!existsSync(candidate)) throw new Error(`ANDROID_SDK_TOOL_NOT_FOUND:${fileName}`);
  return candidate;
}

function resolveLatestBuildTool(sdkRoot: string, fileName: string): string {
  const buildToolsRoot = join(sdkRoot, "build-tools");
  const candidates = readdirSync(buildToolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionDescending)
    .map((version) => join(buildToolsRoot, version, fileName));
  const selected = candidates.find(existsSync);
  if (!selected) throw new Error(`ANDROID_BUILD_TOOL_NOT_FOUND:${fileName}`);
  return selected;
}

function compareVersionDescending(left: string, right: string): number {
  const leftParts = left.split(/[.-]/u).map(Number);
  const rightParts = right.split(/[.-]/u).map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return right.localeCompare(left, "en-US");
}

function resolveReleaseApk(): string {
  const releaseDirectory = join(androidRoot, "app", "build", "outputs", "apk", "release");
  const candidates = readdirSync(releaseDirectory)
    .filter((name) => name.endsWith(".apk"))
    .map((name) => join(releaseDirectory, name));
  const exact = candidates.find((candidate) => candidate.endsWith("app-release.apk"));
  if (exact) return exact;
  if (candidates.length === 1 && candidates[0]) return candidates[0];
  throw new Error(`PERFORMANCE_RELEASE_APK_AMBIGUOUS:${candidates.join(",") || "missing"}`);
}

function canonicalReleaseApkPath(): string {
  return join(androidRoot, "app", "build", "outputs", "apk", "release", "app-release.apk");
}

function snapshotExistingReleaseArtifact(): ExistingArtifactSnapshot | undefined {
  const path = canonicalReleaseApkPath();
  if (!existsSync(path)) return undefined;
  const metadata = statSync(path);
  return {
    path,
    bytes: readFileSync(path),
    accessedAt: metadata.atime,
    modifiedAt: metadata.mtime,
  };
}

function restoreReleaseArtifact(
  benchmarkPath: string | undefined,
  snapshot: ExistingArtifactSnapshot | undefined,
): void {
  if (benchmarkPath && existsSync(benchmarkPath)) rmSync(benchmarkPath, { force: true });
  if (!snapshot) return;
  writeFileSync(snapshot.path, snapshot.bytes);
  utimesSync(snapshot.path, snapshot.accessedAt, snapshot.modifiedAt);
}

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

function gradleExecutable(): string {
  return process.platform === "win32" ? "gradlew.bat" : "./gradlew";
}

async function runAdb(
  adb: string,
  serial: string,
  args: string[],
  echo = false,
): Promise<CommandResult> {
  return runCommand(adb, ["-s", serial, ...args], { echo });
}

function runCommand(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? workspaceRoot,
      env: options.env ?? process.env,
      shell: process.platform === "win32" && command.toLocaleLowerCase("en-US").endsWith(".bat"),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? 120_000);
    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      if (options.echo) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      if (options.echo) process.stderr.write(text);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectCommand(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        rejectCommand(new Error(`COMMAND_TIMEOUT:${command}`));
        return;
      }
      if (code === 0) resolveCommand({ stdout, stderr });
      else rejectCommand(new Error(`COMMAND_FAILED:${command}:${code ?? "unknown"}\n${stderr.slice(-2_000)}`));
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "PERFORMANCE_RUNNER_FAILED");
  process.exitCode = 1;
});
