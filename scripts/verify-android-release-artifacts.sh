#!/usr/bin/env bash
set -euo pipefail

release_mode="${1:-}"
artifact_format="${2:-}"
input_root="${3:-apps/mobile-native/android/app/build/outputs}"
output_root="${4:-release-artifacts}"
application_id="${5:-com.anssoft.akademiktakvim}"

case "$release_mode" in signed|unsigned) ;; *) echo "invalid release mode" >&2; exit 2 ;; esac
case "$artifact_format" in apk|aab|both) ;; *) echo "invalid artifact format" >&2; exit 2 ;; esac

for command_name in sha256sum unzip jarsigner apkanalyzer; do
  command -v "$command_name" >/dev/null || {
    echo "$command_name is required for artifact verification" >&2
    exit 1
  }
done

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
  local debuggable

  unzip -tqq "$artifact"
  "$zipalign_path" -c -P 16 -v 4 "$artifact" >> "$verification_log"
  actual_application_id="$(apkanalyzer manifest application-id "$artifact")"
  if [[ "$actual_application_id" != "$application_id" ]]; then
    echo "unexpected APK application id: $actual_application_id" >&2
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

  : "${BUNDLETOOL_JAR:?BUNDLETOOL_JAR is required for AAB verification}"
  if [[ ! -f "$BUNDLETOOL_JAR" ]]; then
    echo "bundletool jar does not exist: $BUNDLETOOL_JAR" >&2
    exit 1
  fi
  unzip -tqq "$artifact"
  java -jar "$BUNDLETOOL_JAR" validate --bundle="$artifact" >> "$verification_log"
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
  echo "git_sha=${GITHUB_SHA:-unknown}"
} > "$output_root/release-metadata.txt"

echo "Verified Android release artifacts in $output_root"
