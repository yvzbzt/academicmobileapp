# Android Environment Evidence

Status: Environment, visible launch, build, install, activity startup, and required functional/layout QA verified. TalkBack runtime alone is unavailable, with exact blocker evidence in `talkback-blocker.md`; no screen-reader acceptance is claimed.

## Official tooling

| Item | Evidence |
|---|---|
| Android Studio package | Official Google LLC `Google.AndroidStudio`, Stable only |
| Winget package version | `2026.1.2.10` |
| Product build | `AI-261.25134.95.2612.15822958` |
| Installation path | `C:\Program Files\Android\Android Studio` |
| Platform-Tools / ADB | `36.0.2` |
| Command-line tools | Revision 22; SDK recognizes it at `cmdline-tools/latest-2` |
| Emulator | `36.6.11` |
| Acceleration | `WHPX(10.0.26200) is installed and usable` |
| Project Android requirements | package `com.anssoft.akademiktakvim`; min/compile/target SDK 24/36/36; Build-Tools 36; AGP 8.11; Gradle 8.14.3 |
| Existing native toolchain | NDK 27.1 and other pre-existing NDK/CMake versions were preserved; no NDK/CMake install was required for this closure |

## Closure host and initial-state record

| Item | Recorded value |
|---|---|
| Repository root | `<REPO_ROOT>` (`git rev-parse --show-toplevel` returned `<REPO_ROOT>`) |
| Branch / closure-start HEAD | `agent/google-play-readiness-20260724` / `cbd0067b03c3cf7286270df25164a556c55b55b9` |
| Five-entry closure-start log | `cbd0067 Add account deletion and Play readiness fixes`; `c599628 Fix standalone admin login`; `d399f22 Add academic information static pages data`; `0bb29ac Prepare clean mobile release`; `baec6c6 Add academic calendar platform updates` |
| Windows / CPU | Microsoft Windows 11 Pro `10.0.26200` (build 26200); 11th Gen Intel Core i7-1165G7 @ 2.80 GHz, 4 physical / 8 logical processors |
| Node / npm | Node `v22.14.0`; npm `10.9.2` |
| Java | Eclipse Temurin OpenJDK `21.0.7+6-LTS`, 64-bit |
| winget | `v1.29.280` |
| Physical memory | 16,461,264 kB total; 1,623,144 kB free at the 2026-07-29 17:00 +03:00 closure inventory while the emulator and QA services were active |
| System disk | `C:` 510,655,012,864 bytes total; 72,134,201,344 bytes free at the same post-install inventory |
| Android SDK root | `<ANDROID_SDK_ROOT>` |
| Effective Expo application config | Expo 54 / React Native 0.81.5; name `Akademik Takvim`; slug `academic-pulse-native`; scheme `academicpulse`; version `0.1.1`; portrait/light; New Architecture off; Hermes enabled by the existing Android Gradle properties; Android package `com.anssoft.akademiktakvim`, version code 12, edge-to-edge on, predictive Back off; plugin `expo-font` |
| Supported repository commands | `npm.cmd --prefix apps/mobile-native run android` (`expo run:android`), `npm.cmd --prefix apps/mobile-native run start` (`expo start`), native Gradle wrapper from `apps/mobile-native/android`, and `npm.cmd --prefix apps/mobile-native run typecheck` |

The pre-install inventory recorded an existing Android SDK/ADB 36.0.2 but no attached device, emulator executable, system image for this QA, or AVD directory; `adb devices -l` returned only `List of devices attached`. No reusable official Stable Android Studio installation was present, so the official winget package below was installed. Pre-existing build-tools/platform/NDK/CMake packages were preserved. The exact available-memory and free-disk figures above were captured after installation while the emulator was active; they are not presented as reconstructed pre-install values.

The `latest-2` location produces a non-fatal inconsistent-location warning because an older command-line-tools directory already occupied `latest`. It was not destructively rearranged. Pre-existing Android platforms/build-tools, CMake, and NDK installs were preserved; they were not installed as Phase 1 closure requirements.

Official installation command:

```powershell
& '<WINGET_EXE>' install --id Google.AndroidStudio --exact --source winget --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
```

Result: exit code 0, installed successfully. Discovery identified the official stable package `Google.AndroidStudio` version `2026.1.2.10`, publisher Google LLC.

## Final installed SDK package inventory

Read-only inventory command (exit 0):

```powershell
& '<ANDROID_SDK_ROOT>\cmdline-tools\latest-2\bin\sdkmanager.bat' --sdk_root='<ANDROID_SDK_ROOT>' --list_installed
```

