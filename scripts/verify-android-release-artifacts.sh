#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_directory/.." && pwd -P)"
cd "$repo_root"

release_mode="${1:-}"
artifact_format="${2:-}"
input_root="${3:-apps/mobile-native/android/app/build/outputs}"
output_root="${4:-release-artifacts}"
application_id="${5:-com.anssoft.akademiktakvim}"
release_identity_path="apps/mobile-native/android-release-identity.json"

case "$release_mode" in signed|unsigned) ;; *) echo "invalid release mode" >&2; exit 2 ;; esac
case "$artifact_format" in apk|aab|both) ;; *) echo "invalid artifact format" >&2; exit 2 ;; esac

for command_name in sha256sum unzip jarsigner apkanalyzer keytool openssl node cmp java; do
  command -v "$command_name" >/dev/null || {
    echo "$command_name is required for artifact verification" >&2
    exit 1
  }
done

if [[ "$application_id" != "com.anssoft.akademiktakvim" || -n "${6:-}" ]]; then
  echo "Android production application and release identity overrides are not allowed." >&2
  exit 2
fi
if [[ "$output_root" != "release-artifacts" ]]; then
  echo "Android release output must use the fixed release-artifacts directory." >&2
  exit 2
fi
output_root="$repo_root/release-artifacts"

source_google_services="apps/mobile-native/google-services.json"
generated_google_services="apps/mobile-native/android/app/google-services.json"
if [[ ! -f "$generated_google_services" ]] || ! cmp -s "$source_google_services" "$generated_google_services"; then
  echo "Generated Android google-services.json is missing or stale; run Expo prebuild before verification." >&2
  exit 1
fi

node scripts/verify-android-google-auth-config.mjs \
  --contract "$release_identity_path" \
  --app-config apps/mobile-native/app.json \
  --google-services "$generated_google_services" \
  --app-source apps/mobile-native/App.tsx \
  --env-dir apps/mobile-native

expected_upload_sha1="$(node -e '
  const identity = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(identity.androidOauthClients?.upload?.certificateSha1 ?? "").replace(/[^a-f0-9]/gi, "").toLowerCase());
' "$release_identity_path")"
expected_upload_sha256="$(node -e '
  const identity = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(identity.androidOauthClients?.upload?.certificateSha256 ?? "").replace(/[^a-f0-9]/gi, "").toLowerCase());
' "$release_identity_path")"
expected_version_name="$(node -e '
  const app = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).expo;
  process.stdout.write(String(app.version));
' apps/mobile-native/app.json)"
expected_version_code="$(node -e '
  const app = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).expo;
  process.stdout.write(String(app.android.versionCode));
