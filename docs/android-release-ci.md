# Android Release CI

The `Android Release` GitHub Actions workflow builds the generated Expo Android
project on `ubuntu-24.04`. This avoids depending on Windows path-length behavior
and makes the native project reproducible from tracked application inputs.

## Triggers and outputs

- A manual run can explicitly select `signed` or `unsigned` and `apk`, `aab`,
  or `both`.
- Tags matching `android-v*` always request signed APK and AAB artifacts.
- A signed request never falls back to the debug key or to an unsigned output.
- An unsigned request deliberately removes the release signing configuration;
  unsigned artifacts are for internal validation and are not Play-ready.
- Successful runs upload the verified artifacts, `SHA256SUMS`, release metadata,
  and the verification log for 14 days.

## Required GitHub Actions secrets

Every run requires:

- `ANDROID_GOOGLE_SERVICES_JSON_BASE64`: base64-encoded production
  `google-services.json`.

Signed runs additionally require all four values:

- `ANDROID_UPLOAD_KEYSTORE_BASE64`: base64-encoded upload keystore.
- `ANDROID_UPLOAD_STORE_PASSWORD`: keystore password.
- `ANDROID_UPLOAD_KEY_ALIAS`: upload-key alias.
- `ANDROID_UPLOAD_KEY_PASSWORD`: upload-key password.

Missing, malformed, or partial values stop the job before prebuild. The workflow
also rejects the conventional `androiddebugkey` alias and an Android Debug
certificate subject. Secrets are materialized only in the ephemeral runner and
removed before artifact upload.

Example base64 commands:

```bash
base64 -w 0 google-services.json
base64 -w 0 upload-keystore.jks
```

On macOS, use `base64 -i FILE | tr -d '\n'`.

## Verification contract

The workflow validates all requested outputs before upload:

- ZIP integrity and a non-debuggable manifest.
- APK application id `com.anssoft.akademiktakvim`.
- APK alignment with the Android build-tools `zipalign` binary.
- APK signing with `apksigner`, including rejection of debug certificates.
- AAB JAR signing with `jarsigner`, including rejection of debug certificates.
- AAB structural validation with SHA-256-pinned Google `bundletool` 1.18.3.
- The absence of a valid signature when `unsigned` was explicitly selected.
- SHA-256 checksums for every staged APK and AAB.

The Android project is generated with `expo prebuild --clean`. During generation,
`apps/mobile-native/plugins/with-android-production-security.cjs` replaces Expo's
debug-key release fallback with an explicit signed/unsigned policy. The config
plugin fails when the generated Gradle structure no longer matches the expected
template, forcing template upgrades to be reviewed instead of silently weakening
release signing.

## Local syntax checks

The workflow and scripts can be checked without producing an Android artifact:

```bash
bash -n scripts/prepare-android-release-inputs.sh
bash -n scripts/verify-android-release-artifacts.sh
```

The authoritative end-to-end validation is a GitHub Actions run because it
requires Linux Android tooling and repository secrets.
