#!/usr/bin/env bash
set -Eeuo pipefail

env_file="${1:-/opt/anssoft-academicmobilapp-backend/.env}"
[[ -f "${env_file}" ]]

backup_path="${env_file}.backup.$(date +%Y%m%dT%H%M%S%z)"
cp -a "${env_file}" "${backup_path}"

ensure_key() {
	local key="$1"
	local value="$2"
	if ! grep -Eq "^${key}=" "${env_file}"; then
		printf '%s=%s\n' "${key}" "${value}" >> "${env_file}"
	fi
}

ensure_origin() {
	local origin="$1"
	local current
	current="$(grep -E '^CORS_ORIGIN=' "${env_file}" | tail -n 1 | cut -d= -f2- || true)"
	if [[ -z "${current}" ]]; then
		printf 'CORS_ORIGIN=%s\n' "${origin}" >> "${env_file}"
		return
	fi
	if [[ ",${current}," != *",${origin},"* ]]; then
		sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=${current},${origin}|" "${env_file}"
	fi
}

ensure_origin "https://academic-api.anssoft.com.tr"
ensure_key "FIREBASE_PROJECT_ID" "academic-mobile-app-7629"
ensure_key "FIREBASE_SERVICE_ACCOUNT_JSON" ""
ensure_key "GOOGLE_APPLICATION_CREDENTIALS" ""
ensure_key "API_PUBLIC_BASE_URL" "https://academic-api.anssoft.com.tr"
ensure_key "EMAIL_VERIFICATION_URL" "https://academic-api.anssoft.com.tr/auth/verify-email"
ensure_key "MAIL_FROM" "noreply@anssoft.com.tr"
ensure_key "SMTP_HOST" ""
ensure_key "SMTP_PORT" "587"
ensure_key "SMTP_USER" ""
ensure_key "SMTP_PASS" ""
ensure_key "SMTP_SECURE" "false"

chmod 600 "${env_file}"
echo "env_file=${env_file}"
echo "backup=${backup_path}"
echo "smtp_keys=present"
