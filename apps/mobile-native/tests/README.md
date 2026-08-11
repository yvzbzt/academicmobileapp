# Native test fixtures and visual evidence

Jest Expo + React Native Testing Library is the only native component test
stack. Tests use semantic accessibility queries; snapshots are not an
acceptance mechanism.

`fixtures/native-test-environment.tsx` supplies deterministic, non-secret
session, API, integration, platform, theme, window-width, font-scale, Reduce
Motion, and Reduce Transparency states. Fixture owner IDs are labels only;
never add access tokens, refresh tokens, provider credentials, production
emails, or copied production records.

## Native screenshot convention

When a later phase captures an authorized native renderer, store the curated
evidence under:

```text
docs/mobile-native-redesign/evidence/phase-XX-native/screenshots/
```

Use lowercase filenames:

```text
<platform>-<api-or-os>-<width>dp-<theme>-font<scale>x-<route>-<state>.png
```

Example: `android-api33-320dp-dark-font2x-login-validation-error.png`.

Capture only seeded/local non-production fixtures. Before moving a raw capture
from `C:\tmp` into evidence, crop unrelated host chrome and notification
content, redact personal identifiers/provider account details, remove location
or device metadata where present, and visually inspect the final file. Record
the build SHA, device/AVD, API/OS version, dimensions, density, font scale,
theme, route, fixture, and intentional platform difference in the phase
evidence index. Do not substitute Expo Web or a pre-existing APK image for
native evidence.

Phase 4 uses the development-only `DesignSystemPreview` gate to capture the
reviewed Android/API 24 primitive matrix documented in
[`phase-04-native`](../../../docs/mobile-native-redesign/evidence/phase-04-native/README.md).
The gate requires both `__DEV__` and
`EXPO_PUBLIC_PHASE4_DESIGN_PREVIEW=1`; it is unavailable to production builds.
The Phase 4 evidence does not claim an iOS matrix, authenticated-screen matrix,
tablet/rail acceptance, screen-reader acceptance, or full large-text acceptance.
