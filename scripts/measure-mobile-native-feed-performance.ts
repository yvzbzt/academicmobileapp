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

async function main(): Promise<void> {
  const sdkRoot = resolveAndroidSdkRoot();
  const adb = resolveSdkTool(sdkRoot, "platform-tools", executableName("adb"));
  const aapt2 = resolveLatestBuildTool(sdkRoot, executableName("aapt2"));
  const serial = await resolveSingleDevice(adb);
  const ephemeralDevice = process.env.FEED_PERFORMANCE_EPHEMERAL_DEVICE === "1";
  const preexistingPackage = (await runAdb(adb, serial, ["shell", "pm", "list", "packages", packageName])).stdout
    .split(/\r?\n/u)
    .some((line) => line.trim() === `package:${packageName}`);
  if (preexistingPackage && !ephemeralDevice) {
    throw new Error("PERFORMANCE_PACKAGE_ALREADY_INSTALLED_USE_CLEAN_OR_EXPLICIT_EPHEMERAL_DEVICE");
  }
  let installed = false;
  const preexistingReleaseArtifact = snapshotExistingReleaseArtifact();
  let benchmarkApkPath: string | undefined = canonicalReleaseApkPath();
  let releaseArtifactRestored = false;

  try {
    console.log("Building a fresh x86_64 release bundle from the isolated feed entry...");
    await runCommand(gradleExecutable(), [
      ":app:assembleRelease",
      "-PreactNativeArchitectures=x86_64",
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

    const screen = parseDeviceSize((await runAdb(adb, serial, ["shell", "wm", "size"])).stdout);
    const densityDpi = parseDeviceDensity((await runAdb(adb, serial, ["shell", "wm", "density"])).stdout);
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
      fontScale: (await runAdb(adb, serial, ["shell", "settings", "get", "system", "font_scale"])).stdout.trim(),
      refreshRateHz: parseRefreshRate(displayDump),
      animationScales: {
        window: (await runAdb(adb, serial, ["shell", "settings", "get", "global", "window_animation_scale"])).stdout.trim(),
        transition: (await runAdb(adb, serial, ["shell", "settings", "get", "global", "transition_animation_scale"])).stdout.trim(),
        animator: (await runAdb(adb, serial, ["shell", "settings", "get", "global", "animator_duration_scale"])).stdout.trim(),
      },
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

    const report = {
      method: {
        buildVariant: "release",
        entryFile: performanceEntryFile,
        architecture: "x86_64",
        nodeEnv: "production",
        metroRequired: false,
        postBuildSettlingMs,
        warmupTrials: 1,
        measuredTrials: FEED_PERFORMANCE_THRESHOLDS.requiredTrialCount,
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
        displaySettingsChanged: false,
        adbReverseAdded: false,
      },
    };
    console.log(JSON.stringify(report, null, 2));
    if (!evaluation.accepted) {
      throw new Error(`PERFORMANCE_ACCEPTANCE_FAILED:${evaluation.reasons.map((reason) => reason.code).join("|")}`);
    }
  } finally {
    if (installed) {
      await runAdb(adb, serial, ["shell", "am", "force-stop", packageName]).catch(() => undefined);
      await runAdb(adb, serial, ["uninstall", packageName]).catch(() => undefined);
      await runAdb(adb, serial, ["shell", "rm", "-f", hierarchyPath]).catch(() => undefined);
    }
    if (!releaseArtifactRestored) {
      restoreReleaseArtifact(benchmarkApkPath, preexistingReleaseArtifact);
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

function parseDeviceSize(output: string): { width: number; height: number } {
  const matches = [...output.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/giu)];
  const selected = matches.at(-1);
  const width = Number(selected?.[1]);
  const height = Number(selected?.[2]);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("PERFORMANCE_DEVICE_SIZE_INVALID");
  }
  return { width, height };
}

function parseDeviceDensity(output: string): number {
  const matches = [...output.matchAll(/(?:Physical|Override) density:\s*(\d+)/giu)];
  const density = Number(matches.at(-1)?.[1]);
  if (!Number.isInteger(density) || density <= 0) {
    throw new Error("PERFORMANCE_DEVICE_DENSITY_INVALID");
  }
  return density;
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
