# TalkBack Availability Result

Captured: `2026-07-29 17:12:44 +03:00`\
Device: `emulator-5554` / `AcademicPhase1Low` / API 24 Google APIs x86_64 revision 27
Image type: Google APIs, not Google Play

Read-only checks:

```powershell
$adbExe = '<ANDROID_SDK_ROOT>\platform-tools\adb.exe'
& $adbExe -s emulator-5554 shell pm list packages | Select-String -Pattern '(?i)talkback|accessibility'
& $adbExe -s emulator-5554 shell settings get secure enabled_accessibility_services
& $adbExe -s emulator-5554 shell settings get secure accessibility_enabled
& $adbExe -s emulator-5554 shell cmd package resolve-activity --brief com.google.android.marvin.talkback
```

Exact result:

```text
PACKAGE_SCAN: NO_TALKBACK_OR_ACCESSIBILITY_PACKAGE_MATCH
enabled_accessibility_services=null
accessibility_enabled=0
No activity found
```

Result: **BLOCKED — TalkBack is not installed in the selected minimal Google APIs system image, so a real focus-order/announcement smoke test cannot run.** Static source/tests still cover labels, live regions, recovery visibility actions, retry controls, and disabled/busy semantics, but they are not screen-reader acceptance.

Installing a Google Play image or a second system image/AVD solely for TalkBack would violate this closure's minimum-workload/exactly-one-image/exactly-one-AVD constraint. The minimum remaining action is to authorize replacing the retained image with a TalkBack-capable image or to attach a compatible physical Android device, then repeat the required focus-order/announcement matrix. No accessibility acceptance is claimed from the static checks.
