#!/usr/bin/env bash
set -Eeuo pipefail

deployment_root="/opt/anssoft-web"
staging_root="${deployment_root}/staging"
live_root="${deployment_root}/live"
backup_root="${deployment_root}/backups/$(date +%Y%m%dT%H%M%S%z)"
caddy_root="/home/ans/docker/caddy"
caddy_container="anssoft-tenant-edge-caddy-1"
web_container="anssoft-academic-web"
route_name="academic-api.anssoft.com.tr.caddy"
route_target="${caddy_root}/custom-domains/${route_name}"

route_changed=false
live_swapped=false
had_previous_live=false

initial_caddy_id="$(docker inspect --format '{{.Id}}' "${caddy_container}")"
initial_caddy_started_at="$(docker inspect --format '{{.State.StartedAt}}' "${caddy_container}")"
initial_caddy_restart_count="$(docker inspect --format '{{.RestartCount}}' "${caddy_container}")"

rollback() {
	local exit_code=$?
	trap - ERR
	echo "Web activation failed; restoring the previous deployment." >&2

	if [[ "${route_changed}" == "true" && -f "${backup_root}/${route_name}" ]]; then
		install -m 640 -o ans -g ans "${backup_root}/${route_name}" "${route_target}.rollback"
		mv -f "${route_target}.rollback" "${route_target}"
		docker exec "${caddy_container}" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || true
		docker exec "${caddy_container}" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
	fi

	if [[ "${live_swapped}" == "true" ]]; then
		docker compose --project-directory "${live_root}" -f "${live_root}/compose.yaml" down || true
		mv "${live_root}" "${backup_root}/failed-live" || true
		if [[ "${had_previous_live}" == "true" && -d "${backup_root}/previous-live" ]]; then
			mv "${backup_root}/previous-live" "${live_root}"
			docker compose --project-directory "${live_root}" -f "${live_root}/compose.yaml" up -d || true
		fi
	fi

	exit "${exit_code}"
}

trap rollback ERR

for required in compose.yaml Caddyfile "${route_name}" dist/index.html; do
	[[ -e "${staging_root}/${required}" ]]
done

if find "${staging_root}" -type l -print -quit | grep -q .; then
	echo "Staging content must not contain symbolic links." >&2
	exit 1
fi

grep -Fq '/app/assets/' "${staging_root}/dist/index.html"
grep -RFlq 'https://academic-api.anssoft.com.tr' "${staging_root}/dist/assets"
if grep -RFq '.run.app' "${staging_root}/dist/assets"; then
	echo "The web bundle still contains a Cloud Run API URL." >&2
	exit 1
fi

[[ "$(docker network inspect anssoft-academic-edge --format '{{.Internal}}')" == "true" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${caddy_container}")" == "healthy" ]]
docker compose --project-directory "${staging_root}" -f "${staging_root}/compose.yaml" config --quiet

mkdir -p "${backup_root}"
if [[ -f "${route_target}" ]]; then
	cp -a "${route_target}" "${backup_root}/${route_name}"
fi

new_live="${deployment_root}/live.new"
[[ ! -e "${new_live}" ]]
mkdir -p "${new_live}"
cp -a "${staging_root}/compose.yaml" "${staging_root}/Caddyfile" "${staging_root}/${route_name}" "${new_live}/"
cp -a "${staging_root}/dist" "${new_live}/dist"

if [[ -d "${live_root}" ]]; then
	had_previous_live=true
	mv "${live_root}" "${backup_root}/previous-live"
fi
mv "${new_live}" "${live_root}"
live_swapped=true

docker compose --project-directory "${live_root}" -f "${live_root}/compose.yaml" up -d --force-recreate

for _ in $(seq 1 30); do
	if [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${web_container}" 2>/dev/null || true)" == "healthy" ]]; then
		break
	fi
	sleep 2
done

[[ "$(docker inspect --format '{{.State.Health.Status}}' "${web_container}")" == "healthy" ]]
[[ "$(docker inspect --format '{{json .HostConfig.PortBindings}}' "${web_container}")" == "{}" ]]
docker exec "${caddy_container}" wget -qO- http://academic-web:8080/ | grep -Fq 'Akademik Takvim'

install -m 640 -o ans -g ans "${live_root}/${route_name}" "${route_target}.tmp"
mv -f "${route_target}.tmp" "${route_target}"
route_changed=true

docker exec "${caddy_container}" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec "${caddy_container}" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

[[ "$(docker inspect --format '{{.Id}}' "${caddy_container}")" == "${initial_caddy_id}" ]]
[[ "$(docker inspect --format '{{.State.StartedAt}}' "${caddy_container}")" == "${initial_caddy_started_at}" ]]
[[ "$(docker inspect --format '{{.RestartCount}}' "${caddy_container}")" == "${initial_caddy_restart_count}" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${caddy_container}")" == "healthy" ]]

curl -fsS https://academic-api.anssoft.com.tr/app/ | grep -Fq 'Akademik Takvim'
curl -fsS https://academic-api.anssoft.com.tr/health/ready | grep -Fq '"status":"ok"'

date --iso-8601=seconds > "${deployment_root}/web-activated-at.txt"
chmod 600 "${deployment_root}/web-activated-at.txt"

trap - ERR
echo "Academic web activation: complete"