| Package | Version | Closure disposition |
|---|---:|---|
| `build-tools;33.0.0` | 33.0.0 | Pre-existing, preserved |
| `build-tools;34.0.0` | 34.0.0 | Pre-existing, preserved |
| `build-tools;35.0.0` | 35.0.0 | Pre-existing, preserved |
| `build-tools;36.0.0` | 36.0.0 | Required project version already present, preserved |
| `cmake;3.22.1` | 3.22.1 | Pre-existing, preserved; not required/installed by closure |
| `cmdline-tools;latest` at `cmdline-tools\latest-2` | 22.0 | Required command-line tools available for closure; noncanonical-location warning disclosed |
| `emulator` | 36.6.11 | Required closure component |
| `ndk;26.1.10909125` | 26.1.10909125 | Pre-existing, preserved; not required/installed by closure |
| `ndk;27.1.12297006` | 27.1.12297006 | Existing project NDK, preserved |
| `platform-tools` | 36.0.2 | Existing required ADB/platform tools, preserved/verified |
| `platforms;android-33` | revision 3 | Pre-existing, preserved |
| `platforms;android-34` | revision 3 | Pre-existing, preserved |
| `platforms;android-36` | revision 2 | Required compile/target platform already present, preserved |
| `system-images;android-24;google_apis;x86_64` | revision 27 | Required closure image; final and only system image |

No Google Play, ARM, Wear OS, TV, Automotive, source, or documentation image/package was added.

### Recovered SDK mutation and license audit

The primary closure session log preserves the exact package-mutation calls. The initial tool/image install was:

```powershell
& '<ANDROID_SDK_ROOT>\cmdline-tools\latest\bin\sdkmanager.bat' --install 'cmdline-tools;latest' 'emulator' 'system-images;android-36;google_apis;x86_64'
```

Stock Google APIs images were then tried sequentially. Each prior image was uninstalled before the next was installed:

```powershell
& '<ANDROID_SDK_ROOT>\cmdline-tools\latest-2\bin\sdkmanager.bat' --uninstall 'system-images;android-36;google_apis;x86_64'
& '<ANDROID_SDK_ROOT>\cmdline-tools\latest-2\bin\sdkmanager.bat' --install 'system-images;android-34;google_apis;x86_64'
& '<ANDROID_SDK_ROOT>\cmdline-tools\latest-2\bin\sdkmanager.bat' --uninstall 'system-images;android-34;google_apis;x86_64'
& '<ANDROID_SDK_ROOT>\cmdline-tools\latest-2\bin\sdkmanager.bat' --install 'system-images;android-30;google_apis;x86_64'
& '<ANDROID_SDK_ROOT>\cmdline-tools\latest-2\bin\sdkmanager.bat' --uninstall 'system-images;android-30;google_apis;x86_64'
& '<ANDROID_SDK_ROOT>\cmdline-tools\latest-2\bin\sdkmanager.bat' --install 'system-images;android-28;google_apis;x86_64'
& '<ANDROID_SDK_ROOT>\cmdline-tools\latest-2\bin\sdkmanager.bat' --uninstall 'system-images;android-28;google_apis;x86_64'
& '<ANDROID_SDK_ROOT>\cmdline-tools\latest-2\bin\sdkmanager.bat' --install 'system-images;android-24;google_apis;x86_64'
```

For each transition, the emulator was stopped and awaited, the same `AcademicPhase1Low` AVD was deleted with `avdmanager delete avd --name AcademicPhase1Low`, and then recreated for the next image. The first API 36 creation attempt with custom `--skin 720x1280` failed because that skin argument was unsupported; retry without the custom skin succeeded. No Phase 1 `sdkmanager --licenses` command ran: package installs showed no license prompt and used the SDK root's pre-existing accepted license files. This is an honest license-history statement, not a claim that the closure newly accepted licenses.

## Final image and AVD inventory

| Item | Final evidence |
|---|---|
| System image count | Exactly one |
| Image | `system-images;android-24;google_apis;x86_64`, revision 27 |
| Google Play image | None |
| AVD count | Exactly one |
| AVD name | `AcademicPhase1Low` |
| AVD config path | `%USERPROFILE%\.android\avd\AcademicPhase1Low.avd\config.ini` |
| App compatibility | App `minSdkVersion` 24 |

API 36, 34, 30, and 28 Google APIs x86_64 images were tried sequentially using the same AVD name and removed before the next attempt. They forced effective heap/data values above the requested budget. API 24 is the final and only installed image.

## Configured versus effective resources

