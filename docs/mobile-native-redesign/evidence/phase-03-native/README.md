# Phase 3 Android native evidence

- Date: 31 July 2026
- Host: Windows, Europe/Istanbul
- Target: existing `AcademicPhase1Low` Google APIs API 24 x86_64 AVD

## Accepted evidence

- `app:assembleDebug` completed successfully for `x86_64` after enabling the React Native New Architecture required by React Native Firebase 26 and regenerating stale Google Sign-In codegen output.
- The resulting 39,267,789-byte debug APK installed successfully as `com.anssoft.akademiktakvim`, version `0.1.1` / code `12`, min SDK 24 / target SDK 36.
- `MainActivity` launched from a cold app stop, Metro bundled 962 modules, React reported `fabric=true`, hydration reached the Turkish Login/Register surface, and the app process remained alive.
- The strict URL `academicpulse://notification?schemaVersion=1&destinationType=announcement&destinationId=announcement-42&recipientOwnerId=owner-a` was delivered intact. While signed out, Login/Register remained visible and the `native_pending_notification_destination` key appeared in Android encrypted SecureStore. No destination content was shown before authentication.
- The fatal filter matched no `FATAL EXCEPTION`, fatal React JavaScript error, activity-start failure, missing Firebase app, or missing TurboModule error.

The screenshot [signed-out-notification-handoff.png](./signed-out-notification-handoff.png) was captured from the Android emulator after the strict handoff. It is native evidence for launch, signed-out containment, and the existing authentication surface only. It is not evidence of a notification shade, a provider-delivered FCM message, post-login exact-record resolution, or integration-screen visual acceptance.

## Exact native commands

```powershell
.\gradlew.bat --no-daemon app:assembleDebug -PreactNativeArchitectures=x86_64
adb install -r app-debug.apk
adb reverse tcp:8081 tcp:8081
expo start --localhost --port 8081 --clear
adb shell am force-stop com.anssoft.akademiktakvim
adb shell am start -W -n com.anssoft.akademiktakvim/.MainActivity
adb shell am start -W -a android.intent.action.VIEW -d academicpulse://notification?schemaVersion=1\&destinationType=announcement\&destinationId=announcement-42\&recipientOwnerId=owner-a com.anssoft.akademiktakvim
adb exec-out run-as com.anssoft.akademiktakvim cat shared_prefs/SecureStore.xml
adb shell uiautomator dump /sdcard/phase3-notification.xml
adb shell screencap -p /sdcard/phase3-notification-handoff.png
adb logcat -d -v brief
```

The commands above abbreviate the absolute local Android SDK/APK paths recorded in the execution transcript. Only the SecureStore key name was asserted; its encrypted value and any unrelated stored values were not recorded.

## Exact blockers

- `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED`: API 24 has no Android 8/API 26 notification channels and no Android 13/API 33 runtime notification permission dialog. Channel and permission-state logic is covered with deterministic native-adapter fakes, not mislabeled as OS acceptance.
- `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED`: no authorized non-production Firebase sender/project, APNs setup, push token, or provider delivery path was supplied. No real notification send, shade, or tap is claimed.
- `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED`: no authorized non-production Google account/calendar fixture was supplied. The chooser and live create/update/delete/remove/revoke flows were not exercised.
- `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED`: Windows has no Xcode/iOS simulator, and no authorized `GoogleService-Info.plist` or APNs configuration is present. No iOS runtime/build acceptance is claimed.

No production account, calendar data, push token, provider send, deployment, or Play Console action was used.
