#!/usr/bin/env bash
set -Eeuo pipefail

public_origin="https://academic-api.anssoft.com.tr"
origin_ip="178.105.56.60"
caddy_container="anssoft-tenant-edge-caddy-1"
admin_container="anssoft-academic-admin"
expected_caddy_id="d37e90152ad7dcf3b7f0942d301ac1c5d3cf33da020a71bcc440218c2b5b3eea"
expected_caddy_started_at="2026-06-17T11:31:54.187759883Z"

temporary_root="$(mktemp -d)"
trap 'rm -rf -- "${temporary_root}"' EXIT

docker exec "${caddy_container}" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
[[ "$(docker inspect --format '{{.Id}}' "${caddy_container}")" == "${expected_caddy_id}" ]]
[[ "$(docker inspect --format '{{.State.StartedAt}}' "${caddy_container}")" == "${expected_caddy_started_at}" ]]
[[ "$(docker inspect --format '{{.RestartCount}}' "${caddy_container}")" == "0" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${caddy_container}")" == "healthy" ]]

[[ "$(docker inspect --format '{{.State.Health.Status}}' "${admin_container}")" == "healthy" ]]
[[ "$(docker inspect --format '{{json .HostConfig.PortBindings}}' "${admin_container}")" == "{}" ]]
admin_networks="$(docker inspect --format '{{json .NetworkSettings.Networks}}' "${admin_container}")"
grep -Fq 'anssoft-academic-edge' <<<"${admin_networks}"
if grep -Eq 'anssoft-(egress|internal)' <<<"${admin_networks}"; then
	echo "Admin container is attached to an unexpected network." >&2
	exit 1
fi

if ss -lntH | grep -Eq '(^|:)18080([[:space:]]|$)'; then
	echo "Obsolete host port 18080 is listening." >&2
	exit 1
fi

redirect_status="$(curl -sS -o /dev/null -w '%{http_code}' "${public_origin}/admin")"
[[ "${redirect_status}" == "308" ]]

curl -fsS -D "${temporary_root}/admin.headers" -o "${temporary_root}/admin.html" "${public_origin}/admin/"
grep -Fq 'Akademik Takvim Admin' "${temporary_root}/admin.html"
grep -iq '^content-security-policy:' "${temporary_root}/admin.headers"
grep -iq '^x-content-type-options: nosniff' "${temporary_root}/admin.headers"
grep -iq '^x-frame-options: DENY' "${temporary_root}/admin.headers"

asset_path="$(grep -oE '/admin/assets/[^\" ]+\.(js|css)' "${temporary_root}/admin.html" | head -n 1)"
[[ -n "${asset_path}" ]]
curl -fsS -D "${temporary_root}/asset.headers" -o /dev/null "${public_origin}${asset_path}"
grep -iq '^cache-control: public, max-age=31536000, immutable' "${temporary_root}/asset.headers"

curl -fsS --resolve "academic-api.anssoft.com.tr:443:${origin_ip}" \
	"${public_origin}/admin/" | grep -Fq 'Akademik Takvim Admin'
curl -fsS "${public_origin}/health/ready" | grep -Fq '"status":"ok"'
curl -fsS "${public_origin}/universities?limit=1&offset=0" | grep -Fq '"slug"'

cors_status="$(curl -sS -o "${temporary_root}/cors.body" -D "${temporary_root}/cors.headers" -w '%{http_code}' \
	-X OPTIONS "${public_origin}/universities" \
	-H 'Origin: https://academic-mobile-app-7629.web.app' \
	-H 'Access-Control-Request-Method: GET')"
[[ "${cors_status}" == "204" ]]
grep -iq '^access-control-allow-origin: https://academic-mobile-app-7629.web.app' "${temporary_root}/cors.headers"

if grep -RFq '.run.app' /opt/anssoft-admin/live/dist/assets; then
	echo "The live admin bundle contains a Cloud Run URL." >&2
	exit 1
fi
grep -RFlq 'https://academic-api.anssoft.com.tr' /opt/anssoft-admin/live/dist/assets

echo "admin_url=${public_origin}/admin/"
echo "redirect_status=${redirect_status}"
echo "asset_path=${asset_path}"
echo "cors_status=${cors_status}"
echo "admin_container_health=healthy"
echo "admin_published_ports=none"
echo "host_port_18080=absent"
echo "caddy_restart_count=0"
echo "verification=passed"
