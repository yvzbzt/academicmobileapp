#!/usr/bin/env bash
set -Eeuo pipefail

public_origin="https://academic-api.anssoft.com.tr"
caddy_container="anssoft-tenant-edge-caddy-1"
web_container="anssoft-academic-web"

temporary_root="$(mktemp -d)"
trap 'rm -rf -- "${temporary_root}"' EXIT

docker exec "${caddy_container}" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${caddy_container}")" == "healthy" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${web_container}")" == "healthy" ]]
[[ "$(docker inspect --format '{{json .HostConfig.PortBindings}}' "${web_container}")" == "{}" ]]

redirect_status="$(curl -sS -o /dev/null -w '%{http_code}' "${public_origin}/app")"
[[ "${redirect_status}" == "308" ]]

curl -fsS -D "${temporary_root}/web.headers" -o "${temporary_root}/web.html" "${public_origin}/app/"
grep -Fq 'Akademik Takvim' "${temporary_root}/web.html"
grep -iq '^x-content-type-options: nosniff' "${temporary_root}/web.headers"
grep -iq '^x-frame-options: DENY' "${temporary_root}/web.headers"

asset_path="$(grep -oE '/app/assets/[^\" ]+\.(js|css)' "${temporary_root}/web.html" | head -n 1)"
[[ -n "${asset_path}" ]]
curl -fsS -D "${temporary_root}/asset.headers" -o /dev/null "${public_origin}${asset_path}"
grep -iq '^cache-control: public, max-age=31536000, immutable' "${temporary_root}/asset.headers"

if grep -RFq '.run.app' /opt/anssoft-web/live/dist/assets; then
	echo "The live web bundle contains a Cloud Run URL." >&2
	exit 1
fi
grep -RFlq 'https://academic-api.anssoft.com.tr' /opt/anssoft-web/live/dist/assets

echo "web_url=${public_origin}/app/"
echo "redirect_status=${redirect_status}"
echo "asset_path=${asset_path}"
echo "web_container_health=healthy"
echo "web_published_ports=none"
echo "verification=passed"