| Property | Configured | Effective runtime | Result |
|---|---:|---:|---|
| CPU | 2 cores | 2 cores | PASS |
| RAM | 1,536 MB | 1,533,960 kB | PASS |
| Display | 720 × 1280 | 720 × 1280 | PASS |
| Density/logical width | 320 dpi / approximately 360 dp | 320 dpi / 360 dp | PASS |
| VM heap | Requested/prelaunch 256 MB; post-boot config remains `256M` | 384 MB | Selected-image normalization; disclosed limitation |
| Data partition | Requested/prelaunch 2,047 MB; post-boot config is 6,442,450,944 bytes | approximately 5.8 GB mounted at `/data` | Selected-image normalization; disclosed limitation |
| GPU | host | WHPX/hardware accelerated | PASS |
| Front/back camera | off/off | off/off | PASS |
| Audio input/output | off | off | PASS |
| Device frame | off | off | PASS |
| Hardware keyboard | on | on | PASS |
| Quick Boot | on after initial boot | configured | PASS |

The heap/data deviations are system-image/emulator overrides, not deliberate extra allocation. The post-boot `config.ini` rewrite is recorded along with the runtime filesystem value. The final closure's hard resource criteria are no more than two cores and 2,048 MB RAM; both pass. Heap/data remain limitations rather than an independent acceptance blocker after sequential stock-image attempts.

## Creation and launch commands

Final AVD creation and immediate config-read command:

```powershell
$sdk='<ANDROID_SDK_ROOT>'; 'no' | & "$sdk\cmdline-tools\latest-2\bin\avdmanager.bat" create avd --name AcademicPhase1Low --package 'system-images;android-24;google_apis;x86_64' --device 'Nexus 4'; Get-Content -LiteralPath "$env:USERPROFILE\.android\avd\AcademicPhase1Low.avd\config.ini"
```

Initial isolated cold-boot command:

```powershell
emulator.exe -avd AcademicPhase1Low -accel on -gpu host -memory 1536 -cores 2 -partition-size 2047 -camera-back none -camera-front none -no-audio -no-boot-anim -no-window -wipe-data
```

Cold boot completed in 42.3 seconds. This first initialization was headless (`-no-window`).

The required visible standalone-window run then used the same options without `-no-window`:

```powershell
emulator.exe -avd AcademicPhase1Low -accel on -gpu host -memory 1536 -cores 2 -partition-size 2047 -camera-back none -camera-front none -no-audio -no-boot-anim
```

Quick Boot completed in 4.5 seconds and ADB reported the device healthy. The visible-window requirement is therefore satisfied without treating the earlier headless initialization as visual evidence.

## Exact final read-only device checks

```powershell
& '<ANDROID_SDK_ROOT>\emulator\emulator.exe' -accel-check
& '<ANDROID_SDK_ROOT>\cmdline-tools\latest-2\bin\avdmanager.bat' list avd
& '<ANDROID_SDK_ROOT>\platform-tools\adb.exe' devices -l
```

The acceleration command returned exit 0 and `WHPX(10.0.26200) is installed and usable.` The AVD command listed only `AcademicPhase1Low`, Nexus 4, API 24 Google APIs, ABI x86_64, skin 720 × 1280, at `<ANDROID_USER_HOME>\avd\AcademicPhase1Low.avd`. ADB returned:

```text
List of devices attached
emulator-5554          device product:sdk_google_phone_x86_64 model:Android_SDK_built_for_x86_64 device:generic_x86_64 transport_id:8
```

Read-only device properties returned API `24`, ABI `x86_64`, physical size `720x1280`, physical density `320`, `MemTotal: 1533960 kB`, two `/proc/cpuinfo` processor entries, Dalvik heap `384m`, `/data` 6,094,400 KiB total with 5,763,904 KiB available at inspection, and `sys.boot_completed=1`. `dumpsys window windows` showed `com.anssoft.akademiktakvim/.MainActivity` as both current focus and focused application during the closure check. The exact redacted startup error filter is stored in [`startup-logcat.md`](./startup-logcat.md).

## Current debug build

```powershell
cd <REPO_ROOT>\apps\mobile-native\android
.\gradlew.bat --no-daemon app:assembleDebug -PreactNativeArchitectures=x86_64
```

Result: PASS in 388.1 seconds. The first attempt from the repository root failed before Gradle execution because that directory is not a Gradle project; the correct-directory invocation above passed. Warnings were limited to an unset `NODE_ENV` fallback and dependency deprecation/unchecked-API notices.

No production signing, upload, deployment, or publication occurred.

## Final resource cleanup

After QA and final automation, the emulator, Metro, local API, Gradle, and Android Studio processes were stopped. Final inspection found no repository-local Node process, Java process, emulator, Android Studio, or Gradle daemon; ports 3000 and 8081 were clear; `adb devices -l` returned an empty device list. The SDK inventory still contains exactly one system image (`system-images;android-24;google_apis;x86_64`, revision 27), and the AVD inventory still contains exactly one AVD (`AcademicPhase1Low`). Cleanup therefore removed transient runtime processes without deleting the retained closure environment.
