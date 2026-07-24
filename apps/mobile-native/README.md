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
- Direct Google Calendar synchronization for academic dates, announcements, and events.
- Alarm controls:
  - `All Calendar`: enables alarms for all academic categories.
  - `Selected Fields`: enables alarms for chosen categories only.
- Notification preference save.
- Device token registration.

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

## Account Deletion

Google Play's public account deletion URL is:

- `https://akademiksil.anssoft.com.tr/account-deletion`

The mobile app exposes two profile actions:

- `Verilerimi Sil`: removes school selection, notification preferences, device notification records, alarms, and user-scoped app data while keeping the account active.
- `Hesabımı Sil`: removes app data, revokes sessions, anonymizes the account record, and allows the same email to register again later.
