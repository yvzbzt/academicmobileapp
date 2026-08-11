# Redacted Startup Logcat Evidence

Captured: `2026-07-29 17:00:14 +03:00`\
Device: `emulator-5554` / `AcademicPhase1Low` / API 24 Google APIs x86_64\
Application: `com.anssoft.akademiktakvim` `0.1.1` (12), debuggable
Source: current Phase 1 working tree on closure-start HEAD `cbd0067b03c3cf7286270df25164a556c55b55b9`

Read-only filter command:

```powershell
& '<ANDROID_SDK_ROOT>\platform-tools\adb.exe' -s emulator-5554 logcat -d -v threadtime AndroidRuntime:E ReactNativeJS:E ReactNative:E SoLoader:E '*:S'
```

Exact filtered output:

```text
--------- beginning of system
--------- beginning of main
```

Result: **PASS for the immediate startup-fatal/native-module/React-JS-error smoke only.** The filtered buffer contained two section headers and no error entry. A count-only case-insensitive scan for password/token/recovery/verification/example-email/code-like patterns found zero matches. The UTF-8 SHA-256 of the two output lines joined with LF, without a trailing LF, is `A55DAF2A39CFF70C1A04BA986D4B2B015EF5EF7D47E8B7DDC7E8814D13907F94`.

This narrow fatal-error filter is not a substitute for the final repository sensitive-log scan, nor does it prove every application path is free of nonfatal warnings. No raw unfiltered logcat is committed because it can contain environment or fixture data.
