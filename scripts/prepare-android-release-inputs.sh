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
mkdir -p "$release_input_dir"

if ! printf '%s' "$ANDROID_GOOGLE_SERVICES_JSON_BASE64" | base64 --decode > "$google_services_path"; then
  echo "ANDROID_GOOGLE_SERVICES_JSON_BASE64 is not valid base64" >&2
  exit 1
fi
chmod 600 "$google_services_path"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$google_services_path"

{
  echo "AKADEMIK_RELEASE_MODE=$release_mode"
  echo "AKADEMIK_GOOGLE_SERVICES_FILE=$google_services_path"
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

for masked_value in \
  "$ANDROID_UPLOAD_STORE_PASSWORD" \
  "$ANDROID_UPLOAD_KEY_ALIAS" \
  "$ANDROID_UPLOAD_KEY_PASSWORD"; do
  echo "::add-mask::$masked_value"
done

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

{
  echo "AKADEMIK_UPLOAD_STORE_FILE=$keystore_path"
  echo "AKADEMIK_UPLOAD_STORE_PASSWORD=$ANDROID_UPLOAD_STORE_PASSWORD"
  echo "AKADEMIK_UPLOAD_KEY_ALIAS=$ANDROID_UPLOAD_KEY_ALIAS"
  echo "AKADEMIK_UPLOAD_KEY_PASSWORD=$ANDROID_UPLOAD_KEY_PASSWORD"
} >> "$GITHUB_ENV"

echo "Validated and prepared signed release inputs."
