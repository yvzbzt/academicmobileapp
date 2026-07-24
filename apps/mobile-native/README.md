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
