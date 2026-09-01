# Manual Android Release

The repository does not track or run GitHub Actions workflows. Android release
builds are started manually after the operator has reviewed the source commit.

## Required local inputs

Every production build requires a valid `google-services.json`. Signed builds
also require the upload keystore, store password, key alias, and key password.
The release policy rejects missing signing values, the conventional
`androiddebugkey` alias, an Android Debug certificate, and any signer that does
not match the pinned production upload certificate.

The non-secret production identity is tracked in
`apps/mobile-native/android-release-identity.json`. It separates the upload
certificate used on local APK/AAB outputs from the Play App Signing certificate
used on APKs distributed by Google Play. Firebase must contain Android OAuth
clients for both package/certificate pairs plus the pinned Web OAuth client.

The helper scripts intentionally support explicit `signed` and `unsigned`
modes. Unsigned artifacts are for internal verification and are not Play-ready.

## Supported build command

From the repository root, set the signing inputs and run the single supported
release entry point. `AKADEMIK_UPLOAD_STORE_FILE` must be an absolute path.

```powershell
$env:AKADEMIK_UPLOAD_STORE_FILE = (Resolve-Path "C:\secure\upload-keystore.jks").Path
$env:AKADEMIK_UPLOAD_STORE_PASSWORD = "<store password>"
$env:AKADEMIK_UPLOAD_KEY_ALIAS = "<alias>"
$env:AKADEMIK_UPLOAD_KEY_PASSWORD = "<key password>"
npm run release:android -- signed aab
```

On Bash-compatible systems, export the same four variables before the npm
command. For a task-graph check that produces no output, use
`npm run release:android -- unsigned aab --dry-run`.

The orchestrator always forces the production Expo environment and performs
source preflight, non-clean Expo prebuild, source/generated Firebase equality,
generated-guard validation, exact upload-keystore validation, a fresh release
JavaScript bundle check, Gradle build, packaged APK/AAB OAuth-audience checks,
signed-AAB certificate and signature-integrity checks, and fresh
package/version/manifest/output checks. It prints the final path and SHA-256. A stale ignored `android/` tree or
development dotenv override therefore cannot silently enter a release. On
Windows, it creates and removes a temporary short drive mapping so React Native
native-code generation does not hit the legacy 260-character tool limit.

The same guards are injected into direct Gradle release tasks, but direct Gradle
is an internal diagnostic path. It does not provide the orchestrator's prebuild
and stale-output checks and must not be used as the normal release procedure.

## Linux CI helpers

The two shell helpers target a GNU/Linux CI runner. They are not the supported
Windows or macOS local release interface. A base64-secret workflow must use
separate steps so values written to `GITHUB_ENV` take effect:

```bash
# Step 1
bash scripts/prepare-android-release-inputs.sh signed
# Step 2
npm run release:android -- signed aab
# Step 3
bash scripts/verify-android-release-artifacts.sh signed aab
```

`prepare-android-release-inputs.sh` requires `GITHUB_ENV`, `RUNNER_TEMP`,
`ANDROID_GOOGLE_SERVICES_JSON_BASE64`, and the four `ANDROID_UPLOAD_*` signing
variables. It validates the exact upload SHA-1 and SHA-256 before exporting the
Gradle inputs.

The verification script checks ZIP integrity, package/version, manifest
debuggability, APK alignment and signing, AAB signing and structure, debug
certificate rejection, the exact pinned upload signer, and SHA-256 output
hashes. The runner must use a trusted local Android SDK and a separately
downloaded, checksum-verified `bundletool` JAR when validating an AAB.

The Firebase certificate registration persists across releases; it is not
recreated for each AAB. A new registration and reviewed identity update are
required only when the package, Firebase app, upload key, or Play App Signing
key intentionally changes. Before production promotion, install the same build
from a normal Play internal/closed track and complete one real Google login
smoke test; a locally sideloaded APK cannot reproduce Play's re-signing step.
The local config check is deliberately deterministic and does not authenticate
to Firebase or the VPS, so that smoke test is also the final check against a
later remote OAuth registration or backend-audience change.

Secrets must remain outside Git, be materialized only for the build, and be
removed from the generated native project and staging directory afterward.
