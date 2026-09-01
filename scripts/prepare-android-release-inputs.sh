#!/usr/bin/env bash
set -euo pipefail

release_mode="${1:-}"
case "$release_mode" in
  signed|unsigned) ;;
  *)
    echo "release mode must be signed or unsigned" >&2
    exit 2
    ;;
esac

: "${GITHUB_ENV:?GITHUB_ENV is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${ANDROID_GOOGLE_SERVICES_JSON_BASE64:?ANDROID_GOOGLE_SERVICES_JSON_BASE64 is required}"

release_input_dir="$RUNNER_TEMP/akademik-android-release-inputs"
google_services_path="apps/mobile-native/google-services.json"
release_identity_path="apps/mobile-native/android-release-identity.json"
google_auth_verifier="scripts/verify-android-google-auth-config.mjs"
mkdir -p "$release_input_dir"

if ! printf '%s' "$ANDROID_GOOGLE_SERVICES_JSON_BASE64" | base64 --decode > "$google_services_path"; then
  echo "ANDROID_GOOGLE_SERVICES_JSON_BASE64 is not valid base64" >&2
  exit 1
fi
chmod 600 "$google_services_path"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$google_services_path"
node "$google_auth_verifier" \
  --contract "$release_identity_path" \
  --app-config apps/mobile-native/app.json \
  --google-services "$google_services_path" \
  --app-source apps/mobile-native/App.tsx \
  --env-dir apps/mobile-native

{
  echo "AKADEMIK_RELEASE_MODE=$release_mode"
} >> "$GITHUB_ENV"

if [[ "$release_mode" == "unsigned" ]]; then
  echo "Prepared explicit unsigned release inputs; no signing identity will be exported."
  exit 0
fi

required_signing_names=(
  ANDROID_UPLOAD_KEYSTORE_BASE64
  ANDROID_UPLOAD_STORE_PASSWORD
  ANDROID_UPLOAD_KEY_ALIAS
  ANDROID_UPLOAD_KEY_PASSWORD
)
for variable_name in "${required_signing_names[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "$variable_name is required for a signed release" >&2
    exit 1
  fi
done

if [[ "${ANDROID_UPLOAD_KEY_ALIAS,,}" == "androiddebugkey" ]]; then
  echo "The Android debug key alias cannot be used for release signing." >&2
  exit 1
fi

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  for masked_value in \
    "$ANDROID_UPLOAD_STORE_PASSWORD" \
    "$ANDROID_UPLOAD_KEY_ALIAS" \
    "$ANDROID_UPLOAD_KEY_PASSWORD"; do
    echo "::add-mask::$masked_value"
  done
fi

keystore_path="$release_input_dir/upload-keystore.jks"
if ! printf '%s' "$ANDROID_UPLOAD_KEYSTORE_BASE64" | base64 --decode > "$keystore_path"; then
  echo "ANDROID_UPLOAD_KEYSTORE_BASE64 is not valid base64" >&2
  exit 1
fi
chmod 600 "$keystore_path"

keytool -list \
  -keystore "$keystore_path" \
  -storepass "$ANDROID_UPLOAD_STORE_PASSWORD" \
  -alias "$ANDROID_UPLOAD_KEY_ALIAS" >/dev/null

certificate_subject="$({
  keytool -exportcert \
    -rfc \
    -keystore "$keystore_path" \
    -storepass "$ANDROID_UPLOAD_STORE_PASSWORD" \
    -alias "$ANDROID_UPLOAD_KEY_ALIAS" 2>/dev/null |
    openssl x509 -noout -subject
} || true)"
if grep -Eiq 'CN[[:space:]]*=[[:space:]]*Android Debug' <<< "$certificate_subject"; then
  echo "The Android debug certificate cannot be used for release signing." >&2
  exit 1
fi

certificate_path="$release_input_dir/upload-certificate.der"
keytool -exportcert \
  -keystore "$keystore_path" \
  -storepass "$ANDROID_UPLOAD_STORE_PASSWORD" \
  -alias "$ANDROID_UPLOAD_KEY_ALIAS" > "$certificate_path"

expected_upload_sha1="$(node -e '
  const identity = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(identity.androidOauthClients?.upload?.certificateSha1 ?? "").replace(/[^a-f0-9]/gi, "").toLowerCase());
' "$release_identity_path")"
expected_upload_sha256="$(node -e '
  const identity = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(identity.androidOauthClients?.upload?.certificateSha256 ?? "").replace(/[^a-f0-9]/gi, "").toLowerCase());
' "$release_identity_path")"
actual_upload_sha1="$(openssl x509 -inform DER -in "$certificate_path" -noout -fingerprint -sha1 | sed 's/^.*=//' | tr -d ':\r\n' | tr '[:upper:]' '[:lower:]')"
actual_upload_sha256="$(openssl x509 -inform DER -in "$certificate_path" -noout -fingerprint -sha256 | sed 's/^.*=//' | tr -d ':\r\n' | tr '[:upper:]' '[:lower:]')"

if [[ ${#expected_upload_sha1} -ne 40 || "$actual_upload_sha1" != "$expected_upload_sha1" ]]; then
  echo "The release keystore SHA-1 does not match the pinned upload certificate." >&2
  exit 1
fi
if [[ ${#expected_upload_sha256} -ne 64 || "$actual_upload_sha256" != "$expected_upload_sha256" ]]; then
  echo "The release keystore SHA-256 does not match the pinned upload certificate." >&2
  exit 1
fi

{
  echo "AKADEMIK_UPLOAD_STORE_FILE=$keystore_path"
  echo "AKADEMIK_UPLOAD_STORE_PASSWORD=$ANDROID_UPLOAD_STORE_PASSWORD"
  echo "AKADEMIK_UPLOAD_KEY_ALIAS=$ANDROID_UPLOAD_KEY_ALIAS"
  echo "AKADEMIK_UPLOAD_KEY_PASSWORD=$ANDROID_UPLOAD_KEY_PASSWORD"
} >> "$GITHUB_ENV"

echo "Validated and prepared signed release inputs."
