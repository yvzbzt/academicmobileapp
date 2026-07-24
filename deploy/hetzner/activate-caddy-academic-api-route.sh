#!/usr/bin/env bash
set -Eeuo pipefail

deployment_root="/opt/anssoft-academicmobilapp-backend"
caddy_root="/home/ans/docker/caddy"
caddy_container="anssoft-tenant-edge-caddy-1"
route_source="${deployment_root}/Caddyfile.proposed"
route_target="${caddy_root}/custom-domains/academic-api.anssoft.com.tr.caddy"
route_temporary="${route_target}.tmp"

expected_route_sha256="a2b2be9ab165be1d61512ceb57fba5219ab1ca929cbc895b789be1101d15925b"
expected_caddy_id="d37e90152ad7dcf3b7f0942d301ac1c5d3cf33da020a71bcc440218c2b5b3eea"
expected_caddy_started_at="2026-06-17T11:31:54.187759883Z"

route_installed=false
route_reloaded=false

sha256_of() {
  sha256sum "$1" | awk '{print $1}'
}

rollback() {
  local exit_code=$?
  trap - ERR
  echo "Route activation failed; restoring the previous Caddy configuration." >&2

  rm -f -- "${route_temporary}"
  if [[ "${route_installed}" == "true" ]]; then
    rm -f -- "${route_target}"
  fi

  if [[ "${route_reloaded}" == "true" ]]; then
    docker exec "${caddy_container}" \
      caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || true
    docker exec "${caddy_container}" \
      caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
  fi

  exit "${exit_code}"
}

trap rollback ERR

[[ "$(sha256_of "${route_source}")" == "${expected_route_sha256}" ]]
[[ ! -e "${route_target}" ]]
[[ "$(docker inspect --format '{{.Id}}' "${caddy_container}")" == "${expected_caddy_id}" ]]
[[ "$(docker inspect --format '{{.State.StartedAt}}' "${caddy_container}")" == "${expected_caddy_started_at}" ]]
[[ "$(docker inspect --format '{{.RestartCount}}' "${caddy_container}")" == "0" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${caddy_container}")" == "healthy" ]]

docker exec "${caddy_container}" \
  wget -qO- http://academic-api:3000/health/ready >/dev/null

install -m 640 -o ans -g ans "${route_source}" "${route_temporary}"
mv "${route_temporary}" "${route_target}"
route_installed=true

[[ "$(sha256_of "${route_target}")" == "${expected_route_sha256}" ]]
docker exec "${caddy_container}" \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec "${caddy_container}" \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
route_reloaded=true

[[ "$(docker inspect --format '{{.Id}}' "${caddy_container}")" == "${expected_caddy_id}" ]]
[[ "$(docker inspect --format '{{.State.StartedAt}}' "${caddy_container}")" == "${expected_caddy_started_at}" ]]
[[ "$(docker inspect --format '{{.RestartCount}}' "${caddy_container}")" == "0" ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${caddy_container}")" == "healthy" ]]
docker exec "${caddy_container}" \
  wget -qO- http://127.0.0.1:8080/healthz >/dev/null

date --iso-8601=seconds > "${deployment_root}/caddy-route-activated-at.txt"
chmod 600 "${deployment_root}/caddy-route-activated-at.txt"

trap - ERR
echo "Academic API Caddy route activation: complete"