' apps/mobile-native/app.json)"
if [[ ${#expected_upload_sha1} -ne 40 || ${#expected_upload_sha256} -ne 64 ]]; then
  echo "Pinned upload certificate fingerprints are invalid." >&2
  exit 1
fi

android_sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$android_sdk_root" ]]; then
  echo "ANDROID_SDK_ROOT or ANDROID_HOME is required" >&2
  exit 1
fi
if [[ ! -d "$input_root" ]]; then
  echo "artifact input directory does not exist: $input_root" >&2
  exit 1
fi

apksigner_path="$(find "$android_sdk_root/build-tools" -type f -name apksigner -print | sort -V | tail -n 1)"
zipalign_path="$(find "$android_sdk_root/build-tools" -type f -name zipalign -print | sort -V | tail -n 1)"
if [[ -z "$apksigner_path" || -z "$zipalign_path" ]]; then
  echo "apksigner and zipalign are required" >&2
  exit 1
fi

rm -rf "$output_root"
mkdir -p "$output_root"
verification_log="$output_root/verification.txt"
: > "$verification_log"

verify_apk() {
  local artifact="$1"
  local signature_output
  local actual_application_id
  local actual_version_name
  local actual_version_code
  local debuggable
  local signer_sha1
  local signer_sha256

  unzip -tqq "$artifact"
  "$zipalign_path" -c -P 16 -v 4 "$artifact" >> "$verification_log"
  actual_application_id="$(apkanalyzer manifest application-id "$artifact")"
  if [[ "$actual_application_id" != "$application_id" ]]; then
    echo "unexpected APK application id: $actual_application_id" >&2
    exit 1
  fi
  actual_version_name="$(apkanalyzer manifest version-name "$artifact")"
  actual_version_code="$(apkanalyzer manifest version-code "$artifact")"
  if [[ "$actual_version_name" != "$expected_version_name" || "$actual_version_code" != "$expected_version_code" ]]; then
    echo "release APK version does not match app.json" >&2
    exit 1
  fi
  debuggable="$(apkanalyzer manifest debuggable "$artifact")"
  if [[ "$debuggable" != "false" ]]; then
    echo "release APK is debuggable: $debuggable" >&2
    exit 1
  fi

  if signature_output="$($apksigner_path verify --verbose --print-certs "$artifact" 2>&1)"; then
    if [[ "$release_mode" != "signed" ]]; then
      echo "unsigned APK unexpectedly has a valid signature" >&2
      exit 1
    fi
    if grep -Eiq 'CN[[:space:]]*=[[:space:]]*Android Debug|Android Debug' <<< "$signature_output"; then
      echo "release APK uses an Android debug certificate" >&2
      exit 1
    fi
    signer_sha1="$(grep -Eim1 'certificate SHA-1 digest:' <<< "$signature_output" | sed 's/^.*://' | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')"
    signer_sha256="$(grep -Eim1 'certificate SHA-256 digest:' <<< "$signature_output" | sed 's/^.*://' | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')"
    if [[ "$signer_sha1" != "$expected_upload_sha1" || "$signer_sha256" != "$expected_upload_sha256" ]]; then
      echo "release APK signer does not match the pinned upload certificate" >&2
      exit 1
    fi
  elif [[ "$release_mode" == "signed" ]]; then
    printf '%s\n' "$signature_output" >&2
    echo "signed APK failed signature verification" >&2
    exit 1
  fi
  printf '%s\n' "$signature_output" >> "$verification_log"
}

verify_aab() {
  local artifact="$1"
  local signature_output
  local manifest_output
  local signer_certificate
  local signer_sha1
  local signer_sha256

  : "${BUNDLETOOL_JAR:?BUNDLETOOL_JAR is required for AAB verification}"
  if [[ ! -f "$BUNDLETOOL_JAR" ]]; then
    echo "bundletool jar does not exist: $BUNDLETOOL_JAR" >&2
    exit 1
  fi
  unzip -tqq "$artifact"
  java -jar "$BUNDLETOOL_JAR" validate --bundle="$artifact" >> "$verification_log"
  manifest_output="$(java -jar "$BUNDLETOOL_JAR" dump manifest --bundle="$artifact" --module=base)"
  if [[ "$manifest_output" != *"package=\"$application_id\""* ||
        "$manifest_output" != *"android:versionName=\"$expected_version_name\""* ||
        "$manifest_output" != *"android:versionCode=\"$expected_version_code\""* ]]; then
    echo "release AAB package or version does not match app.json" >&2
    exit 1
  fi
  if [[ "$manifest_output" == *'android:debuggable="true"'* ]]; then
    echo "release AAB is debuggable" >&2
    exit 1
  fi
  printf '%s\n' "$manifest_output" >> "$verification_log"
  if signature_output="$(jarsigner -verify -verbose -certs "$artifact" 2>&1)" &&
    grep -q 'jar verified' <<< "$signature_output"; then
    if [[ "$release_mode" != "signed" ]]; then
      echo "unsigned AAB unexpectedly has a valid JAR signature" >&2
      exit 1
    fi
    if grep -Eiq 'CN[[:space:]]*=[[:space:]]*Android Debug|Android Debug' <<< "$signature_output"; then
      echo "release AAB uses an Android debug certificate" >&2
      exit 1
    fi
    signer_certificate="$(keytool -printcert -jarfile "$artifact" -rfc 2>/dev/null | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p')"
    signer_sha1="$(openssl x509 -noout -fingerprint -sha1 <<< "$signer_certificate" | sed 's/^.*=//' | tr -d ':\r\n' | tr '[:upper:]' '[:lower:]')"
    signer_sha256="$(openssl x509 -noout -fingerprint -sha256 <<< "$signer_certificate" | sed 's/^.*=//' | tr -d ':\r\n' | tr '[:upper:]' '[:lower:]')"
    if [[ "$signer_sha1" != "$expected_upload_sha1" || "$signer_sha256" != "$expected_upload_sha256" ]]; then
      echo "release AAB signer does not match the pinned upload certificate" >&2
      exit 1
    fi
  elif [[ "$release_mode" == "signed" ]]; then
    printf '%s\n' "$signature_output" >&2
    echo "signed AAB failed JAR signature verification" >&2
    exit 1
  fi
  printf '%s\n' "$signature_output" >> "$verification_log"
}

declare -a requested_extensions=()
[[ "$artifact_format" == "apk" || "$artifact_format" == "both" ]] && requested_extensions+=(apk)
[[ "$artifact_format" == "aab" || "$artifact_format" == "both" ]] && requested_extensions+=(aab)

for extension in "${requested_extensions[@]}"; do
  mapfile -t matches < <(find "$input_root" -type f -name "*release*.${extension}" -print)
  if [[ "${#matches[@]}" -ne 1 ]]; then
    echo "expected exactly one release .$extension artifact, found ${#matches[@]}" >&2
    printf '%s\n' "${matches[@]:-}" >&2
    exit 1
  fi

  source_artifact="${matches[0]}"
  staged_artifact="$output_root/akademik-takvim-${release_mode}-release.${extension}"
  case "$extension" in
    apk) verify_apk "$source_artifact" ;;
    aab) verify_aab "$source_artifact" ;;
  esac
  cp "$source_artifact" "$staged_artifact"
done

(
  cd "$output_root"
  mapfile -t staged_artifacts < <(
    find . -maxdepth 1 -type f \( -name '*.apk' -o -name '*.aab' \) -print | sort
  )
  if [[ "${#staged_artifacts[@]}" -eq 0 ]]; then
    echo "no staged artifacts found for checksumming" >&2
    exit 1
  fi
  sha256sum "${staged_artifacts[@]}" > SHA256SUMS
)

{
  echo "release_mode=$release_mode"
  echo "artifact_format=$artifact_format"
  echo "application_id=$application_id"
  echo "upload_certificate_sha1=$expected_upload_sha1"
  echo "git_sha=${GITHUB_SHA:-unknown}"
} > "$output_root/release-metadata.txt"

echo "Verified Android release artifacts in $output_root"
