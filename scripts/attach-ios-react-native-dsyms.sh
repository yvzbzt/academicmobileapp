#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile-native"
ARCHIVE_PATH="${1:-}"

if [[ -z "$ARCHIVE_PATH" || ! -d "$ARCHIVE_PATH" ]]; then
  echo "Usage: $0 /path/to/App.xcarchive" >&2
  exit 64
fi

RN_VERSION="${RN_VERSION:-$(/usr/bin/plutil -extract dependencies.react-native raw -o - "$MOBILE_DIR/package.json")}"
if [[ ! "$RN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  echo "React Native version must be pinned exactly; received: $RN_VERSION" >&2
  exit 65
fi

APP_PATH="$(find "$ARCHIVE_PATH/Products/Applications" -maxdepth 1 -type d -name '*.app' -print -quit)"
if [[ -z "$APP_PATH" ]]; then
  echo "No application bundle found in archive: $ARCHIVE_PATH" >&2
  exit 66
fi

CACHE_ROOT="${RN_DSYM_CACHE_DIR:-$MOBILE_DIR/build/react-native-dsyms/$RN_VERSION}"
DOWNLOAD_DIR="${RN_DSYM_DOWNLOAD_DIR:-$CACHE_ROOT/downloads}"
EXTRACT_DIR="$CACHE_ROOT/extracted"
DESTINATION_DIR="$ARCHIVE_PATH/dSYMs"
MAVEN_ROOT="https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/$RN_VERSION"

mkdir -p "$DOWNLOAD_DIR" "$EXTRACT_DIR" "$DESTINATION_DIR"

download_verified_artifact() {
  local artifact="$1"
  local url="$MAVEN_ROOT/$artifact"
  local destination="$DOWNLOAD_DIR/$artifact"
  local checksum_file="$destination.sha256"
  local expected
  local actual

  expected="$(curl --silent --show-error --fail --location "$url.sha256")"
  expected="${expected//[[:space:]]/}"
  if [[ ! "$expected" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "Invalid SHA-256 response for $artifact" >&2
    exit 67
  fi

  if [[ -f "$destination" ]]; then
    actual="$(shasum -a 256 "$destination" | awk '{print $1}')"
  else
    actual=""
  fi

  if [[ "$actual" != "$expected" ]]; then
    rm -f "$destination.download"
    curl --fail --location --retry 3 --output "$destination.download" "$url"
    actual="$(shasum -a 256 "$destination.download" | awk '{print $1}')"
    if [[ "$actual" != "$expected" ]]; then
      rm -f "$destination.download"
      echo "SHA-256 mismatch for $artifact" >&2
      exit 68
    fi
    mv "$destination.download" "$destination"
  fi

  printf '%s\n' "$expected" > "$checksum_file"
}

extract_symbol_bundle() {
  local artifact="$1"
  local member="$2"
  local bundle_name="$3"
  local artifact_path="$DOWNLOAD_DIR/$artifact"
  local artifact_hash
  local artifact_root="$EXTRACT_DIR/${artifact%.tar.gz}"
  local marker="$artifact_root/.artifact-sha256"
  local extracted_hash=""

  artifact_hash="$(shasum -a 256 "$artifact_path" | awk '{print $1}')"
  if [[ -f "$marker" ]]; then
    extracted_hash="$(/bin/cat "$marker")"
  fi
  if [[ "$extracted_hash" != "$artifact_hash" ]]; then
    rm -rf "$artifact_root"
    mkdir -p "$artifact_root"
    tar -xzf "$artifact_path" -C "$artifact_root" "./$member/$bundle_name"
    printf '%s\n' "$artifact_hash" > "$marker"
  fi

  printf '%s/%s/%s\n' "$artifact_root" "$member" "$bundle_name"
}

binary_uuids() {
  dwarfdump --uuid "$1" | awk '{print toupper($2)}' | sort -u | tr '\n' ' '
}

attach_symbol_bundle() {
  local artifact="$1"
  local member="$2"
  local bundle_name="$3"
  local framework_binary="$4"
  local symbol_bundle
  local framework_uuids
  local symbol_uuids

  download_verified_artifact "$artifact"
  symbol_bundle="$(extract_symbol_bundle "$artifact" "$member" "$bundle_name")"
  framework_uuids="$(binary_uuids "$APP_PATH/Frameworks/$framework_binary")"
  symbol_uuids="$(binary_uuids "$symbol_bundle")"

  if [[ -z "$framework_uuids" || "$framework_uuids" != "$symbol_uuids" ]]; then
    echo "UUID mismatch for $bundle_name" >&2
    echo "Framework: $framework_uuids" >&2
    echo "dSYM:      $symbol_uuids" >&2
    exit 69
  fi

  rm -rf "$DESTINATION_DIR/$bundle_name"
  ditto "$symbol_bundle" "$DESTINATION_DIR/$bundle_name"
  echo "Attached $bundle_name ($symbol_uuids)"
}

attach_symbol_bundle \
  "react-native-artifacts-$RN_VERSION-reactnative-core-dSYM-release.tar.gz" \
  "ios-arm64" \
  "React.framework.dSYM" \
  "React.framework/React"

attach_symbol_bundle \
  "react-native-artifacts-$RN_VERSION-reactnative-dependencies-dSYM-release.tar.gz" \
  "ios-arm64" \
  "ReactNativeDependencies.framework.dSYM" \
  "ReactNativeDependencies.framework/ReactNativeDependencies"

attach_symbol_bundle \
  "react-native-artifacts-$RN_VERSION-hermes-framework-dSYM-release.tar.gz" \
  "iphoneos" \
  "hermes.framework.dSYM" \
  "hermes.framework/hermes"

echo "React Native $RN_VERSION symbols are ready in $DESTINATION_DIR"
