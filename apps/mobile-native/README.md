# Academic Calendar Mobile

Academic Calendar Mobile is the React Native and Expo client for the Academic Calendar platform. It targets Android and iOS and provides a personalized view of official academic dates, trusted university announcements, reminders, and calendar integrations.

## Product Experience

- A one-time, single-screen introduction followed by email or Google authentication.
- Guided registration and academic-profile setup for university, faculty, department, and year.
- Four primary destinations: Home, Announcements, Calendar, and Profile.
- A daily brief with upcoming exams, events, deadlines, and featured announcements.
- Searchable, source-attributed announcements with filters, saved items, and detail views.
- Agenda, week, and month calendar views with personal exam creation.
- Notification categories, quiet hours, and device-level delivery status.
- Owner-scoped Google Calendar synchronization with explicit disconnect, cleanup, and revoke actions.
- Secure session storage, recent-authentication checks, and account/data deletion flows.

The visual contract, responsive behavior, accessibility rules, and screen inventory are maintained in the [mobile redesign documentation](../../docs/mobile-native-redesign/README.md).

## Requirements

- Node.js 22 and npm
- A running Academic Calendar API
- Android Studio and a supported JDK for Android development
- macOS with Xcode for iOS development

Expo Go is not supported because the app uses native Firebase Messaging and Google Sign-In modules. Use a development build, emulator, simulator, or physical device.

## Installation

From the repository root:

```bash
npm --prefix apps/mobile-native install
cp apps/mobile-native/.env.example apps/mobile-native/.env
```

## Configuration

Available public client settings are documented in [`.env.example`](./.env.example). The API base URL is resolved in this order:

1. `EXPO_PUBLIC_API_URL`
2. The Expo development bundle host on port `3000`
3. The platform fallback

Fallbacks are `http://10.0.2.2:3000` for the Android emulator, `http://localhost:3000` for the iOS simulator, and `https://academic-api.anssoft.com.tr` for production builds.

Provider integrations require environment-specific configuration:

- Android Google Sign-In requires an Android OAuth client for package `com.anssoft.akademiktakvim` and the signing certificate SHA-1.
- Backend Google authentication requires a Web OAuth client ID in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; the API must allow the corresponding client IDs.
- Sign in with Apple is enabled for iOS bundle ID `com.anssoft.akademiktakvim` and team `VMGJVLFX95`. Enable the **Sign in with Apple** capability on the matching App ID in Apple Developer, then let Xcode refresh its automatically managed provisioning profile.
- The API must set `APPLE_SIGN_IN_CLIENT_IDS=com.anssoft.akademiktakvim`. Apple identity tokens are verified against Apple's public JWKS; this native flow does not require a committed `.p8` key or client secret.
- Google Calendar synchronization requires the Google Calendar API and the `calendar.events` scope.
- iOS requires its own OAuth client, Firebase application, signing identity, and APNs configuration.
- Push delivery requires matching Firebase native configuration and authorized Firebase Admin credentials on the API.

Do not commit `.env`, `google-services.json`, `GoogleService-Info.plist`, keystores, signing properties, service-account files, or provider secrets.

For App Store archives, open `ios/AkademikTakvim.xcworkspace`, select the `AkademikTakvim` target, and keep **Automatically manage signing** enabled for team `VMGJVLFX95`. The source Expo config owns the team ID, build number, Apple Sign In entitlement, mixed-localization flag, and export-compliance declaration so a future iOS prebuild reproduces them. A matching untracked `GoogleService-Info.plist` is still required by Firebase Messaging before runtime validation.

## Development

Run Metro from the repository root:

```bash
npm run dev:mobile:native
```

Launch a native target:

```bash
npm run android:mobile:native
npm run ios:mobile:native
```

Equivalent commands from this directory are `npm run start`, `npm run android`, and `npm run ios`.

## Validation

```bash
npm run typecheck
npm run test:native
```

From the repository root, use `npm run typecheck:mobile:native` and `npm run test:mobile:native`. Root API and shared-contract validation is covered by `npm run validate`.

## Android Release Build

The generated `android/` project and release-signing configuration are local build inputs and remain ignored. Generate or synchronize the native project, configure an authorized release keystore outside version control, and then build from `apps/mobile-native/android`:

```powershell
.\gradlew.bat assembleRelease
```

On macOS or Linux, run `./gradlew assembleRelease`. The default APK output is `app/build/outputs/apk/release/app-release.apk`. Verify the package name, version code, signature, and checksum before distribution; do not commit the resulting APK or AAB.

## Data and Integration Boundaries

- Only trusted, owner-authorized announcement and calendar destinations are opened.
- Google synchronization mutates only events marked as managed by this application; unrelated personal events are never selected for update or deletion.
- Disconnecting Google Calendar can leave managed events in place, while cleanup and revoke actions are explicit.
- Signing out clears local integration metadata but does not silently revoke provider access or delete remote events.
- Data and account deletion attempt managed-event cleanup and access revocation, and report incomplete provider cleanup instead of claiming success.
- Device-calendar mapping code is dormant reference logic; the active integration uses the Google Calendar API and requests no device-calendar permission.

## Documentation

- [Design system and QA program](../../docs/mobile-native-redesign/README.md)
- [Security controls](../../docs/04-security-hardening.md)
- [Testing strategy](../../docs/05-test-strategy.md)
- [Deployment guide](../../docs/08-devops-deployment.md)
- [Firebase deployment](../../docs/15-firebase-deploy.md)
- [Performance validation](./performance/README.md)
