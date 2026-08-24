# Manual Android Release

The repository does not track or run GitHub Actions workflows. Android release
builds are started manually after the operator has reviewed the source commit.

## Required local inputs

Every production build requires a valid `google-services.json`. Signed builds
also require the upload keystore, store password, key alias, and key password.
The release policy rejects missing signing values, the conventional
`androiddebugkey` alias, and an Android Debug certificate.

The helper scripts intentionally support explicit `signed` and `unsigned`
modes. Unsigned artifacts are for internal verification and are not Play-ready.

## Build and verification

Generate the native project from tracked Expo inputs, then run the requested
Gradle release task manually. Verify every output with:

```bash
bash scripts/prepare-android-release-inputs.sh
bash scripts/verify-android-release-artifacts.sh
```

The verification script checks ZIP integrity, the application id, manifest
debuggability, APK alignment and signing, AAB signing and structure, debug
certificate rejection, and SHA-256 output hashes. The operator must use a
trusted local Android SDK and a separately downloaded, checksum-verified
`bundletool` JAR when validating an AAB.

Secrets must remain outside Git, be materialized only for the build, and be
removed from the generated native project and staging directory afterward.
