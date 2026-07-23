#!/usr/bin/env bash
set -Eeuo pipefail

env_file="${1:-/opt/anssoft-academicmobilapp-backend/.env}"
keys_regex='^(MAIL_FROM|SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_SECURE)='
keys=(MAIL_FROM SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SECURE)

[[ -f "${env_file}" ]]

source_temp="$(mktemp)"
clean_source="$(mktemp)"
base_temp="$(mktemp)"
trap 'rm -f "${source_temp}" "${clean_source}" "${base_temp}"' EXIT

cat > "${source_temp}"
tr -d '\r' < "${source_temp}" > "${clean_source}"

cp -a "${env_file}" "${env_file}.backup.smtp-update"
grep -Ev "${keys_regex}" "${env_file}" > "${base_temp}"

for key in "${keys[@]}"; do
	line="$(grep -E "^${key}=" "${clean_source}" | tail -n 1 || true)"
	if [[ -n "${line}" ]]; then
		printf '%s\n' "${line}" >> "${base_temp}"
	fi
done

install -m 600 "${base_temp}" "${env_file}"
echo "smtp_env_updated"
