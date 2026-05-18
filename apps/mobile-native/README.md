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

- iOS simulator: `http://localhost:3000`
- Android emulator: `http://10.0.2.2:3000`

For local override, copy `.env.example` to `.env` in this folder and set:

- `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000`
