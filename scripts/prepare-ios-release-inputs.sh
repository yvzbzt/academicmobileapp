#!/usr/bin/env bash
set -euo pipefail

: "${IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64:?IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64 is required}"

google_services_path="apps/mobile-native/GoogleService-Info.plist"
expected_bundle_id="com.anssoft.akademiktakvim"
temporary_plist="$(mktemp "${TMPDIR:-/tmp}/GoogleService-Info.plist.XXXXXX")"
trap 'rm -f "$temporary_plist"' EXIT

if ! printf '%s' "$IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64" | base64 --decode > "$temporary_plist" 2>/dev/null; then
  if ! printf '%s' "$IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64" | base64 -D > "$temporary_plist" 2>/dev/null; then
    echo "IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64 is not valid base64" >&2
    exit 1
  fi
fi

plutil -lint "$temporary_plist" >/dev/null

configured_bundle_id="$(/usr/libexec/PlistBuddy -c 'Print:BUNDLE_ID' "$temporary_plist")"
if [[ "$configured_bundle_id" != "$expected_bundle_id" ]]; then
  echo "GoogleService-Info.plist bundle ID does not match $expected_bundle_id" >&2
  exit 1
fi

required_keys=(API_KEY CLIENT_ID GOOGLE_APP_ID REVERSED_CLIENT_ID)
for key in "${required_keys[@]}"; do
  if [[ -z "$(/usr/libexec/PlistBuddy -c "Print:$key" "$temporary_plist" 2>/dev/null)" ]]; then
    echo "GoogleService-Info.plist is missing $key" >&2
    exit 1
  fi
done

chmod 600 "$temporary_plist"
mv -f "$temporary_plist" "$google_services_path"
trap - EXIT

echo "Validated and prepared iOS Firebase release input."
