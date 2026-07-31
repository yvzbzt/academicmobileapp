# Student Mobile Native App (React Native + Expo)

Native student app for academic calendar tracking and alarm preferences.

## Scripts

- `npm run start` starts Expo development server.
- `npm run android` runs on Android emulator/device.
- `npm run ios` runs on iOS simulator/device (macOS required for simulator).
- `npm run web` runs Expo web preview.
- `npm run typecheck` runs TypeScript checks.

From repository root:

- `npm run dev:mobile:native`
- `npm run android:mobile:native`
- `npm run ios:mobile:native`
- `npm run typecheck:mobile:native`

## Features

- Student register/login/logout with device id.
- University selection and profile linking.
- Published calendar and upcoming events.
- Direct, owner-scoped Google Calendar synchronization for academic dates and trusted, source-dated announcements/events, with live connection verification, partial-result reporting, account change, disconnect, managed-event removal, and OAuth revoke choices.
- Alarm controls:
  - `All Calendar`: enables alarms for all academic categories.
  - `Selected Fields`: enables alarms for chosen categories only.
- Notification delivery lifecycle: explicit OS permission, FCM token acquisition/rotation, owner-bound backend registration/detach, and honest inactive/error states.
- Exact notification destinations for trusted announcements and calendar events, revalidated for the current owner before opening.

## API Base URL Notes

API base URL is now resolved automatically in this order:

1. `EXPO_PUBLIC_API_URL` (if defined)
2. Expo dev bundle host (same machine IP as Metro, port `3000`)
3. Platform fallback defaults

Fallback defaults:

- Production APK: `https://academic-api.anssoft.com.tr`
- iOS simulator: `http://localhost:3000`
- Android emulator: `http://10.0.2.2:3000`

For local override, copy `.env.example` to `.env` in this folder and set:

- `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000`

## Google Login Notes

Mobile Google login does not use Firebase authorized domains. Android needs:

- Android OAuth Client ID for package `com.anssoft.akademiktakvim` and the APK signing SHA-1.
- Web OAuth Client ID set as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, so Google Sign-In returns an ID token for the backend.

The VPS backend must include both client IDs in `GOOGLE_OAUTH_CLIENT_IDS`.

If the APK shows a raw React Native Google Sign-In troubleshooting error, code `10`, or `DEVELOPER_ERROR`, treat it as a Google/Firebase configuration mismatch:

- Confirm `android/app/build.gradle` uses application ID `com.anssoft.akademiktakvim`.
- Confirm the Android OAuth client in Google Cloud/Firebase uses that exact package name.
- Confirm the OAuth Android client has the SHA-1 of the APK/AAB signing certificate.
- For the current Play upload key, the SHA-1 in the last build report was `5F:59:8B:3A:F3:3E:9F:BA:E6:07:59:E3:38:29:61:79:A1:C0:27:47`.
- After Google Play App Signing is enabled, also add the Play Console app-signing SHA-1 from Play Console > Setup > App integrity.
- Confirm `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is a Web OAuth client ID, not an Android OAuth client ID.

## Google Calendar Lifecycle Notes

The app checks the current academic profile, network, calendar response, and trusted announcement response before it can show Google account/scope authorization. Stored connection metadata is never treated as proof of connection: restore must verify the current Google account/token against the Calendar API.

Only source-authored publication/update dates are transferable. Discovery, crawl, and fetch timestamps are not calendar dates. The app mutates only events marked with its private managed and owner properties; personal Google Calendar events are not selected for update or deletion.

The selected Google Cloud project must have the Calendar API enabled and permit the `calendar.events` scope. iOS also requires its own `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and matching native OAuth/Firebase configuration; the Android and Web client IDs are not substitutes for it.

The Calendar screen exposes distinct actions:

- Disconnect and leave existing managed events in Google Calendar.
- Remove the current Academic Calendar owner's managed events, then disconnect.
- Revoke Google access while leaving existing events in place.
- Change account after choosing whether old managed events remain or are removed.

Ordinary disconnect or revoke keeps a token-free disconnected ledger so a later data/account deletion for the same app owner can still attempt removal after reauthorization. Choosing to keep old events during account switch is different: the new account replaces that ledger, so the intentionally retained old-account records can be removed only after reconnecting that Google account.

Logout clears local Google metadata and signs out locally but intentionally leaves the OAuth grant and remote managed events. `Verilerimi Sil` and `Hesabımı Sil` instead attempt removal known through the current ledger followed by access revocation and report incomplete cleanup for retry.

## Notification Delivery Notes

A saved preference alone is not delivery. Delivery is shown as active only when the user enabled it, OS permission is granted, and the current app installation is registered with the API. Permission is requested only after the user's explicit enable/save action. A permanently denied state links to system notification settings.

Native delivery uses React Native Firebase Messaging with Expo Notifications for permission, Android channels, local foreground presentation, and a strict tap fallback. React Native Firebase 26 requires the React Native New Architecture, which is enabled in `app.json`; Expo Go is not a valid runtime for this native path. The API stores the FCM token required for delivery, but hashes the stable app installation ID before persistence; registration responses and delivery/admin audit DTOs never return the raw token. Android channels are `academic-reminders` and `academic-updates`.

Provider-visible push title/body text is deliberately generic. After an owner/schema check, the authenticated app resolves only `GET /announcements/my/trusted/:announcementId` or `GET /calendar/my/trusted/:eventId`; it never searches a capped collection or falls back to another record. The worker atomically claims jobs and re-reads the active registration immediately before every provider send so a concurrent worker or account/token rebind cannot silently use a stale registration.

Native/provider requirements:

- Android and iOS need authorized Firebase native app configuration for the matching bundle/package.
- The API sender needs authorized Firebase Admin/FCM credentials.
- iOS additionally needs an authorized `GoogleService-Info.plist`, APNs configuration, and a macOS/Xcode build environment.
- Expo Go/web output is not evidence for these native modules or provider delivery.

The current Windows QA environment has only an API 24 Android AVD. It cannot demonstrate API 26+ channel behavior or the API 33+ notification permission prompt. The repository has no authorized iOS `GoogleService-Info.plist` or non-production APNs/FCM delivery fixture, so iOS token/delivery and real provider sends remain explicit evidence blockers.

## Native Device Calendar Boundary

`src/native-calendar` is retained as dormant reference logic only. It is not wired into `App.tsx`, has no installed device-calendar adapter/dependency, requests no calendar permission, and performs no runtime synchronization. The working calendar integration described above is Google Calendar REST synchronization.

## Account Deletion

Google Play's public account deletion URL is:

- `https://akademiksil.anssoft.com.tr/account-deletion`

The mobile app exposes two profile actions:

- `Verilerimi Sil`: removes school selection, notification preferences/device records, alarms, and user-scoped app data while keeping the account active; it also attempts current-ledger Google managed-event removal and OAuth revocation without touching personal events. Old-account records intentionally retained during account switch require reconnecting that Google account.
- `Hesabımı Sil`: removes app data and notification records, attempts current-ledger Google managed-event removal/revocation, revokes sessions, anonymizes the account record, and allows the same email to register again later. Old-account records intentionally retained during account switch cannot be reached without reconnecting that account; other incomplete device/provider cleanup is reported rather than silently treated as complete.
