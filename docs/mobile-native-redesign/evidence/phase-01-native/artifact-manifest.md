# Native Artifact and Capture Manifest

Status: Build/install/startup, required native auth/recovery flows, session-revocation runtime evidence, and the full required width/font capture set are recorded. TalkBack is unavailable with an exact blocker. Resource cleanup passed; the scoped checkpoint SHA is reported in the final handoff because a commit cannot contain its own hash.

## Application artifact

| Field | Value |
|---|---|
| Source baseline at closure start | `cbd0067b03c3cf7286270df25164a556c55b55b9` |
| Built source identity | APK embeds the final Phase 1 mobile source later staged for the scoped checkpoint. The APK timestamp follows the last mobile-source modification; later documentation-only reconciliation does not alter the binary. Closure-start HEAD was `cbd0067b03c3cf7286270df25164a556c55b55b9`; resulting checkpoint SHA is reported externally. |
| Expected Android package | `com.anssoft.akademiktakvim` |
| App version / code | `0.1.1` / `12` |
| Debug APK path | `apps/mobile-native/android/app/build/outputs/apk/debug/app-debug.apk` |
| Build command | `.\gradlew.bat --no-daemon app:assembleDebug -PreactNativeArchitectures=x86_64` from `apps/mobile-native/android` |
| Build result | PASS, 388.1 seconds |
| APK size | 105,428,719 bytes |
| APK SHA-256 | `763148DA6A511220E4F37F5C57CF320458E208A90FC7AE2E525161E01B7D3A9D` |
| APK timestamp | `2026-07-29 15:04:43 +03:00` |
| Install result | `Success` |
| Installed package/version from `dumpsys package` | `com.anssoft.akademiktakvim`, `0.1.1` / code `12`, `DEBUGGABLE`, min SDK 24, target SDK 36 |
| Effective native QA API base URL | `http://10.0.2.2:3000`; `EXPO_PUBLIC_API_URL` explicitly set in Metro; local in-memory development API only |
| Main activity start result | `MainActivity` resolved and started in 1,083 ms |
| Immediate-fatal-crash/logcat result | PASS — no immediate fatal, native-module initialization, or React JS crash observed |
| Scoped checkpoint identity | PASS — this scoped commit; exact SHA reported in final response |

The debug APK and Android build outputs are local evidence only and must not be committed.

## Capture register

| Evidence ID | Required state | Local path | SHA-256 | Redacted | Result |
|---|---|---|---|:---:|---|
| NATIVE-360 | Default 720 × 1280/320 dpi (approximately 360 dp) | Historical auth/verification/recovery/Home/isolation/logout capture hashes plus the safe retained subset indexed in [`capture-hashes.md`](./capture-hashes.md) | Per-file SHA-256 register | Synthetic fixtures only; no real identity/private content | PASS: captures were reviewed before privacy cleanup; sensitive/transient binaries were then deleted and are not required as sole acceptance evidence |
| NATIVE-320 | Temporary approximately 320 dp override | `C:\tmp\layout-320-verification-profile.png`; `layout-320-register.png`; `layout-320-recovery.png` | `F669B198...B6A9`; `D5E1E4AD...B1BE`; `05E55DBD...E031` | No entered identity/code/password | PASS: Login/Register/Recovery at 640 × 1280 override/320 dpi; no horizontal clipping; actions reachable by scroll/focus |
| NATIVE-FONT200 | Font scale approximately 2.0 | Safe retained Login/Register/Home/Profile, Verification action, and Recovery Request/Confirm captures listed in [`capture-hashes.md`](./capture-hashes.md); reviewed companion hashes remain historical | Per-file SHA-256 register | Placeholder or explicitly synthetic non-secret values only | PASS with disclosed limitation: all six required surfaces/actions reachable; Home nav labels wrap/truncate and recovery password placeholders truncate |
| NATIVE-AUTH | Hydration/Login/Register/Verification evidence set | Direct observations and historical hashes for hydration, unverified-login, invalid-verification, visibility, resend, and success/later-failure captures; transient XML/PNGs deleted after reconciliation | Per-file historical SHA-256 register | Synthetic fixture only | PASS: signed-out/in hydration, registration, relaunch/resend, distinct unverified/invalid/session outcomes, Login/Register visibility, and verification-success→later-Login-failure all exercised. Server-expired verification submission is fixture-conditional and covered by seeded automation because the runtime has no time injection |
| NATIVE-RECOVERY | Password Recovery Request/Confirm/invalid/success evidence set | Safe retained large-font captures, historical hashes for transient flow captures, and [`runtime-auth-contract.md`](./runtime-auth-contract.md) | Per-file historical SHA-256 register; sanitized text evidence | Synthetic fixture only; preview/entered secrets deleted | PASS: known/unknown status/body presentation, invalid attempt, independent visibility, explicit Back/Cancel clearing, resend, reset, old/new Login, and revocation of two held refresh sessions all proved. Network latency was not equalized. Android hardware Back uses the same tested cleanup handler; UI evidence does not claim heap-byte erasure |
| NATIVE-RUNTIME-AUTH | Production public-field parity and all-session revocation | [`runtime-auth-contract.md`](./runtime-auth-contract.md) | Text evidence; no secret-bearing raw transcript retained | Yes | PASS: known/unknown public fields identical; two pre-reset sessions rejected 401 / `AUTH_SESSION_INVALID` without API restart. Latency parity was not measured or claimed |
| NATIVE-ISOLATION | User A/User B manual-exam isolation evidence | Direct observation plus historical hashes for `exam-a-added.png`, `exam-a-relaunch.png`, `exam-b-added.png`, and `user-a-return.png`; binaries deleted after review | Per-file historical SHA-256 register | Synthetic account labels/exam fixtures only | PASS |
| NATIVE-HIERARCHY | University/faculty descendant-clearing evidence | `C:\tmp\hierarchy-a-reload.xml`; `hierarchy-b-reload.xml`; isolated local API GET/PATCH results | Text evidence not committed because dumps contain fixture text | Synthetic fixture only | PASS: university replacement and faculty replacement cleared descendants server-side and after native relaunch |
| NATIVE-LOGOUT | Logout/late-response/relaunch evidence | Direct observation plus historical `logout-a.png` hash; transient PNG/XML binaries deleted after review | PNG SHA-256 `0539D314...DFA` | Synthetic fixture only | PASS: protected content absent immediately, after 5 s, and after relaunch |
| NATIVE-TALKBACK | TalkBack smoke capture or exact unavailability output | [`talkback-blocker.md`](./talkback-blocker.md) | Text evidence; no binary hash required | Yes — no user data in package/service output | BLOCKED: TalkBack package/activity absent; accessibility service null/disabled |
| NATIVE-LOGCAT | Redacted native-module/no-fatal-crash log extract | [`startup-logcat.md`](./startup-logcat.md) | `A55DAF2A39CFF70C1A04BA986D4B2B015EF5EF7D47E8B7DDC7E8814D13907F94` for the two header lines joined with LF | Yes — filter returned section headers only | PASS for immediate startup-fatal/native-module/React-JS-error smoke; expanded repository sensitive-log scan also returned `SENSITIVE_LOG_SCAN_NO_MATCHES` |

For every populated item also record `captured_at`, device serial/model, Android/API version, logical size, density, font scale, theme, fixture class, package/version, final Git HEAD, and reviewer in the accompanying QA row. Never store synthetic email/password/code values in this manifest.
